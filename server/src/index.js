import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './config.js';
import { openDb } from './db.js';
import { ChunkCache, validTid } from './cache.js';
import { Metrics } from './metrics.js';
import { httpAuth } from './auth.js';
import { attachSignaling } from './ws.js';
import { loadOrCreateCert, lanAddresses } from './tls.js';

const db = openDb(cfg.dataDir);
const metrics = new Metrics();
const cache = new ChunkCache(db, path.join(cfg.dataDir, 'chunks'), cfg.cacheBytes);
metrics.gauge('cache_bytes', () => cache.total);
metrics.gauge('rooms_total', () => db.prepare('SELECT COUNT(*) c FROM rooms').get().c);

const app = express();
app.disable('x-powered-by');
if (cfg.trustProxy) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self)' });
  if (cfg.csp) res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; worker-src 'self' blob:; frame-ancestors 'none'");
  next();
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const Q = {
  man: db.prepare('SELECT transfer_id, room_id, chunk_count, leaf_hashes FROM manifests WHERE transfer_id=?'),
  room: db.prepare('SELECT room_id, name, owner_peer, open_join, expires_at FROM rooms WHERE room_id=?'),
  count: db.prepare("SELECT COUNT(*) c FROM members WHERE room_id=? AND status='active'"),
  mans: db.prepare('SELECT json FROM manifests WHERE room_id=? ORDER BY created_at DESC LIMIT 200'),
};
async function memberOfTransfer(req, res) {
  const tid = req.params.tid;
  if (!validTid(tid)) { res.status(400).json({ error: 'bad-transfer' }); return null; }
  const auth = await httpAuth(db, req);
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return null; }
  const man = Q.man.get(tid);
  if (!man) { res.status(404).json({ error: 'unknown-transfer' }); return null; }
  if (!auth.rooms.has(man.room_id)) { res.status(403).json({ error: 'forbidden' }); return null; }
  return man;
}

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Math.floor((Date.now() - metrics.started) / 1000), ...sig.stats(), cacheBytes: cache.total, cacheQuota: cfg.cacheBytes }));
app.get('/api/metrics', (req, res) => res.type('text/plain; version=0.0.4').send(metrics.text()));
app.get('/api/rooms/:id', (req, res) => {
  const r = Q.room.get(String(req.params.id));
  if (!r || (r.expires_at && r.expires_at < Date.now())) return res.status(404).json({ error: 'not-found' });
  res.json({ roomId: r.room_id, name: r.name, ownerPeerId: r.owner_peer, openJoin: !!r.open_join, members: Q.count.get(r.room_id).c });
});
app.get('/api/rooms/:id/manifests', wrap(async (req, res) => {
  const auth = await httpAuth(db, req);
  if (!auth || !auth.rooms.has(req.params.id)) return res.status(401).json({ error: 'unauthorized' });
  res.json(Q.mans.all(req.params.id).map((r) => JSON.parse(r.json)));
}));
app.get('/api/chunks/:tid', wrap(async (req, res) => {
  const man = await memberOfTransfer(req, res); if (!man) return;
  res.json(cache.bitfield(man.transfer_id, man.chunk_count));
}));
app.get('/api/chunks/:tid/:idx', wrap(async (req, res) => {
  const man = await memberOfTransfer(req, res); if (!man) return;
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= man.chunk_count || !cache.has(man.transfer_id, idx)) return res.status(404).json({ error: 'not-cached' });
  cache.touch(man.transfer_id, idx);
  metrics.inc('chunk_gets');
  res.sendFile(cache.file(man.transfer_id, idx), { dotfiles: 'allow', headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' } }); // Range supported
}));
app.put('/api/chunks/:tid/:idx', express.raw({ type: () => true, limit: '3mb' }), wrap(async (req, res) => {
  const man = await memberOfTransfer(req, res); if (!man) return;
  const idx = Number(req.params.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= man.chunk_count || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'bad-chunk' });
  const hash = crypto.createHash('sha256').update(req.body).digest();
  if (!hash.equals(man.leaf_hashes.subarray(idx * 32, idx * 32 + 32))) { metrics.inc('chunk_rejected'); return res.status(422).json({ error: 'hash-mismatch' }); }
  cache.put(man.transfer_id, idx, req.body, hash.toString('hex'));
  metrics.inc('chunk_puts'); metrics.inc('chunk_bytes_in', req.body.length);
  res.json({ ok: true });
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'not-found' }));

const indexHtml = path.join(cfg.clientDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(cfg.clientDist, { index: false, setHeaders: (res, f) => { if (/sw\.js$|index\.html$|manifest\.webmanifest$|registerSW\.js$/.test(f)) res.set('Cache-Control', 'no-cache'); else if (/assets[\\/]/.test(f)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get('*', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(indexHtml));
} else {
  app.get('*', (req, res) => res.status(503).type('text/plain').send('Client not built yet. Run "npm run build" (or use "npm run dev" and open http://localhost:5173).'));
}
app.use((err, req, res, next) => { console.error('[http]', err); res.status(500).json({ error: 'server-error' }); });

let server, scheme = 'http';
if (cfg.https) {
  const c = await loadOrCreateCert(cfg.dataDir);
  server = https.createServer({ key: c.key, cert: c.cert }, app); scheme = 'https';
  if (c.generated) console.log('Generated a self-signed certificate in', path.join(cfg.dataDir, 'certs'));
} else server = http.createServer(app);
const sig = attachSignaling(server, { db, metrics });

// purge expired rooms / manifests / messages and their cached chunk files
function purge() {
  const now = Date.now();
  for (const r of db.prepare('SELECT transfer_id FROM manifests WHERE expires_at IS NOT NULL AND expires_at<?').all(now)) cache.dropTransfer(r.transfer_id);
  for (const r of db.prepare('SELECT m.transfer_id FROM manifests m JOIN rooms r ON r.room_id=m.room_id WHERE r.expires_at IS NOT NULL AND r.expires_at<?').all(now)) cache.dropTransfer(r.transfer_id);
  db.prepare('DELETE FROM manifests WHERE expires_at IS NOT NULL AND expires_at<?').run(now);
  db.prepare('DELETE FROM rooms WHERE expires_at IS NOT NULL AND expires_at<?').run(now);
  db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at<?').run(now);
  db.prepare('DELETE FROM metric_events WHERE ts<?').run(now - 7 * 864e5);
  cache.recount();
}
purge(); setInterval(purge, 5 * 60 * 1000).unref();

server.listen(cfg.port, '0.0.0.0', () => {
  console.log(`\nCrowdwave Campus Node listening on ${scheme}://localhost:${cfg.port}`);
  for (const ip of lanAddresses()) console.log(`  LAN: ${scheme}://${ip}:${cfg.port}`);
  if (!cfg.https) console.log('  Note: phones on the LAN need HTTPS for crypto. Use "npm run start:lan" (self-signed) or a TLS-terminating host.');
  console.log(`  Data: ${cfg.dataDir}\n`);
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { server.close(); db.close(); process.exit(0); });
