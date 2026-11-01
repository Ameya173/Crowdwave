import { canon } from './canon.js';
import { hex, b64, unb64, enc, dec } from './bytes.js';
import { sha256, sign, verify, aesEncrypt, aesDecrypt } from './crypto.js';

export const CHANNELS = ['announcements', 'chat', 'qa', 'receipts', 'unlocks'];
export const LIFETIME = { announcements: 7 * 864e5, chat: 864e5, qa: 2 * 864e5, receipts: 7 * 864e5, unlocks: 7 * 864e5 };
const contentOf = (m) => ({ v: 1, room: m.room, channel: m.channel, authorPub: m.authorPub, seq: m.seq, ts: m.ts, expiresAt: m.expiresAt, ttl: m.ttl, epoch: m.epoch, body: m.body });
const aadOf = (room, channel) => enc.encode(room + '|' + channel);

export async function createMessage({ room, channel, seq, payload, key, epoch, identity, ttl = 8, lifetimeMs = LIFETIME[channel] }) {
  const body = b64(await aesEncrypt(key, enc.encode(JSON.stringify(payload)), aadOf(room, channel)));
  const now = Date.now();
  const m = { v: 1, room, channel, authorPub: identity.pub, seq, ts: now, expiresAt: now + lifetimeMs, ttl, epoch, body, hops: 0 };
  const c = enc.encode(canon(contentOf(m)));
  m.msgId = hex(await sha256(c));
  m.signature = await sign(identity.signKey, c); // hops is excluded from the signature
  return m;
}
/** members: Map<pub, {role,status}>. Returns null when valid, else a reason. */
export async function verifyMessage(m, { members, now = Date.now() }) {
  if (!m || m.v !== 1 || typeof m.body !== 'string') return 'bad-format';
  if (!CHANNELS.includes(m.channel)) return 'bad-channel';
  if (m.body.length > 90000) return 'too-big';
  if (m.expiresAt < now) return 'expired';
  if (!(m.hops >= 0) || m.hops > m.ttl || m.ttl > 16) return 'hops';
  const c = enc.encode(canon(contentOf(m)));
  if (hex(await sha256(c)) !== m.msgId) return 'bad-id';
  const mem = members.get(m.authorPub);
  if (!mem || mem.status !== 'active') return 'not-member';
  if (m.channel === 'announcements' && mem.role !== 'owner' && mem.role !== 'moderator') return 'forbidden';
  if (!(await verify(m.authorPub, c, m.signature))) return 'bad-signature';
  return null;
}
export async function openMessage(m, key) {
  return JSON.parse(dec.decode(await aesDecrypt(key, unb64(m.body), aadOf(m.room, m.channel))));
}
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Store-and-forward gossip with fanout, TTL, dedup (LRU) and anti-entropy sync. */
export class Gossip {
  constructor({ room, identity, store, getMembers, getKey, getEpoch, getLinks, send, relay, onMessage, fanout = 3 }) {
    Object.assign(this, { room, identity, store, getMembers, getKey, getEpoch, getLinks, send, relay, onMessage, fanout });
    this.msgs = new Map(); this.seen = new Map(); this.stats = { accepted: 0, rejected: 0, dup: 0, forwarded: 0 };
  }
  async load() {
    const now = Date.now();
    for (const m of await this.store.byIndex('messages', 'room', this.room)) {
      if (m.expiresAt < now) await this.store.del('messages', m.msgId); else { this.msgs.set(m.msgId, m); this.seen.set(m.msgId, 1); this.onMessage?.(m, true); }
    }
  }
  _seen(id) { if (this.seen.size > 5000) this.seen.delete(this.seen.keys().next().value); this.seen.set(id, 1); }
  async nextSeq(channel) {
    const k = `seq:${this.room}:${channel}`;
    let s = (await this.store.get('settings', k)) || 0;
    for (const m of this.msgs.values()) if (m.channel === channel && m.authorPub === this.identity.pub) s = Math.max(s, m.seq);
    s++; await this.store.put('settings', s, k); return s;
  }
  async post(channel, payload) {
    const key = this.getKey(this.getEpoch());
    if (!key) throw new Error('no room key yet');
    const m = await createMessage({ room: this.room, channel, seq: await this.nextSeq(channel), payload, key, epoch: this.getEpoch(), identity: this.identity });
    await this.ingest(m, null, { local: true });
    this.relay?.(m);
    return m;
  }
  async ingest(m, fromId, { sync = false, local = false } = {}) {
    if (this.seen.has(m?.msgId)) { this.stats.dup++; return 'dup'; }
    if (m.room !== this.room) return 'wrong-room';
    const why = await verifyMessage(m, { members: this.getMembers() });
    if (why) { this.stats.rejected++; return why; }
    this._seen(m.msgId);
    this.msgs.set(m.msgId, m);
    await this.store.put('messages', m);
    this.stats.accepted++;
    this.onMessage?.(m, false);
    if (!sync && !local && m.hops < m.ttl) this._forward(m, fromId);
    if (local) this._forward(m, null);
    return null;
  }
  _forward(m, fromId) {
    const next = { ...m, hops: m.hops + 1 };
    if (next.hops > m.ttl) return;
    for (const l of shuffle(this.getLinks().filter((l) => l.id !== fromId)).slice(0, this.fanout)) { this.send(l, { t: 'MSG', msg: next }); this.stats.forwarded++; }
  }
  summary() {
    const s = {};
    for (const m of this.msgs.values()) { const c = (s[m.channel] ??= {}); c[m.authorPub] = Math.max(c[m.authorPub] || 0, m.seq); }
    return s;
  }
  onSummary(link, theirs) {
    const mine = this.summary(), wants = [];
    for (const ch of CHANNELS) for (const [a, max] of Object.entries(theirs?.[ch] ?? {})) {
      const have = mine[ch]?.[a] || 0;
      if (max > have) wants.push({ channel: ch, author: a, after: have });
    }
    if (wants.length) this.send(link, { t: 'SYNC_PULL', wants: wants.slice(0, 200) });
  }
  onPull(link, wants) {
    let sent = 0;
    for (const w of wants ?? []) for (const m of this.msgs.values()) {
      if (sent >= 300) return;
      if (m.channel === w.channel && m.authorPub === w.author && m.seq > w.after) { this.send(link, { t: 'MSG', msg: m, sync: true }); sent++; }
    }
  }
}
