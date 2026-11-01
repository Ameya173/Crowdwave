import { b64, unb64, concat, enc, base32 } from './bytes.js';

const subtle = globalThis.crypto.subtle;
export const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export async function sha256(d) { return new Uint8Array(await subtle.digest('SHA-256', d)); }

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };

/** pub = base64( signPublicRaw(65) || dhPublicRaw(65) ). peerId = base32(sha256(pub)[0..16]). */
export async function generateIdentity() {
  const sign = await subtle.generateKey(ECDSA, false, ['sign', 'verify']);
  const dh = await subtle.generateKey(ECDH, false, ['deriveBits']);
  const sRaw = new Uint8Array(await subtle.exportKey('raw', sign.publicKey));
  const dRaw = new Uint8Array(await subtle.exportKey('raw', dh.publicKey));
  const pub = b64(concat(sRaw, dRaw));
  return { signKey: sign.privateKey, dhKey: dh.privateKey, pub, peerId: await peerIdOf(pub), name: '' };
}
export function splitPub(pub) {
  const u = unb64(pub);
  if (u.length !== 130) throw new Error('bad public key');
  return { sign: u.subarray(0, 65), dh: u.subarray(65) };
}
export async function peerIdOf(pub) { return base32((await sha256(unb64(pub))).subarray(0, 16)); }

const vcache = new Map();
async function verifyKey(pub) {
  let k = vcache.get(pub);
  if (!k) {
    k = await subtle.importKey('raw', splitPub(pub).sign, ECDSA, false, ['verify']);
    if (vcache.size > 500) vcache.clear();
    vcache.set(pub, k);
  }
  return k;
}
export async function sign(priv, bytes) { return b64(new Uint8Array(await subtle.sign(SIG, priv, bytes))); }
export async function verify(pub, bytes, sigB64) {
  try { return await subtle.verify(SIG, await verifyKey(pub), unb64(sigB64), bytes); } catch { return false; }
}
export const signStr = (priv, s) => sign(priv, enc.encode(s));
export const verifyStr = (pub, s, sig) => verify(pub, enc.encode(s), sig);

async function kek(myDh, theirPub, salt, info) {
  const theirDh = await subtle.importKey('raw', splitPub(theirPub).dh, ECDH, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: theirDh }, myDh, 256);
  const ikm = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Wrap a raw room key for one member (ECDH + HKDF + AES-GCM). ctx = `${roomId}:${epoch}` */
export async function wrapKey(myDh, theirPub, rawKey, ctx) {
  const k = await kek(myDh, theirPub, ctx, 'crowdwave-roomkey-v1');
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, rawKey));
  return b64(concat(iv, ct));
}
export async function unwrapKey(myDh, senderPub, envelope, ctx) {
  const k = await kek(myDh, senderPub, ctx, 'crowdwave-roomkey-v1');
  const u = unb64(envelope);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, k, u.subarray(12)));
}
export const importAes = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
export const newRoomKeyRaw = () => rand(32);
/** output = iv(12) || ciphertext+tag */
export async function aesEncrypt(key, pt, aad) {
  const iv = rand(12);
  const p = { name: 'AES-GCM', iv };
  if (aad) p.additionalData = aad;
  return concat(iv, new Uint8Array(await subtle.encrypt(p, key, pt)));
}
export async function aesDecrypt(key, data, aad) {
  const p = { name: 'AES-GCM', iv: data.subarray(0, 12) };
  if (aad) p.additionalData = aad;
  return new Uint8Array(await subtle.decrypt(p, key, data.subarray(12)));
}
/** Short authentication string: 4 groups of 4 digits, same on both devices. */
export async function sas(pubA, pubB) {
  const [a, b] = [pubA, pubB].sort();
  const h = await sha256(enc.encode(a + '|' + b));
  const g = [];
  for (let i = 0; i < 4; i++) g.push((((h[2 * i] << 8) | h[2 * i + 1]) % 10000).toString().padStart(4, '0'));
  return g.join(' ');
}
export const fmtId = (id) => (id || '').match(/.{1,4}/g)?.join(' ') ?? '';
