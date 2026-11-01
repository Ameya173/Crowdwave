import { Emitter, b64, unb64, u32be, eq } from '../core/bytes.js';
import { sha256, aesDecrypt, importAes, rand } from '../core/crypto.js';
import { keyWorks } from '../core/embargo.js';
import { Bitfield } from '../core/bitfield.js';
import { buildManifest, verifyManifest, leafViews } from '../core/manifest.js';
import { planRequests, PeerStat, requestTimeoutMs } from '../core/scheduler.js';
import { decodeFrame, encodeFrame, fragments, FT, Assembler } from '../core/frames.js';
import * as store from './store.js';

const MAX_OUT = 16;            // max outstanding chunk requests per peer
const ASM_MAX = 2 * 1024 * 1024;

/** Transfer engine: chunk storage, request scheduling, serving uploads, verification, node fallback. */
export class Swarm extends Emitter {
  constructor({ identity, roomId, peers, signaling, nodeApi, getKey, getEpoch, isMember, settings }) {
    super();
    Object.assign(this, { identity, roomId, peers, signaling, nodeApi, getKey, getEpoch, isMember, settings });
    this.T = new Map(); this.byHandle = new Map(); this.nodeStat = new PeerStat(); this.adding = new Set();
    this.pendingUnlocks = new Map(); this.lastUpload = 0; this.tickN = 0; this.opt = null; this.optAt = 0; this.rejected = 0;
  }
  async load() {
    for (const m of await store.byIndex('manifests', 'room', this.roomId)) await this._register(m);
    this.timer = setInterval(() => this._tick(), 150);
    this.slow = setInterval(() => this._slowTick(), 2000);
  }
  stop() { clearInterval(this.timer); clearInterval(this.slow); }
  async _register(m) {
    const handle = parseInt(m.transferId.slice(0, 8), 16);
    if (this.byHandle.has(handle) || this.T.has(m.transferId)) return null;
    const rec = await store.get('chunkMap', m.transferId);
    const bits = new Bitfield(m.chunkCount, rec?.bits ? unb64(rec.bits) : undefined);
    const T = { m, tid: m.transferId, sk: rec?.sk ?? m.transferId, handle, n: m.chunkCount, leaf: leafViews(m), bits,
      state: bits.complete ? 'seeding' : rec?.state ?? 'queued', inflight: new Map(), meta: new Map(), nodeBits: null,
      bytesDown: 0, bytesUp: 0, fromPeers: 0, fromNode: 0, fileKey: null, fileKeyB64: null, released: false, startedAt: null, finishedAt: null, delta: [], dirty: false, speed: 0, _sb: 0, info: null, nodeSeeded: 0, nodeErr: null };
    const fk = await store.get('settings', 'fkey:' + m.transferId);
    if (fk) { T.fileKeyB64 = fk; T.fileKey = await importAes(unb64(fk)); T.released = !!(await store.get('settings', 'released:' + m.transferId)); }
    this.T.set(T.tid, T); this.byHandle.set(handle, T);
    if (this.pendingUnlocks.has(T.tid)) this._applyUnlock(T.tid);
    return T;
  }
  isUnlocked(T) {
    if (T.m.keyMode !== 'file' || T.fileKey) return true;
    const p = this.pendingUnlocks.get(T.tid);
    return !!p && p.author === T.m.authorPub;
  }
  /** Called when a signed 'unlock' message arrives (possibly before the manifest does). */
  offerUnlock(tid, author, keyB64) {
    if (typeof keyB64 !== 'string' || keyB64.length > 64) return;
    this.pendingUnlocks.set(tid, { author, key: keyB64 });
    this._applyUnlock(tid);
    this.emit('change');
  }
  async _applyUnlock(tid) {
    const T = this.T.get(tid), p = this.pendingUnlocks.get(tid);
    if (!T || !p || T.fileKey || T.m.keyMode !== 'file' || p.author !== T.m.authorPub) return;
    if (T.bits.has(0) && !(await keyWorks(p.key, await store.getChunk(T.sk, 0)))) { this.pendingUnlocks.delete(tid); this.emit('error', 'Ignored an unlock key that does not match ' + T.m.name); return; }
    T.fileKey = await importAes(unb64(p.key)); T.fileKeyB64 = p.key;
    await store.put('settings', p.key, 'fkey:' + tid);
    this.pendingUnlocks.delete(tid);
    this.emit('unlocked', T); this.emit('change');
  }
  async keyFor(T) {
    if (T.m.keyMode !== 'file') return this.getKey(T.m.keyEpoch);
    await this._applyUnlock(T.tid);
    return T.fileKey;
  }
  _persist(T) { T.dirty = false; return store.put('chunkMap', { bits: T.bits.toB64(), state: T.state, sk: T.sk }, T.tid); }

