import { Emitter } from '../core/bytes.js';
import { signStr } from '../core/crypto.js';

export class Signaling extends Emitter {
  constructor(identity) {
    super();
    this.id = identity; this.ws = null; this.state = 'idle'; this.pending = new Map(); this.retry = 0; this.iceServers = []; this.closed = false;
  }
  url() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; }
  connect() {
    if (this.closed) return;
    this.state = 'connecting'; this.emit('state');
    const ws = (this.ws = new WebSocket(this.url()));
    ws.onmessage = (e) => this._onMsg(e.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.state = 'offline'; this.emit('state'); this.emit('offline');
      for (const p of this.pending.values()) p.rej(new Error('disconnected'));
      this.pending.clear();
      if (!this.closed) setTimeout(() => this.connect(), Math.min(15000, 500 * 2 ** this.retry++));
    };
  }
  async _onMsg(raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'challenge') {
      const sig = await signStr(this.id.signKey, 'crowdwave-auth-v1\n' + m.body.nonce);
      this._raw({ v: 1, t: 'hello', id: crypto.randomUUID(), ts: Date.now(), body: { pubKey: this.id.pub, nonceResponse: sig, name: this.id.name || '', capabilities: { webrtc: true } } });
    } else if (m.t === 'welcome') {
      this.state = 'ready'; this.retry = 0; this.iceServers = m.body.iceServers || []; this.emit('state'); this.emit('ready', m.body);
    } else if (m.t === 'ack') {
      const p = this.pending.get(m.body.re);
      if (!p) return;
      this.pending.delete(m.body.re);
      if (m.body.ok) p.res(m.body); else p.rej(Object.assign(new Error(m.body.error || 'error'), { code: m.body.error }));
    } else { this.emit(m.t, m); }
  }
  _raw(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  send(t, body = {}, { room, to } = {}) { this._raw({ v: 1, t, id: crypto.randomUUID(), room, to, ts: Date.now(), body }); }
  request(t, body = {}, { room } = {}) {
    return new Promise((res, rej) => {
      if (this.ws?.readyState !== 1 || this.state !== 'ready') return rej(new Error('offline'));
      const id = crypto.randomUUID();
      const to = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout')); }, 15000);
      this.pending.set(id, { res: (v) => { clearTimeout(to); res(v); }, rej: (e) => { clearTimeout(to); rej(e); } });
      this._raw({ v: 1, t, id, room, ts: Date.now(), body });
    });
  }
  whenReady() { return this.state === 'ready' ? Promise.resolve() : new Promise((r) => { const off = this.on('ready', () => { off(); r(); }); }); }
  setName(n) { this.id.name = n; }
  close() { this.closed = true; this.ws?.close(); }
}
