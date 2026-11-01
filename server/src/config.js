import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of [path.join(here, '..', '.env'), path.join(process.cwd(), '.env')]) { try { process.loadEnvFile?.(f); } catch { /* no .env */ } }
const e = process.env;
export const cfg = {
  port: +e.PORT || 8787,
  dataDir: path.resolve(e.DATA_DIR || path.join(here, '..', 'data')),
  clientDist: path.resolve(e.CLIENT_DIST || path.join(here, '..', '..', 'client', 'dist')),
  cacheBytes: (+e.CACHE_MB || 2048) * 1048576,
  https: process.argv.includes('--https') || e.HTTPS === '1',
  offline: e.CW_OFFLINE === '1',
  trustProxy: e.TRUST_PROXY === '1',
  maxRoomMembers: +e.MAX_ROOM_MEMBERS || 300,
  csp: e.CSP !== 'off',
};
export function iceServers(peerId) {
  let list = [];
  if (e.ICE_SERVERS) { try { list = JSON.parse(e.ICE_SERVERS); } catch { console.warn('ICE_SERVERS is not valid JSON'); } }
  else if (!cfg.offline) list = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (e.TURN_URL && e.TURN_SECRET) {   // coturn "use-auth-secret" ephemeral credentials
    const username = `${Math.floor(Date.now() / 1000) + 86400}:${peerId}`;
    list.push({ urls: e.TURN_URL.split(','), username, credential: crypto.createHmac('sha1', e.TURN_SECRET).update(username).digest('base64') });
  }
  return list;
}
