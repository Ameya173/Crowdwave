import { b64, unb64, hex, concat, enc, u32be, eq } from './bytes.js';
import { sha256, sign, verify, aesEncrypt } from './crypto.js';
import { canon } from './canon.js';
import { merkleRoot } from './merkle.js';

export const CHUNK_DEFAULT = 256 * 1024;
export const CHUNK_LARGE = 1024 * 1024;
export const chunkSizeFor = (size) => (size > 200 * 1024 * 1024 ? CHUNK_LARGE : CHUNK_DEFAULT);
const unsigned = (m) => { const { signature, ...rest } = m; return rest; };

export async function computeTransferId(merkleRootB64, name, size, authorPub) {
  return hex(await sha256(enc.encode(canon({ merkleRoot: merkleRootB64, name, size, authorPub }))));
}

/** Encrypts + hashes a File chunk by chunk. putChunk(idx, ciphertext) is awaited for each chunk. */
export async function buildManifest({ file, roomId, key, keyEpoch, identity, putChunk, onProgress, expiresAt, keyMode = 'room', embargoUntil = null }) {
  const chunkSize = chunkSizeFor(file.size);
  const chunkCount = Math.max(1, Math.ceil(file.size / chunkSize));
  const leaves = [];
  for (let i = 0; i < chunkCount; i++) {
    const plain = new Uint8Array(await file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize)).arrayBuffer());
    const cipher = await aesEncrypt(key, plain, u32be(i));
    leaves.push(await sha256(cipher));
    await putChunk(i, cipher);
    onProgress?.(i + 1, chunkCount);
  }
  const root = b64(await merkleRoot(leaves));
  const m = {
    v: 1, roomId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
    chunkSize, chunkCount, leafHashes: b64(concat(...leaves)), merkleRoot: root, keyEpoch,
    authorPub: identity.pub, createdAt: Date.now(), expiresAt: expiresAt ?? null, keyMode, embargoUntil: embargoUntil ?? null,
  };
  m.transferId = await computeTransferId(root, m.name, m.size, m.authorPub);
  m.signature = await sign(identity.signKey, enc.encode(canon(unsigned(m))));
  return m;
}

/** Returns null if valid, otherwise a reason string. */
export async function verifyManifest(m) {
  try {
    if (!m || m.v !== 1) return 'bad-version';
    if (!Number.isInteger(m.size) || m.size < 0 || !Number.isInteger(m.chunkSize) || m.chunkSize < 1024 || m.chunkSize > 8 * 1024 * 1024) return 'bad-size';
    if (m.chunkCount !== Math.max(1, Math.ceil(m.size / m.chunkSize)) || m.chunkCount > 100000) return 'bad-chunk-count';
    const lh = unb64(m.leafHashes);
    if (lh.length !== m.chunkCount * 32) return 'bad-leaves';
    const leaves = Array.from({ length: m.chunkCount }, (_, i) => lh.subarray(i * 32, i * 32 + 32));
    if (b64(await merkleRoot(leaves)) !== m.merkleRoot) return 'bad-root';
    if (m.transferId !== (await computeTransferId(m.merkleRoot, m.name, m.size, m.authorPub))) return 'bad-id';
    if (m.keyMode !== 'room' && m.keyMode !== 'file') return 'bad-keymode';
    if (m.embargoUntil != null && !Number.isFinite(m.embargoUntil)) return 'bad-embargo';
    if (m.expiresAt && m.expiresAt < Date.now()) return 'expired';
    if (!(await verify(m.authorPub, enc.encode(canon(unsigned(m))), m.signature))) return 'bad-signature';
    return null;
  } catch { return 'malformed'; }
}
export const leafViews = (m) => { const lh = unb64(m.leafHashes); return Array.from({ length: m.chunkCount }, (_, i) => lh.subarray(i * 32, i * 32 + 32)); };
export const sameHash = eq;
