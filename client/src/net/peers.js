import { Emitter } from '../core/bytes.js';

const HIGH_WATER = 1 << 20;
/** WebRTC mesh: one RTCPeerConnection per remote peer, each with a reliable `ctrl` and an unordered `data` channel. */
export class PeerManager extends Emitter {
  constructor({ me, signaling, roomId, maxPeers = 24 }) {
    super();
    Object.assign(this, { me, signaling, roomId, maxPeers });
    this.links = new Map(); this.banned = new Set();
    this.timer = setInterval(() => this._keepalive(), 10000);
  }
  get open() { return [...this.links.values()].filter((l) => l.open); }
  /** The peer with the lexicographically smaller id initiates; the other side waits for the offer. */
  ensure(peerId) {
    if (peerId === this.me || this.banned.has(peerId) || this.me > peerId) return;
    const l = this.links.get(peerId);
    if (l && l.state !== 'closed') return;
    if (this.links.size >= this.maxPeers) return;
    const link = this._create(peerId, true);
    this._offer(link).catch(() => this._close(link, true));
  }
  _create(id, initiator) {
    const old = this.links.get(id);
    if (old) this._close(old, false);
    const pc = new RTCPeerConnection({ iceServers: this.signaling.iceServers });
    const l = { id, pc, initiator, ctrl: null, data: null, open: false, state: 'new', connType: '…', rtt: 0, bytesUp: 0, bytesDown: 0, pendingIce: [], lastPong: Date.now(), remoteSet: false, created: Date.now() };
    this.links.set(id, l);
    pc.onicecandidate = (e) => { if (e.candidate) this.signaling.send('rtc.ice', { candidate: e.candidate.toJSON() }, { room: this.roomId, to: id }); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this._close(l, true);
      else if (s === 'disconnected') setTimeout(() => { if (pc.connectionState === 'disconnected') this._close(l, true); }, 6000);
    };
    pc.ondatachannel = (e) => this._wire(l, e.channel);
    if (initiator) { this._wire(l, pc.createDataChannel('ctrl')); this._wire(l, pc.createDataChannel('data', { ordered: false })); }
    l.timeout = setTimeout(() => { if (!l.open) this._close(l, true); }, 25000);
    return l;
  }
  async _offer(l) {
    await l.pc.setLocalDescription(await l.pc.createOffer());
    this.signaling.send('rtc.offer', { sdp: l.pc.localDescription.sdp }, { room: this.roomId, to: l.id });
  }
  _wire(l, dc) {
    dc.binaryType = 'arraybuffer';
    const label = dc.label;
    if (label === 'data') { dc.bufferedAmountLowThreshold = 512 * 1024; l.data = dc; } else l.ctrl = dc;
    dc.onopen = () => this._maybeOpen(l);
    dc.onclose = () => this._close(l, true);
    dc.onmessage = (e) => {
      if (label === 'ctrl') {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'ping') return this.send(l.id, { t: 'pong', n: m.n });
        if (m.t === 'pong') { l.rtt = Date.now() - m.n; l.lastPong = Date.now(); return; }
        this.emit('ctrl', l, m);
      } else { l.bytesDown += e.data.byteLength; l.lastData = Date.now(); this.emit('data', l, e.data); }
    };
    if (dc.readyState === 'open') this._maybeOpen(l);
  }
  _maybeOpen(l) {
    if (l.open || l.state === 'closed' || l.ctrl?.readyState !== 'open' || l.data?.readyState !== 'open') return;
    l.open = true; l.state = 'open'; l.lastPong = Date.now(); clearTimeout(l.timeout);
    this.emit('open', l);
    this._detectType(l);
  }
  async _detectType(l) {
    try {
      const stats = await l.pc.getStats();
      let pair = null;
      stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const t = [stats.get(pair.localCandidateId)?.candidateType, stats.get(pair.remoteCandidateId)?.candidateType];
      l.connType = t.includes('relay') ? 'relay' : t.every((x) => x === 'host') ? 'direct' : 'stun';
      this.emit('change');
    } catch { /* ignore */ }
  }
  async onSignal(m) {
    const from = m.from, body = m.body;
    try {
      if (m.t === 'rtc.offer') {
        if (this.banned.has(from) || (!this.links.has(from) && this.links.size >= this.maxPeers + 8)) return;
        const l = this._create(from, false);
        await l.pc.setRemoteDescription({ type: 'offer', sdp: body.sdp });
        l.remoteSet = true;
        for (const c of l.pendingIce.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        this.signaling.send('rtc.answer', { sdp: l.pc.localDescription.sdp }, { room: this.roomId, to: from });
      } else if (m.t === 'rtc.answer') {
        const l = this.links.get(from);
        if (!l || !l.initiator || l.remoteSet) return;
        await l.pc.setRemoteDescription({ type: 'answer', sdp: body.sdp });
        l.remoteSet = true;
        for (const c of l.pendingIce.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
      } else if (m.t === 'rtc.ice') {
        const l = this.links.get(from);
        if (!l || !body.candidate) return;
        if (l.remoteSet) await l.pc.addIceCandidate(body.candidate).catch(() => {}); else l.pendingIce.push(body.candidate);
      }
    } catch (e) { console.warn('[rtc]', e); const l = this.links.get(from); if (l) this._close(l, true); }
  }
  send(id, obj) { const l = this.links.get(id); if (l?.ctrl?.readyState === 'open') { try { l.ctrl.send(JSON.stringify(obj)); return true; } catch { /* closed */ } } return false; }
  async sendData(l, bytes) {
    const dc = l.data;
    while (dc && dc.readyState === 'open' && dc.bufferedAmount > HIGH_WATER) {
      await new Promise((r) => { const f = () => { dc.removeEventListener('bufferedamountlow', f); r(); }; dc.addEventListener('bufferedamountlow', f); setTimeout(f, 1500); });
    }
    if (!dc || dc.readyState !== 'open') throw new Error('data channel closed');
    dc.send(bytes); l.bytesUp += bytes.byteLength;
  }
  _keepalive() {
    for (const l of this.open) {
      if (Date.now() - l.lastPong > 35000) { this._close(l, true); continue; }
      this.send(l.id, { t: 'ping', n: Date.now() });
    }
  }
  _close(l, notify) {
    if (l.state === 'closed') return;
    const wasOpen = l.open;
    l.state = 'closed'; l.open = false; clearTimeout(l.timeout);
    try { l.ctrl?.close(); l.data?.close(); l.pc.close(); } catch { /* ignore */ }
    if (this.links.get(l.id) === l) this.links.delete(l.id);
    if (notify || wasOpen) this.emit('close', l, wasOpen);
  }
  close(id) { const l = this.links.get(id); if (l) this._close(l, true); }
  ban(id) { this.banned.add(id); this.close(id); }
  closeAll() { clearInterval(this.timer); for (const l of [...this.links.values()]) this._close(l, false); }
}
