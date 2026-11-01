// Binary chunk frame, 16-byte big-endian header + payload:
//  0 version | 1 type | 2-3 flags | 4-7 transfer handle | 8-11 chunk index | 12-15 fragment offset | payload
// (The spec's "payload length" field is implied by the message length; the freed bytes carry the
//  fragment offset so unordered sub-fragments can be reassembled.)
export const FT = { PIECE: 1, PIECE_NACK: 2 };
export const FLAG = { ENC: 1, LAST: 2 };
export const HDR = 16;
export const FRAG = 16 * 1024;

export function encodeFrame({ type, flags = 0, handle, index, offset = 0, payload = new Uint8Array(0) }) {
  const out = new Uint8Array(HDR + payload.length);
  const dv = new DataView(out.buffer);
  out[0] = 1; out[1] = type;
  dv.setUint16(2, flags); dv.setUint32(4, handle >>> 0); dv.setUint32(8, index >>> 0); dv.setUint32(12, offset >>> 0);
  out.set(payload, HDR);
  return out;
}
export function decodeFrame(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u.length < HDR || u[0] !== 1) return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  return { type: u[1], flags: dv.getUint16(2), handle: dv.getUint32(4), index: dv.getUint32(8), offset: dv.getUint32(12), payload: u.subarray(HDR) };
}
export function* fragments(handle, index, chunk) {
  for (let off = 0; ; off += FRAG) {
    const end = Math.min(off + FRAG, chunk.length);
    const last = end >= chunk.length;
    yield encodeFrame({ type: FT.PIECE, flags: FLAG.ENC | (last ? FLAG.LAST : 0), handle, index, offset: off, payload: chunk.subarray(off, end) });
    if (last) break;
  }
}
/** Reassembles sub-fragments that may arrive in any order. */
export class Assembler {
  constructor(maxChunk) { this.max = maxChunk; this.m = new Map(); }
  push(f) {
    const key = f.handle + ':' + f.index;
    let e = this.m.get(key);
    if (!e) { e = { parts: new Map(), got: 0, total: -1 }; this.m.set(key, e); }
    if (e.parts.has(f.offset)) return null;
    e.parts.set(f.offset, f.payload);
    e.got += f.payload.length;
    if (f.flags & FLAG.LAST) e.total = f.offset + f.payload.length;
    if (e.got > this.max || e.parts.size > Math.ceil(this.max / FRAG) + 2) { this.m.delete(key); return null; }
    if (e.total >= 0 && e.got === e.total) {
      this.m.delete(key);
      const out = new Uint8Array(e.total);
      for (const [o, p] of e.parts) { if (o + p.length > e.total) return null; out.set(p, o); }
      return { handle: f.handle, index: f.index, data: out };
    }
    return null;
  }
  drop(handle, index) { this.m.delete(handle + ':' + index); }
  clear() { this.m.clear(); }
}
