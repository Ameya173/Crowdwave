export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export const hex = (u) => Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');
export function unhex(h) {
  const u = new Uint8Array(h.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16);
  return u;
}
export function concat(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
export function eq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const A32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function base32(u) {
  let bits = 0, val = 0, out = '';
  for (const b of u) {
    val = ((val << 8) | b) >>> 0;
    bits += 8;
    while (bits >= 5) { out += A32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A32[(val << (5 - bits)) & 31];
  return out;
}
export const u32be = (n) => { const u = new Uint8Array(4); new DataView(u.buffer).setUint32(0, n >>> 0); return u; };
export const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Emitter {
  constructor() { this._l = new Map(); }
  on(t, fn) { (this._l.get(t) ?? this._l.set(t, new Set()).get(t)).add(fn); return () => this._l.get(t)?.delete(fn); }
  emit(t, ...a) { for (const fn of [...(this._l.get(t) ?? [])]) { try { fn(...a); } catch (e) { console.error('[emit]', t, e); } } }
}
