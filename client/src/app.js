import { useEffect, useReducer } from 'react';
import { generateIdentity, rand } from './core/crypto.js';
import { b64 } from './core/bytes.js';
import { Signaling } from './net/signaling.js';
import { RoomSession } from './net/session.js';
import { newRoomKeyRaw } from './core/crypto.js';
import * as store from './net/store.js';

/** Global app singleton: identity, signaling connection, room list, and the one open room session. */
class App {
  constructor() { this.subs = new Set(); this.identity = null; this.signaling = null; this.rooms = []; this.session = null; this.status = 'booting'; this.t = 0; this.fatal = null; }
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  notify() { if (this.t) return; this.t = setTimeout(() => { this.t = 0; this.subs.forEach((f) => f()); }, 120); }
  async init() {
    if (this.identity) return;
    try {
      if (!window.isSecureContext || !crypto?.subtle) throw new Error('This page is not a secure context (needs https:// or localhost), so the browser disables the cryptography Crowdwave relies on. Open the Campus Node over HTTPS.');
      let id = await store.get('identity', 'me');
      if (!id) { id = await generateIdentity(); await store.put('identity', id, 'me'); }
      this.identity = id;
      this.rooms = await store.all('rooms');
      this.signaling = new Signaling(id);
      this.signaling.on('state', () => { this.status = this.signaling.state; this.notify(); });
      this.signaling.connect();
      navigator.storage?.persist?.();
    } catch (e) { this.fatal = e.message; }
    this.notify();
  }
  async setName(name) { this.identity.name = name.trim().slice(0, 32); await store.put('identity', this.identity, 'me'); this.notify(); }
  async createRoom({ name, openJoin, hours }) {
    await this.signaling.whenReady();
    const expiresAt = hours ? Date.now() + hours * 3600e3 : null;
    const r = await this.signaling.request('room.create', { name, openJoin, expiresAt });
    const rec = { roomId: r.roomId, name, role: 'owner', ownerPub: this.identity.pub, openJoin, keyEpoch: 1, keys: { 1: b64(newRoomKeyRaw()) }, createdAt: Date.now(), expiresAt };
    await store.put('rooms', rec); this.rooms = await store.all('rooms'); this.notify();
    return rec.roomId;
  }
  async addInvite(roomId, ownerId) {
    if (!this.rooms.find((r) => r.roomId === roomId)) {
      await store.put('rooms', { roomId, name: 'Joining…', role: 'member', pinOwner: ownerId, keys: {}, keyEpoch: 1, createdAt: Date.now() });
      this.rooms = await store.all('rooms');
    }
    this.notify();
  }
  async openRoom(roomId) {
    if (this.session?.roomId === roomId) return this.session;
    this.closeRoom();
    const rec = this.rooms.find((r) => r.roomId === roomId);
    if (!rec) return null;
    const s = (this.session = new RoomSession({ identity: this.identity, signaling: this.signaling, record: rec }));
    s.on('change', () => this.notify());
    await s.start();
    this.notify();
    return s;
  }
  closeRoom() { this.session?.destroy(); this.session = null; }
  async forgetRoom(roomId) {
    if (this.session?.roomId === roomId) this.closeRoom();
    for (const T of (await store.byIndex('manifests', 'room', roomId))) { await store.del('manifests', T.transferId); const cm = await store.get('chunkMap', T.transferId); await store.del('chunkMap', T.transferId); await store.dropChunks(cm?.sk ?? T.transferId); }
    await store.del('rooms', roomId); this.rooms = await store.all('rooms'); this.notify();
  }
}
export const app = new App();
export function useApp() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => app.sub(force), []);
  return app;
}
export function useHash() {
  const [h, set] = useReducer((_, v) => v, location.hash || '#/');
  useEffect(() => { const f = () => set(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}
export const go = (h) => { location.hash = h; };
