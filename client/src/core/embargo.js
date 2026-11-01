// Embargoed drops: a file is encrypted with its own random key and distributed early; the author releases
// that key later (signed, encrypted gossip). Receipts are signed statements "this device holds the whole
// verified file", which let the author see readiness before release.
import { unb64, u32be } from './bytes.js';
import { importAes, aesDecrypt } from './crypto.js';

/** An unlock message is only honoured if it comes from the file's own author and names that transfer. */
export function validUnlock(manifest, authorPub, payload) {
  return !!manifest && manifest.keyMode === 'file' && manifest.authorPub === authorPub && payload?.k === 'unlock'
    && payload.tid === manifest.transferId && typeof payload.key === 'string' && payload.key.length > 0 && payload.key.length <= 64;
}
/** Does this raw key (base64) decrypt chunk 0? Used to reject a bogus key before persisting it. */
export async function keyWorks(rawB64, cipherChunk0) {
  try { await aesDecrypt(await importAes(unb64(rawB64)), cipherChunk0, u32be(0)); return true; } catch { return false; }
}
/** receipts: Map<peerId,{root,at}> for one transfer. A receipt only counts if its Merkle root matches the manifest. */
export function coverage(manifest, receipts, members, authorPeerId) {
  const rows = members.filter((m) => m.status === 'active' && m.peerId !== authorPeerId).map((m) => {
    const r = receipts?.get(m.peerId), ok = !!r && r.root === manifest.merkleRoot;
    return { name: m.name || 'Unnamed device', peerId: m.peerId, ready: ok, at: ok ? r.at : null };
  });
  return { ready: rows.filter((r) => r.ready).length, total: rows.length, rows };
}
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(file, rows) {
  const head = 'file,name,device_id,status,received_at_iso';
  return [head, ...rows.map((r) => [file, r.name, r.peerId, r.ready ? 'verified' : 'pending', r.at ? new Date(r.at).toISOString() : ''].map(cell).join(','))].join('\n') + '\n';
}
