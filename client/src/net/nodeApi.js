import { signStr } from '../core/crypto.js';

/** HTTP client for the Campus Node chunk cache. Every request is signed by the member's key. */
export class NodeApi {
  constructor(identity) { this.id = identity; }
  async _h(method, path) {
    const ts = Date.now();
    return { 'x-cw-auth': `${this.id.peerId}.${ts}.${await signStr(this.id.signKey, `${method}\n${path}\n${ts}`)}` };
  }
  async getChunk(tid, idx) {
    const path = `/api/chunks/${tid}/${idx}`;
    const r = await fetch(path, { headers: await this._h('GET', path) });
    if (!r.ok) throw new Error('node ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  async putChunk(tid, idx, u8) {
    const path = `/api/chunks/${tid}/${idx}`;
    const r = await fetch(path, { method: 'PUT', headers: { ...(await this._h('PUT', path)), 'content-type': 'application/octet-stream' }, body: u8 });
    if (!r.ok) throw new Error('node ' + r.status);
  }
  async bitfield(tid) {
    const path = `/api/chunks/${tid}`;
    const r = await fetch(path, { headers: await this._h('GET', path) });
    if (!r.ok) throw new Error('node ' + r.status);
    return r.json();
  }
}
