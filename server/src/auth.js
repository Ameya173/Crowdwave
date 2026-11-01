import crypto from 'node:crypto';

const subtle = crypto.webcrypto.subtle;
const A32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(u) {
  let bits = 0, val = 0, out = '';
  for (const b of u) { val = ((val << 8) | b) >>> 0; bits += 8; while (bits >= 5) { out += A32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A32[(val << (5 - bits)) & 31];
  return out;
}
export function parsePub(pub) {
  if (typeof pub !== 'string' || pub.length > 400) return null;
  const u = Buffer.from(pub, 'base64');
  return u.length === 130 && u[0] === 4 && u[65] === 4 ? u : null;
}
export const peerIdOf = (pub) => base32(crypto.createHash('sha256').update(Buffer.from(pub, 'base64')).digest().subarray(0, 16));
const keys = new Map();
export async function verifySig(pub, data, sigB64) {
  try {
    const raw = parsePub(pub);
    if (!raw) return false;
    let k = keys.get(pub);
    if (!k) {
      k = await subtle.importKey('raw', raw.subarray(0, 65), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (keys.size > 2000) keys.clear();
      keys.set(pub, k);
    }
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(sigB64, 'base64'), typeof data === 'string' ? Buffer.from(data) : data);
  } catch { return false; }
}
/** HTTP auth: header x-cw-auth = peerId.ts.signature over "METHOD\npath\nts" by an active member's key. */
export async function httpAuth(db, req) {
  const h = req.get('x-cw-auth');
  if (!h) return null;
  const [peerId, ts, sig] = h.split('.');
  if (!peerId || !sig || Math.abs(Date.now() - +ts) > 10 * 60 * 1000) return null;
  const rows = db.prepare("SELECT room_id, pub_key FROM members WHERE peer_id=? AND status='active'").all(peerId);
  if (!rows.length) return null;
  if (!(await verifySig(rows[0].pub_key, `${req.method}\n${req.path}\n${ts}`, sig))) return null;
  return { peerId, pub: rows[0].pub_key, rooms: new Set(rows.map((r) => r.room_id)) };
}
