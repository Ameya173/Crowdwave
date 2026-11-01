import { Emitter, b64, unb64, hex, enc } from '../core/bytes.js';
import { sha256, rand, wrapKey, unwrapKey, importAes, newRoomKeyRaw, peerIdOf } from '../core/crypto.js';
import { Gossip, openMessage } from '../core/gossip.js';
import { lexVec, clusterItems, loadMiniLM } from '../core/cluster.js';
import { PeerManager } from './peers.js';
import { Swarm } from './swarm.js';
import { NodeApi } from './nodeApi.js';
import { coverage as coverageOf } from '../core/embargo.js';
import * as store from './store.js';

const DEFAULTS = { autoDownload: true, useNode: true, seedToNode: true, classroom: true, peerSelect: 'bandit', pieceSelect: 'rarest', ai: false, thrLex: 0.35, thrAi: 0.6 };

/** Everything that belongs to one open room: membership, keys, peers, swarm, gossip. */
export class RoomSession extends Emitter {
  constructor({ identity, signaling, record }) {
    super();
    Object.assign(this, { identity, signaling, rec: record, roomId: record.roomId });
    this.status = 'connecting'; this.error = null;
    this.members = new Map(); this.online = new Set(); this.pending = []; this.feed = [];
    this.keys = new Map(); this.raw = new Map(); this.epoch = record.keyEpoch || 1;
    this.receipts = new Map(); this.postedReceipt = new Set(); this.wake = null; this.votes = new Map(); this.vecs = new Map(); this.aiState = 'off'; this._off = [];
  }
  get isOwner() { return this.rec.role === 'owner'; }
  get me() { return this.identity.peerId; }
  async start() {
    this.settings = { ...DEFAULTS, ...((await store.get('settings', 'room:' + this.roomId)) || {}) };
    for (const [e, b] of Object.entries(this.rec.keys || {})) await this._setKey(+e, unb64(b), false);
    this.nodeApi = new NodeApi(this.identity);
    this.peers = new PeerManager({ me: this.me, signaling: this.signaling, roomId: this.roomId });
    this.swarm = new Swarm({ identity: this.identity, roomId: this.roomId, peers: this.peers, signaling: this.signaling, nodeApi: this.nodeApi,
      getKey: (e) => this.keys.get(e), getEpoch: () => this.epoch, isMember: (pub) => this.members.get(pub)?.status === 'active', settings: this.settings });
    this.gossip = new Gossip({ room: this.roomId, identity: this.identity, store, getMembers: () => this.members, getKey: (e) => this.keys.get(e), getEpoch: () => this.epoch,
      getLinks: () => this.peers.open, send: (l, m) => this.peers.send(l.id, m), relay: (m) => this.signaling.send('msg.put', { msg: m }, { room: this.roomId }),
      onMessage: (m) => this._decode(m) });
    this._wire();
    await this.swarm.load();
    this.swarm.on('complete', (T) => this.postReceipt(T));
    this._timer = setInterval(() => this._everySecond(), 1000);
    if (this.signaling.state === 'ready') this.join(); else this.status = 'connecting';
  }
  _wire() {
    const s = this.signaling, on = (t, fn) => this._off.push(s.on(t, (m) => { if (!m.body?.roomId || m.body.roomId === this.roomId) fn(m); }));
    this._off.push(s.on('ready', () => this.join()));
    this._off.push(s.on('offline', () => { this.online.clear(); this.emit('change'); }));
    on('room.joinRequest', ({ body }) => this._onJoinRequest(body));
    on('room.joinResult', ({ body }) => { if (body.approved) this.join(); else { this.status = 'rejected'; this.emit('change'); } });
    on('room.rekey', ({ body }) => this._onRekey(body));
    on('room.removed', () => { this.status = 'removed'; this.peers.closeAll(); this.emit('change'); });
    on('member.update', ({ body }) => { for (const m of this.members.values()) if (m.peerId === body.peerId) m.role = body.role; if (body.peerId === this.me) this.rec.role = body.role; this.emit('change'); });
    on('peer.joined', ({ body }) => {
      this.members.set(body.pubKey, { peerId: body.peerId, pub: body.pubKey, name: body.name, role: body.role, status: 'active' });
      this.online.add(body.peerId); this.peers.ensure(body.peerId); this.emit('change');
    });
    on('peer.left', ({ body }) => { this.online.delete(body.peerId); this.emit('change'); });
    on('manifest.new', ({ body }) => this.swarm.addManifest(body.manifest));
    on('msg.new', ({ body }) => this.gossip.ingest(body.msg, 'node'));
    on('tracker.peers', ({ body }) => this.swarm.onTracker(body));
    for (const t of ['rtc.offer', 'rtc.answer', 'rtc.ice']) this._off.push(s.on(t, (m) => this.peers.onSignal(m)));
    this.peers.on('open', (l) => { this.swarm.onOpen(l); this.peers.send(l.id, { t: 'SYNC_SUMMARY', summary: this.gossip.summary() }); this.emit('change'); });
    this.peers.on('ctrl', (l, m) => { this.swarm.onCtrl(l, m); this._onCtrl(l, m); });
    this.peers.on('data', (l, b) => this.swarm.onData(l, b));
    this.peers.on('close', (l) => {
      this.swarm.onClose(l); this.emit('change');
      if (this.online.has(l.id) && this.status === 'active') setTimeout(() => this.peers.ensure(l.id), 3000 + Math.random() * 3000);
    });
    this.peers.on('change', () => this.emit('change'));
    this.swarm.on('change', () => this.emit('change'));
    this.swarm.on('error', (e) => { this.error = e; this.emit('change'); });
  }
  _onCtrl(l, m) {
    if (m.t === 'MSG') this.gossip.ingest(m.msg, l.id, { sync: !!m.sync });
    else if (m.t === 'SYNC_SUMMARY') this.gossip.onSummary(l, m.summary);
    else if (m.t === 'SYNC_PULL') this.gossip.onPull(l, m.wants);
    else if (m.t === 'BYE') this.peers.close(l.id);
  }
  async join() {
    try {
      const r = await this.signaling.request('room.join', { roomId: this.roomId, name: this.identity.name }, { room: this.roomId });
      if (r.status === 'pending') { this.status = 'pending'; this.error = null; return this.emit('change'); }
      const room = r.room;
      if (this.rec.pinOwner && (await peerIdOf(room.ownerPub)) !== this.rec.pinOwner) {
        this.status = 'error'; this.error = 'The room owner’s fingerprint does not match the invite. Joining was stopped.'; return this.emit('change');
      }
      Object.assign(this.rec, { name: room.name, ownerPub: room.ownerPub, role: r.role, openJoin: room.openJoin, expiresAt: room.expiresAt });
      this.members.clear();
      for (const m of r.members) this.members.set(m.pub, m);
      this.epoch = room.keyEpoch;
      if (!this.isOwner && r.envelope && !this.keys.has(r.envelopeEpoch)) {
        await this._setKey(r.envelopeEpoch, await unwrapKey(this.identity.dhKey, room.ownerPub, r.envelope, `${this.roomId}:${r.envelopeEpoch}`), true);
      }
      this.rec.keyEpoch = room.keyEpoch; await store.put('rooms', this.rec);
      this.pending = r.pending || [];
      this.online = new Set(r.online);
      for (const id of r.online) this.peers.ensure(id);
      for (const m of r.manifests) await this.swarm.addManifest(m);
      for (const m of r.messages) await this.gossip.ingest(m, 'node', { sync: true });
      if (!this.gossipLoaded) { this.gossipLoaded = true; await this.gossip.load(); }
      this.status = 'active'; this.error = null;
      for (const T of this.swarm.T.values()) this.swarm._announce(T);
      setTimeout(() => { for (const T of this.swarm.T.values()) if (T.bits.complete && T.m.authorPub !== this.identity.pub && !this.receipts.get(T.tid)?.has(this.me)) this.postReceipt(T); }, 2000);
      this.emit('change');
    } catch (e) {
      if (e.code === 'forbidden') this.status = 'removed'; else if (e.message !== 'offline' && e.message !== 'disconnected') { this.status = 'error'; this.error = e.code ? 'Server said: ' + e.code : e.message; }
      this.emit('change');
    }
  }
  async _setKey(epoch, raw, persist) {
    this.raw.set(epoch, raw); this.keys.set(epoch, await importAes(raw));
    if (persist) { (this.rec.keys ??= {})[epoch] = b64(raw); await store.put('rooms', this.rec); }
  }
  async _onRekey(b) {
    try {
      const raw = await unwrapKey(this.identity.dhKey, this.rec.ownerPub, b.envelope, `${this.roomId}:${b.epoch}`);
      await this._setKey(b.epoch, raw, true); this.epoch = b.epoch; this.rec.keyEpoch = b.epoch; await store.put('rooms', this.rec);
      if (b.removed) for (const m of this.members.values()) if (m.peerId === b.removed) { m.status = 'removed'; this.peers.close(m.peerId); }
      this.emit('change');
    } catch (e) { this.error = 'Could not apply new room key: ' + e.message; this.emit('change'); }
  }
  // ---- owner actions ----
  async _onJoinRequest(b) {
    if (!this.isOwner || this.pending.some((p) => p.peerId === b.peerId)) return;
    this.pending.push({ peerId: b.peerId, pubKey: b.pubKey, name: b.name });
    if (this.rec.openJoin) await this.approve(b.peerId).catch(() => {});
    this.emit('change');
  }
  async approve(peerId) {
    const p = this.pending.find((x) => x.peerId === peerId);
    if (!p) return;
    const envelope = await wrapKey(this.identity.dhKey, p.pubKey, this.raw.get(this.epoch), `${this.roomId}:${this.epoch}`);
    await this.signaling.request('room.approve', { roomId: this.roomId, peerId, envelope, epoch: this.epoch }, { room: this.roomId });
    this.pending = this.pending.filter((x) => x.peerId !== peerId);
    this.members.set(p.pubKey, { peerId, pub: p.pubKey, name: p.name, role: 'member', status: 'active' });
    this.emit('change');
  }
  async reject(peerId) {
    await this.signaling.request('room.reject', { roomId: this.roomId, peerId }, { room: this.roomId });
    this.pending = this.pending.filter((x) => x.peerId !== peerId); this.emit('change');
  }
  async rekey(removePeerId) {
    const epoch = this.epoch + 1, raw = newRoomKeyRaw(), envelopes = {};
    for (const m of this.members.values()) {
      if (m.status === 'active' && m.peerId !== this.me && m.peerId !== removePeerId) envelopes[m.peerId] = await wrapKey(this.identity.dhKey, m.pub, raw, `${this.roomId}:${epoch}`);
    }
    await this.signaling.request('room.rekey', { roomId: this.roomId, newEpoch: epoch, removePeerId, envelopes }, { room: this.roomId });
    await this._setKey(epoch, raw, true); this.epoch = epoch; this.rec.keyEpoch = epoch; await store.put('rooms', this.rec);
    if (removePeerId) for (const m of this.members.values()) if (m.peerId === removePeerId) { m.status = 'removed'; this.peers.close(removePeerId); }
    this.emit('change');
  }
  removeMember(peerId) { return this.rekey(peerId); }
  async setRole(peerId, role) {
    await this.signaling.request('room.setRole', { roomId: this.roomId, peerId, role }, { room: this.roomId });
    for (const m of this.members.values()) if (m.peerId === peerId) m.role = role;
    this.emit('change');
  }
  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await store.put('settings', { ...this.settings }, 'room:' + this.roomId);
    if (patch.classroom !== undefined) this.swarm._rechoke();
    if (patch.ai && this.aiState === 'off') this.loadAi();
    this.emit('change');
  }
  // ---- messaging ----
  async _decode(m) {
    try {
      const key = this.keys.get(m.epoch);
      if (!key) return;
      const payload = await openMessage(m, key);
      const author = this.members.get(m.authorPub);
      const authorId = author?.peerId ?? (await peerIdOf(m.authorPub));
      if (payload.k === 'unlock') { this.swarm.offerUnlock(payload.tid, m.authorPub, payload.key); return; }
      if (payload.k === 'receipt') {
        (this.receipts.get(payload.tid) ?? this.receipts.set(payload.tid, new Map()).get(payload.tid)).set(authorId, { root: payload.root, at: payload.at });
        this.emit('change'); return;
      }
      if (payload.k === 'vote') {
        const expect = hex(await sha256(enc.encode(`${authorId}:${payload.qid}`)));   // one vote per device, bound to the signer
        if (payload.voter !== expect) return;
        (this.votes.get(payload.qid) ?? this.votes.set(payload.qid, new Set()).get(payload.qid)).add(payload.voter);
      } else if (payload.k === 'q') {
        if (!this.vecs.has(payload.qid)) this.vecs.set(payload.qid, lexVec(payload.text));
        if (this.aiState === 'ready') this._embedAi(payload.qid, payload.text);
      }
      if (this.feed.some((f) => f.id === m.msgId)) return;
      this.feed.push({ id: m.msgId, channel: m.channel, ts: m.ts, authorId, authorName: author?.name || 'Someone', payload });
      this.feed.sort((a, b) => a.ts - b.ts);
      this.emit('change');
    } catch { /* undecryptable (missing key epoch) */ }
  }
  // ---- embargoed drops + delivery receipts ----
  postReceipt(T) {
    if (T.m.authorPub === this.identity.pub || this.postedReceipt.has(T.tid)) return;
    this.postedReceipt.add(T.tid);
    this.gossip.post('receipts', { k: 'receipt', tid: T.tid, root: T.m.merkleRoot, at: Date.now() }).catch(() => this.postedReceipt.delete(T.tid));
  }
  async release(tid) {
    const T = this.swarm.T.get(tid);
    if (!T?.fileKeyB64 || T.m.authorPub !== this.identity.pub) throw new Error('Only the author can release this file');
    if (T.released || T.releasing) return;
    T.releasing = true;
    try {
      await this.gossip.post('unlocks', { k: 'unlock', tid, key: T.fileKeyB64 });
      T.released = true; await store.put('settings', true, 'released:' + tid);
    } finally { T.releasing = false; this.emit('change'); }
  }
  coverage(tid) {
    const T = this.swarm.T.get(tid), list = [...this.members.values()];
    if (!T) return { ready: 0, total: 0, rows: [] };
    return coverageOf(T.m, this.receipts.get(tid), list, list.find((m) => m.pub === T.m.authorPub)?.peerId);
  }
  _everySecond() {
    if (this.status !== 'active') return;
    const now = Date.now();
    for (const T of this.swarm.T.values()) {
      if (T.m.keyMode === 'file' && T.m.authorPub === this.identity.pub && T.fileKeyB64 && !T.released && T.m.embargoUntil && now >= T.m.embargoUntil) this.release(T.tid).catch(() => {});
    }
    this._wake();
  }
  /** Keep the screen awake while transferring (mobile browsers pause background tabs). */
  async _wake() {
    const busy = [...this.swarm.T.values()].some((T) => T.state === 'downloading' && !T.bits.complete) || Date.now() - this.swarm.lastUpload < 5000;
    if (busy && !this.wake && !this._wakeBusy && navigator.wakeLock) {
      this._wakeBusy = true;
      try { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = null; this.emit('change'); }); this.emit('change'); } catch { /* denied */ }
      this._wakeBusy = false;
    } else if (!busy && this.wake) { this.wake.release().catch(() => {}); this.wake = null; this.emit('change'); }
  }
  postChat(text) { return this.gossip.post('chat', { k: 'chat', text }); }
  postAnnouncement(text) { return this.gossip.post('announcements', { k: 'ann', text }); }
  askQuestion(text) { return this.gossip.post('qa', { k: 'q', qid: hex(rand(8)), anon: hex(rand(2)), text }); }
  async vote(qid) { return this.gossip.post('qa', { k: 'vote', qid, voter: hex(await sha256(enc.encode(`${this.me}:${qid}`))) }); }
  iVoted(qid) { return false; }
  questions() {
    const out = this.feed.filter((f) => f.channel === 'qa' && f.payload.k === 'q').map((f) => ({ id: f.payload.qid, text: f.payload.text, anon: f.payload.anon, ts: f.ts, votes: this.votes.get(f.payload.qid)?.size || 0 }));
    return out;
  }
  clusters() {
    const qs = this.questions();
    const thr = this.aiState === 'ready' && this.settings.ai ? this.settings.thrAi : this.settings.thrLex;
    const items = qs.map((q) => ({ ...q, vec: this.vecs.get(q.id) ?? lexVec(q.text) }));
    return clusterItems(items, thr);
  }
  async loadAi() {
    this.aiState = 'loading'; this.emit('change');
    try {
      this.embed = await loadMiniLM();
      this.aiState = 'ready';
      this.vecs.clear();
      for (const q of this.questions()) await this._embedAi(q.id, q.text);
    } catch (e) { this.aiState = 'failed'; this.aiError = e.message; }
    this.emit('change');
  }
  async _embedAi(qid, text) { try { this.vecs.set(qid, await this.embed(text)); this.emit('change'); } catch { /* keep lexical */ } }
  destroy() {
    for (const o of this._off) o?.();
    try { this.signaling.send('room.leave', { roomId: this.roomId }, { room: this.roomId }); } catch { /* ignore */ }
    clearInterval(this._timer); this.wake?.release?.().catch(() => {});
    this.peers?.closeAll(); this.swarm?.stop();
  }
}