  /** Encrypt, chunk, hash, sign and publish a local file. */
  async share(file, { onProgress, embargoUntil = null } = {}) {
    const epoch = this.getEpoch();
    let key = this.getKey(epoch), keyMode = 'room', rawB64 = null;
    if (embargoUntil) {            // embargoed drop: the file gets its own key that only the author holds until release
      const raw = rand(32); key = await importAes(raw); keyMode = 'file'; rawB64 = b64(raw);
    }
    if (!key) throw new Error('Room key not available yet');
    const stage = 'local-' + crypto.randomUUID();
    const m = await buildManifest({ file, roomId: this.roomId, key, keyEpoch: epoch, identity: this.identity, onProgress, keyMode, embargoUntil,
      putChunk: (i, c) => store.putChunk(stage, i, c) });
    if (rawB64) await store.put('settings', rawB64, 'fkey:' + m.transferId);
    await store.put('manifests', m);
    await store.put('chunkMap', { bits: Bitfield.full(m.chunkCount).toB64(), state: 'seeding', sk: stage }, m.transferId);
    const T = await this._register(m);
    if (!T) throw new Error('This file is already shared in the room');
    this.signaling.request('manifest.publish', { manifest: m }, { room: this.roomId }).catch((e) => this.emit('error', 'Publish failed: ' + e.message));
    this._announce(T);
    for (const l of this.peers.open) this._sendHave(l, T);
    this._seedNode(T);
    this.emit('change');
    return T;
  }
  async addManifest(m) {
    if (!m || this.T.has(m.transferId) || this.adding.has(m.transferId)) return;
    this.adding.add(m.transferId);
    try {
      if (m.roomId !== this.roomId) return;
      const bad = await verifyManifest(m);
      if (bad || !this.isMember(m.authorPub)) { this.rejected++; this.emit('reject', m, bad || 'author-not-member'); return; }
      await store.put('manifests', m);
      const T = await this._register(m);
      if (!T) return;
      this.emit('change');
      if (this.settings.autoDownload && !T.bits.complete) this.start(T.tid);
    } finally { this.adding.delete(m.transferId); }
  }
  start(tid) {
    const T = this.T.get(tid);
    if (!T) return;
    T.state = T.bits.complete ? 'seeding' : 'downloading';
    T.startedAt ??= Date.now();
    this._persist(T); this._announce(T);
    for (const l of this.peers.open) this._sendHave(l, T);
    this._pollNode(T);
    this.emit('change');
  }
  pause(tid) { const T = this.T.get(tid); if (T && T.state === 'downloading') { T.state = 'paused'; this._persist(T); this.emit('change'); } }
  async remove(tid) {
    const T = this.T.get(tid);
    if (!T) return;
    this.T.delete(tid); this.byHandle.delete(T.handle);
    await store.del('manifests', tid); await store.del('chunkMap', tid); await store.dropChunks(T.sk);
    this.emit('change');
  }
  _li(l) {
    if (!l.sw) Object.assign(l, { sw: true, bits: new Map(), stat: new PeerStat(), asm: new Assembler(ASM_MAX), q: [], cancel: new Set(), downTotal: 0, upTotal: 0, weChoke: false, theyChoke: false, bad: 0, pumping: false });
    return l;
  }
  _sendHave(l, T) { if (T.bits.count) this.peers.send(l.id, { t: 'HAVE', transferId: T.tid, bitfield: T.bits.toB64() }); }
  onOpen(l) {
    this._li(l);
    for (const T of this.T.values()) {
      const s = JSON.stringify(T.m);
      if (s.length < 48000) this.peers.send(l.id, { t: 'MANIFEST', manifest: T.m });
      this._sendHave(l, T);
    }
    if (!this.settings.classroom) this._rechoke();
  }
  onClose(l) {
    if (!l.sw) return;
    for (const T of this.T.values()) for (const [idx, set] of [...T.inflight]) if (set.has(l.id)) this._clear(T, idx, l.id);
    l.asm.clear(); l.q.length = 0;
    this.emit('change');
  }
  onCtrl(l, m) {
    this._li(l);
    const T = m.transferId ? this.T.get(m.transferId) : null;
    switch (m.t) {
      case 'MANIFEST': this.addManifest(m.manifest); break;
      case 'HAVE':
        if (T && typeof m.bitfield === 'string' && m.bitfield.length <= 2 * ((T.n + 7) >> 3) + 8) l.bits.set(T.tid, Bitfield.fromB64(T.n, m.bitfield));
        break;
      case 'HAVE_DELTA': {
        if (!T || !Array.isArray(m.indices)) break;
        const bf = l.bits.get(T.tid) ?? new Bitfield(T.n);
        for (const i of m.indices.slice(0, 5000)) if (Number.isInteger(i)) bf.set(i);
        l.bits.set(T.tid, bf);
        break;
      }
      case 'REQUEST':
        if (!T || !Array.isArray(m.indices)) break;
        if (l.weChoke) { this.peers.send(l.id, { t: 'CHOKE' }); break; }
        for (const idx of m.indices.slice(0, MAX_OUT)) if (Number.isInteger(idx) && idx >= 0 && idx < T.n) l.q.push({ T, idx });
        this._pump(l);
        break;
      case 'CANCEL':
        if (!T || !Array.isArray(m.indices)) break;
        for (const idx of m.indices.slice(0, MAX_OUT)) { const k = T.tid + ':' + idx; const j = l.q.findIndex((x) => x.T === T && x.idx === idx); if (j >= 0) l.q.splice(j, 1); else l.cancel.add(k); }
        break;
      case 'CHOKE':
        l.theyChoke = true;
        for (const T2 of this.T.values()) for (const [idx, set] of [...T2.inflight]) if (set.has(l.id)) this._clear(T2, idx, l.id);
        break;
      case 'UNCHOKE': l.theyChoke = false; break;
      default: break;
    }
  }
  async _pump(l) {
    if (l.pumping) return;
    l.pumping = true;
    try {
      while (l.q.length && l.open) {
        const { T, idx } = l.q.shift();
        if (l.cancel.delete(T.tid + ':' + idx)) continue;
        const chunk = T.bits.has(idx) ? await store.getChunk(T.sk, idx) : null;
        if (!chunk) { await this.peers.sendData(l, encodeFrame({ type: FT.PIECE_NACK, handle: T.handle, index: idx })); continue; }
        for (const f of fragments(T.handle, idx, chunk)) await this.peers.sendData(l, f);
        T.bytesUp += chunk.length; l.upTotal += chunk.length; this.lastUpload = Date.now();
      }
    } catch { /* link closed mid-send */ } finally { l.pumping = false; }
  }
  onData(l, buf) {
    this._li(l);
    const f = decodeFrame(buf);
    if (!f) return;
    const T = this.byHandle.get(f.handle);
    if (!T || f.index >= T.n) return;
    if (f.type === FT.PIECE_NACK) { l.bits.get(T.tid)?.clear(f.index); this._clear(T, f.index, l.id); return; }
    if (f.type !== FT.PIECE || !T.inflight.get(f.index)?.has(l.id)) return; // unsolicited or cancelled
    const done = l.asm.push(f);
    if (done) this._onChunk(T, f.index, done.data, l.id, l);
  }
  _clear(T, idx, pid) {
    const s = T.inflight.get(idx);
    if (s) { s.delete(pid); if (!s.size) T.inflight.delete(idx); }
    T.meta.delete(idx + ':' + pid);
  }
  async _onChunk(T, idx, bytes, pid, link) {
    const meta = T.meta.get(idx + ':' + pid);
    this._clear(T, idx, pid);
    const stat = link ? link.stat : this.nodeStat;
    if (T.bits.has(idx)) return;
    if (!eq(await sha256(bytes), T.leaf[idx])) {            // integrity: hash of the ciphertext chunk vs signed manifest
      stat.fail();
      if (link && ++link.bad >= 5) { this.peers.ban(link.id); this.emit('ban', link.id); }
      this.emit('bad-chunk', pid); this.emit('change');
      return;
    }
    await store.putChunk(T.sk, idx, bytes);
    if (!T.bits.set(idx)) return;
    T.bytesDown += bytes.length; if (link) { link.downTotal += bytes.length; T.fromPeers += bytes.length; } else T.fromNode += bytes.length;
    stat.record(bytes.length, Date.now() - (meta?.t0 ?? Date.now()));
    T.delta.push(idx); T.dirty = true;
    const others = T.inflight.get(idx);
    if (others) {                                            // endgame: cancel duplicate requests
      for (const o of others) { this.peers.send(o, { t: 'CANCEL', transferId: T.tid, indices: [idx] }); this.peers.links.get(o)?.asm?.drop(T.handle, idx); T.meta.delete(idx + ':' + o); }
      T.inflight.delete(idx);
    }
    if (T.bits.complete) this._complete(T);
    this.emit('change');
  }
  _complete(T) {
    T.state = 'seeding'; T.finishedAt = Date.now();
    this._persist(T); this._announce(T);
    this.emit('complete', T);
  }
  _schedule(T) {
    const peers = [], now = Date.now();
    const count = (id) => { let c = 0; for (const s of T.inflight.values()) if (s.has(id)) c++; return c; };
    for (const l of this.peers.open) {
      const bits = l.bits?.get(T.tid);
      if (!bits || l.theyChoke) continue;
      peers.push({ id: l.id, bits, stat: l.stat, free: Math.max(0, MAX_OUT - count(l.id)) });
    }
    if (this.settings.useNode && T.nodeBits) peers.push({ id: 'node', isNode: true, bits: T.nodeBits, stat: this.nodeStat, free: Math.max(0, 4 - count('node')) });
    if (!peers.length || !peers.some((p) => p.free > 0)) return;
    const plan = planRequests({ have: T.bits, peers, inflight: T.inflight, peerSelect: this.settings.peerSelect, pieceSelect: this.settings.pieceSelect, epsilon: 0.1 });
    for (const [pid, idxs] of plan) {
      const link = this.peers.links.get(pid);
      const stat = link?.stat ?? this.nodeStat;
      const to = requestTimeoutMs(link?.rtt ?? 100, T.m.chunkSize, stat.ewma);
      for (const idx of idxs) {
        (T.inflight.get(idx) ?? T.inflight.set(idx, new Set()).get(idx)).add(pid);
        T.meta.set(idx + ':' + pid, { t0: now, deadline: now + to });
        if (pid === 'node') this._fetchNode(T, idx);
      }
      if (pid !== 'node') this.peers.send(pid, { t: 'REQUEST', transferId: T.tid, indices: idxs });
    }
  }
  _fetchNode(T, idx) {
    this.nodeApi.getChunk(T.tid, idx).then((b) => this._onChunk(T, idx, b, 'node', null)).catch(() => { this._clear(T, idx, 'node'); this.nodeStat.fail(); });
  }
  _pollNode(T) {
    if (!this.settings.useNode || T.bits.complete) return;
    this.nodeApi.bitfield(T.tid).then((r) => { T.nodeBits = Bitfield.fromB64(T.n, r.bitfield); T.nodeCount = r.count; }).catch(() => { T.nodeBits = null; });
  }
  async _seedNode(T) {
    if (!this.settings.seedToNode) return;
    try {
      const r = await this.nodeApi.bitfield(T.tid).catch(() => ({ bitfield: new Bitfield(T.n).toB64() }));
      const have = Bitfield.fromB64(T.n, r.bitfield);
      const todo = []; for (let i = 0; i < T.n; i++) if (!have.has(i)) todo.push(i);
      T.nodeSeeded = T.n - todo.length;
      await Promise.all(Array.from({ length: 3 }, async () => {
        for (let i = todo.shift(); i !== undefined; i = todo.shift()) {
          await this.nodeApi.putChunk(T.tid, i, await store.getChunk(T.sk, i));
          T.nodeSeeded++; this.emit('change');
        }
      }));
      T.nodeErr = null;
    } catch (e) { T.nodeErr = e.message; this.emit('change'); }
  }
  _announce(T) { if (T.bits.count) this.signaling.send('tracker.announce', { transferId: T.tid, bitfield: T.bits.toB64() }, { room: this.roomId }); }
  onTracker(body) {
    const T = this.T.get(body.transferId);
    if (!T) return;
    T.info = { peers: body.peers.length, seeders: body.peers.filter((p) => new Bitfield(T.n, unb64(p.bitfield || '')).complete).length };
    for (const p of body.peers) this.peers.ensure(p.peerId);
  }
  _rechoke() {
    const open = this.peers.open.map((l) => this._li(l));
    if (this.settings.classroom) { for (const l of open) if (l.weChoke) { l.weChoke = false; this.peers.send(l.id, { t: 'UNCHOKE' }); } return; }
    const top = new Set(open.slice().sort((a, b) => b.downTotal - a.downTotal).slice(0, 4).map((l) => l.id));
    if (Date.now() - this.optAt > 30000 || !this.peers.links.has(this.opt)) {
      const rest = open.filter((l) => !top.has(l.id));
      this.opt = rest.length ? rest[Math.floor(Math.random() * rest.length)].id : null; this.optAt = Date.now();
    }
    if (this.opt) top.add(this.opt);
    for (const l of open) { const choke = !top.has(l.id); if (choke !== l.weChoke) { l.weChoke = choke; this.peers.send(l.id, { t: choke ? 'CHOKE' : 'UNCHOKE' }); } }
  }
  _tick() {
    this.tickN++;
    for (const T of this.T.values()) {
      if (T.state === 'downloading') this._schedule(T);
      if (T.delta.length) { const msg = { t: 'HAVE_DELTA', transferId: T.tid, indices: T.delta.splice(0, 5000) }; for (const l of this.peers.open) this.peers.send(l.id, msg); }
      if (this.tickN % 7 === 0) { T.speed = (T.bytesDown + T.bytesUp - T._sb) / 1.05; T._sb = T.bytesDown + T.bytesUp; if (T.dirty) this._persist(T); this.emit('change'); }
    }
  }
  _slowTick() {
    const now = Date.now(); this.slowN = (this.slowN || 0) + 1;
    for (const T of this.T.values()) {
      for (const [k, meta] of [...T.meta]) {
        if (now > meta.deadline) {
          const cut = k.lastIndexOf(':'), idx = +k.slice(0, cut), pid = k.slice(cut + 1);
          this._clear(T, idx, pid);
          (pid === 'node' ? this.nodeStat : this.peers.links.get(pid)?.stat)?.fail();
        }
      }
      if (T.state === 'downloading' && this.slowN % 3 === 0) this._pollNode(T);
      if (this.slowN % 7 === 0 && T.bits.count) this._announce(T);
    }
    if (this.slowN % 5 === 0) this._rechoke();
  }
  /** Decrypt chunk by chunk and save. Uses the File System Access API when available (no RAM spike). */
  async saveFile(tid) {
    const T = this.T.get(tid);
    if (!T?.bits.complete) throw new Error('Transfer is not complete');
    if (!this.isUnlocked(T)) throw new Error('This file is still locked. The author releases it at the unlock time.');
    const key = await this.keyFor(T);
    if (!key) throw new Error(T.m.keyMode === 'file' ? 'No unlock key yet' : 'No key for epoch ' + T.m.keyEpoch + ' (you joined after this file was shared)');
    let writable = null;
    if (window.showSaveFilePicker) {
      try { writable = await (await window.showSaveFilePicker({ suggestedName: T.m.name })).createWritable(); }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const parts = [];
    for (let i = 0; i < T.n; i++) {
      const plain = await aesDecrypt(key, await store.getChunk(T.sk, i), u32be(i));
      if (writable) await writable.write(plain); else parts.push(plain);
    }
    if (writable) { await writable.close(); return; }
    const url = URL.createObjectURL(new Blob(parts, { type: T.m.mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: T.m.name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
