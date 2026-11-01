import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { verifySig, parsePub, peerIdOf } from './auth.js';
import { iceServers, cfg } from './config.js';
import { Bucket } from './limits.js';
import { validTid } from './cache.js';

class Err extends Error { constructor(code) { super(code); this.code = code; } }
const A32 = 'abcdefghijklmnopqrstuvwxyz234567';
const newRoomId = () => Array.from(crypto.randomBytes(10), (b) => A32[b & 31]).join('');
const clean = (s, n = 32) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const ROOM_ID = /^[a-z2-7]{10}$/;

/** Signaling + rooms + tracker. The server relays and stores ciphertext only; it never holds a room key. */
export function attachSignaling(server, { db, metrics }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
  const presence = new Map();  // roomId -> Map(peerId -> client)
  const byPeer = new Map();    // peerId -> client
  const tracker = new Map();   // roomId -> Map(tid -> Map(peerId -> bitfield))
  const q = {
    room: db.prepare('SELECT * FROM rooms WHERE room_id=?'),
    mem: db.prepare('SELECT * FROM members WHERE room_id=? AND peer_id=?'),
    members: db.prepare("SELECT peer_id AS peerId, pub_key AS pub, name, role, status FROM members WHERE room_id=? AND status='active'"),
    pendingList: db.prepare("SELECT peer_id AS peerId, pub_key AS pubKey, name FROM members WHERE room_id=? AND status='pending'"),
    count: db.prepare("SELECT COUNT(*) c FROM members WHERE room_id=? AND status IN ('active','pending')"),
    owned: db.prepare('SELECT COUNT(*) c FROM rooms WHERE owner_peer=?'),
    insRoom: db.prepare('INSERT INTO rooms(room_id,name,owner_pub,owner_peer,key_epoch,open_join,created_at,expires_at) VALUES(?,?,?,?,1,?,?,?)'),
    insMem: db.prepare('INSERT OR REPLACE INTO members(room_id,peer_id,pub_key,name,role,status,envelope,envelope_epoch,joined_at) VALUES(?,?,?,?,?,?,?,?,?)'),
    activate: db.prepare("UPDATE members SET status='active', envelope=?, envelope_epoch=? WHERE room_id=? AND peer_id=?"),
    delMem: db.prepare('DELETE FROM members WHERE room_id=? AND peer_id=?'),
    setEnv: db.prepare("UPDATE members SET envelope=?, envelope_epoch=? WHERE room_id=? AND peer_id=? AND status='active'"),
    remove: db.prepare("UPDATE members SET status='removed', envelope=NULL WHERE room_id=? AND peer_id=?"),
    setEpoch: db.prepare('UPDATE rooms SET key_epoch=? WHERE room_id=?'),
    setRole: db.prepare("UPDATE members SET role=? WHERE room_id=? AND peer_id=? AND status='active' AND role!='owner'"),
    mans: db.prepare('SELECT json FROM manifests WHERE room_id=? ORDER BY created_at DESC LIMIT 200'),
    man: db.prepare('SELECT room_id FROM manifests WHERE transfer_id=?'),
    insMan: db.prepare('INSERT OR IGNORE INTO manifests(transfer_id,room_id,name,size,chunk_size,chunk_count,merkle_root,leaf_hashes,key_epoch,author_pub,signature,json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    msgs: db.prepare('SELECT json FROM messages WHERE room_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY ts DESC LIMIT 500'),
    insMsg: db.prepare('INSERT OR IGNORE INTO messages(msg_id,room_id,channel,author_pub,seq,json,ts,expires_at) VALUES(?,?,?,?,?,?,?,?)'),
  };
  metrics.gauge('ws_clients', () => wss.clients.size);
  metrics.gauge('rooms_with_presence', () => presence.size);

  const raw = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const send = (c, t, body, extra = {}) => raw(c.ws, { v: 1, t, id: crypto.randomUUID(), ts: Date.now(), ...extra, body });
  const members = (roomId) => presence.get(roomId) ?? presence.set(roomId, new Map()).get(roomId);
  const broadcast = (roomId, t, body, except) => { for (const [pid, c] of presence.get(roomId) ?? []) if (pid !== except) send(c, t, body, { room: roomId }); };
  const getRoom = (id) => {
    if (!ROOM_ID.test(String(id))) throw new Err('not-found');
    const r = q.room.get(id);
    if (!r || (r.expires_at && r.expires_at < Date.now())) throw new Err('not-found');
    return r;
  };
  const activeMember = (roomId, peerId) => { const m = q.mem.get(roomId, peerId); if (!m || m.status !== 'active') throw new Err('forbidden'); return m; };
  const ownerOnly = (room, c) => { if (room.owner_peer !== c.peerId) throw new Err('forbidden'); };
  const enter = (c, roomId, mem) => {
    members(roomId).set(c.peerId, c); c.rooms.add(roomId);
    broadcast(roomId, 'peer.joined', { roomId, peerId: c.peerId, pubKey: c.pub, name: mem.name, role: mem.role }, c.peerId);
  };
  const leave = (c, roomId) => {
    const m = presence.get(roomId);
    if (m?.get(c.peerId) === c) { m.delete(c.peerId); if (!m.size) presence.delete(roomId); broadcast(roomId, 'peer.left', { roomId, peerId: c.peerId }); }
    tracker.get(roomId)?.forEach((peers) => peers.delete(c.peerId));
    c.rooms.delete(roomId);
  };
  const fullState = (room, c, mem) => {
    const owner = room.owner_peer === c.peerId;
    return {
      status: 'active', role: mem.role,
      room: { roomId: room.room_id, name: room.name, ownerPub: room.owner_pub, openJoin: !!room.open_join, keyEpoch: room.key_epoch, expiresAt: room.expires_at },
      members: q.members.all(room.room_id), pending: owner ? q.pendingList.all(room.room_id) : [],
      online: [...(presence.get(room.room_id)?.keys() ?? [])].filter((p) => p !== c.peerId),
      envelope: mem.envelope, envelopeEpoch: mem.envelope_epoch,
      manifests: q.mans.all(room.room_id).map((r) => JSON.parse(r.json)),
      messages: q.msgs.all(room.room_id, Date.now()).map((r) => JSON.parse(r.json)),
    };
  };

  const H = {
    'room.create'(c, m) {
      const b = m.body, name = clean(b.name, 64);
      if (!name) throw new Err('bad-name');
      if (q.owned.get(c.peerId).c >= 50) throw new Err('too-many-rooms');
      const now = Date.now();
      const exp = Number.isFinite(b.expiresAt) ? Math.min(Math.max(b.expiresAt, now + 60000), now + 30 * 864e5) : null;
      const roomId = newRoomId();
      db.transaction(() => {
        q.insRoom.run(roomId, name, c.pub, c.peerId, b.openJoin ? 1 : 0, now, exp);
        q.insMem.run(roomId, c.peerId, c.pub, c.name, 'owner', 'active', null, null, now);
      })();
      metrics.inc('rooms_created');
      return { roomId };
    },
    'room.join'(c, m) {
      const room = getRoom(m.body.roomId);
      let mem = q.mem.get(room.room_id, c.peerId);
      if (mem?.status === 'removed') throw new Err('forbidden');
      if (!mem) {
        if (q.count.get(room.room_id).c >= cfg.maxRoomMembers) throw new Err('room-full');
        q.insMem.run(room.room_id, c.peerId, c.pub, c.name, 'member', 'pending', null, null, Date.now());
        mem = q.mem.get(room.room_id, c.peerId);
      }
      if (mem.status === 'pending') {
        const o = byPeer.get(room.owner_peer);
        if (o) send(o, 'room.joinRequest', { roomId: room.room_id, peerId: c.peerId, pubKey: c.pub, name: c.name });
        return { status: 'pending' };
      }
      if (mem.name !== c.name && c.name) { db.prepare('UPDATE members SET name=? WHERE room_id=? AND peer_id=?').run(c.name, room.room_id, c.peerId); mem.name = c.name; }
      const state = fullState(room, c, mem);
      enter(c, room.room_id, mem);
      return state;
    },
    'room.leave'(c, m) { if (m.body.roomId) leave(c, m.body.roomId); },
    'room.approve'(c, m) {
      const { roomId, peerId, envelope, epoch } = m.body;
      const room = getRoom(roomId); ownerOnly(room, c);
      const mem = q.mem.get(roomId, peerId);
      if (!mem || mem.status !== 'pending') throw new Err('not-pending');
      if (typeof envelope !== 'string' || envelope.length > 512 || epoch !== room.key_epoch) throw new Err('bad-envelope');
      q.activate.run(envelope, epoch, roomId, peerId);
      const t = byPeer.get(peerId);
      if (t) send(t, 'room.joinResult', { roomId, approved: true });
      return { ok: true };
    },
    'room.reject'(c, m) {
      const room = getRoom(m.body.roomId); ownerOnly(room, c);
      const mem = q.mem.get(room.room_id, m.body.peerId);
      if (mem?.status !== 'pending') throw new Err('not-pending');
      q.delMem.run(room.room_id, m.body.peerId);
      const t = byPeer.get(m.body.peerId);
      if (t) send(t, 'room.joinResult', { roomId: room.room_id, approved: false });
      return { ok: true };
    },
    'room.rekey'(c, m) {
      const { roomId, newEpoch, removePeerId, envelopes } = m.body;
      const room = getRoom(roomId); ownerOnly(room, c);
      if (newEpoch !== room.key_epoch + 1 || typeof envelopes !== 'object' || !envelopes) throw new Err('bad-epoch');
      const active = q.members.all(roomId).filter((x) => x.peerId !== c.peerId && x.peerId !== removePeerId);
      for (const a of active) if (typeof envelopes[a.peerId] !== 'string' || envelopes[a.peerId].length > 512) throw new Err('missing-envelope');
      if (removePeerId && removePeerId === c.peerId) throw new Err('cannot-remove-owner');
      db.transaction(() => {
        q.setEpoch.run(newEpoch, roomId);
        if (removePeerId) q.remove.run(roomId, removePeerId);
        for (const a of active) q.setEnv.run(envelopes[a.peerId], newEpoch, roomId, a.peerId);
      })();
      for (const a of active) { const t = byPeer.get(a.peerId); if (t) send(t, 'room.rekey', { roomId, epoch: newEpoch, envelope: envelopes[a.peerId], removed: removePeerId }); }
      if (removePeerId) {
        const t = byPeer.get(removePeerId);
        if (t) { send(t, 'room.removed', { roomId }); leave(t, roomId); }
        broadcast(roomId, 'peer.left', { roomId, peerId: removePeerId });
      }
      return { ok: true };
    },
    'room.setRole'(c, m) {
      const { roomId, peerId, role } = m.body;
      const room = getRoom(roomId); ownerOnly(room, c);
      if (role !== 'member' && role !== 'moderator') throw new Err('bad-role');
      q.setRole.run(role, roomId, peerId);
      broadcast(roomId, 'member.update', { roomId, peerId, role });
      return { ok: true };
    },
    'manifest.publish'(c, m) {
      const man = m.body.manifest, roomId = m.room;
      if (!man || JSON.stringify(man).length > 400000) throw new Err('too-big');
      const room = getRoom(roomId); activeMember(roomId, c.peerId);
      if (man.roomId !== roomId || man.authorPub !== c.pub || !validTid(man.transferId) || !Number.isInteger(man.size) || !Number.isInteger(man.chunkCount) || man.chunkCount > 100000) throw new Err('bad-manifest');
      const leaves = Buffer.from(man.leafHashes, 'base64');
      if (leaves.length !== man.chunkCount * 32) throw new Err('bad-manifest');
      const r = q.insMan.run(man.transferId, roomId, clean(man.name, 255), man.size, man.chunkSize, man.chunkCount, man.merkleRoot, leaves, man.keyEpoch, man.authorPub, man.signature, JSON.stringify(man), Date.now(), man.expiresAt ?? room.expires_at ?? null);
      if (r.changes) { metrics.inc('manifests_published'); broadcast(roomId, 'manifest.new', { roomId, manifest: man }, c.peerId); }
      return { ok: true };
    },
    'msg.put'(c, m) {
      const msg = m.body.msg, roomId = m.room;
      activeMember(roomId, c.peerId);
      if (!msg || msg.room !== roomId || typeof msg.msgId !== 'string' || msg.authorPub !== c.pub) throw new Err('bad-message');
      const json = JSON.stringify(msg);
      if (json.length > 100000) throw new Err('too-big');
      if (q.insMsg.run(msg.msgId, roomId, String(msg.channel).slice(0, 16), msg.authorPub, msg.seq | 0, json, msg.ts, msg.expiresAt ?? null).changes) {
        metrics.inc('messages_stored'); broadcast(roomId, 'msg.new', { roomId, msg }, c.peerId);
      }
      return { ok: true };
    },
    'tracker.announce'(c, m) {
      const { transferId, bitfield } = m.body, roomId = m.room;
      if (!c.rooms.has(roomId) || !validTid(transferId) || typeof bitfield !== 'string' || bitfield.length > 16384) return;
      if (q.man.get(transferId)?.room_id !== roomId) return;
      const rt = tracker.get(roomId) ?? tracker.set(roomId, new Map()).get(roomId);
      const peers = rt.get(transferId) ?? rt.set(transferId, new Map()).get(transferId);
      peers.set(c.peerId, bitfield);
      const list = [...peers].filter(([p]) => p !== c.peerId).slice(0, 50).map(([peerId, bf]) => ({ peerId, bitfield: bf }));
      send(c, 'tracker.peers', { roomId, transferId, peers: list }, { room: roomId });
    },
    rtc(c, m) {
      const t = presence.get(m.room)?.get(m.to);
      if (!t || !c.rooms.has(m.room) || JSON.stringify(m.body).length > 20000) return;
      send(t, m.t, m.body, { room: m.room, from: c.peerId });   // `from` is always set by the server
    },
  };
  H['rtc.offer'] = H['rtc.answer'] = H['rtc.ice'] = H.rtc;

  wss.on('connection', (ws) => {
    metrics.inc('ws_connections_total');
    const c = { ws, authed: false, peerId: null, pub: null, name: '', rooms: new Set(), nonce: crypto.randomBytes(32).toString('base64'),
      msgs: new Bucket(60, 150), bytes: new Bucket(1.5e6, 4e6), strikes: 0 };
    send(c, 'challenge', { nonce: c.nonce });
    const authTimer = setTimeout(() => { if (!c.authed) ws.close(4001, 'auth timeout'); }, 8000);
    ws.on('message', async (data, isBinary) => {
      if (isBinary) return;
      if (!c.msgs.take(1) || !c.bytes.take(data.length)) {
        metrics.inc('rate_limited');
        if (++c.strikes > 40) return ws.close(1008, 'rate limited');
        return send(c, 'error', { code: 'rate-limited', message: 'Too many messages' });
      }
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || m.v !== 1 || typeof m.t !== 'string' || typeof m.id !== 'string' || m.id.length > 64 || typeof m.body !== 'object' || !m.body) return;
      metrics.inc('ws_messages_total');
      try {
        if (!c.authed) {
          if (m.t !== 'hello') return;
          const pub = m.body.pubKey;
          if (!parsePub(pub) || typeof m.body.nonceResponse !== 'string') throw new Err('bad-hello');
          if (!(await verifySig(pub, 'crowdwave-auth-v1\n' + c.nonce, m.body.nonceResponse))) throw new Err('bad-signature');
          Object.assign(c, { authed: true, pub, peerId: peerIdOf(pub), name: clean(m.body.name) });
          clearTimeout(authTimer);
          const old = byPeer.get(c.peerId);
          if (old && old !== c) old.ws.close(4000, 'replaced');
          byPeer.set(c.peerId, c);
          return send(c, 'welcome', { peerId: c.peerId, serverTime: Date.now(), iceServers: iceServers(c.peerId) });
        }
        const h = H[m.t];
        if (!h) throw new Err('unknown-type');
        if (typeof m.room === 'string' && m.room.length > 32) throw new Err('bad-room');
        const res = h(c, m);
        if (res !== undefined) send(c, 'ack', { re: m.id, ok: true, ...res });
      } catch (e) {
        if (!(e instanceof Err)) console.error('[ws]', m.t, e);
        metrics.inc('ws_errors');
        send(c, 'ack', { re: m.id, ok: false, error: e instanceof Err ? e.code : 'server-error' });
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      for (const r of [...c.rooms]) leave(c, r);
      if (c.peerId && byPeer.get(c.peerId) === c) byPeer.delete(c.peerId);
    });
    ws.on('error', () => {});
  });
  return { stats: () => ({ clients: wss.clients.size, rooms: presence.size }) };
}
