import { b64, unb64 } from './bytes.js';
export class Bitfield {
  constructor(n, bytes) {
    this.n = n;
    this.bytes = new Uint8Array((n + 7) >> 3);
    if (bytes) this.bytes.set(bytes.subarray(0, this.bytes.length));
    this.count = 0;
    for (let i = 0; i < n; i++) if (this.has(i)) this.count++;
  }
  has(i) { return i >= 0 && i < this.n && (this.bytes[i >> 3] & (128 >> (i & 7))) !== 0; }
  set(i) {
    if (i < 0 || i >= this.n || this.has(i)) return false;
    this.bytes[i >> 3] |= 128 >> (i & 7);
    this.count++;
    return true;
  }
  clear(i) {
    if (!this.has(i)) return false;
    this.bytes[i >> 3] &= ~(128 >> (i & 7));
    this.count--;
    return true;
  }
  get complete() { return this.count === this.n; }
  toB64() { return b64(this.bytes); }
  static fromB64(n, s) { return new Bitfield(n, unb64(s)); }
  static full(n) { const b = new Bitfield(n); for (let i = 0; i < n; i++) b.set(i); return b; }
}
