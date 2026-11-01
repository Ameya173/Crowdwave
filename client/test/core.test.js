import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentity, wrapKey, unwrapKey, newRoomKeyRaw, importAes, aesEncrypt, aesDecrypt, sas, signStr, verifyStr, peerIdOf } from '../src/core/crypto.js';
import { buildManifest, verifyManifest } from '../src/core/manifest.js';
import { Bitfield } from '../src/core/bitfield.js';
import { encodeFrame, decodeFrame, fragments, Assembler, FT } from '../src/core/frames.js';
import { merkleRoot } from '../src/core/merkle.js';
import { sha256 } from '../src/core/crypto.js';
import { Gossip, createMessage, verifyMessage, openMessage } from '../src/core/gossip.js';
import { planRequests, PeerStat, mulberry32 } from '../src/core/scheduler.js';
import { runSim } from '../src/core/sim.js';
import { lexVec, clusterItems } from '../src/core/cluster.js';
import { u32be } from '../src/core/bytes.js';

test('identity, peerId, sign/verify, SAS', async () => {
  const a = await generateIdentity(), b = await generateIdentity();
  assert.equal(a.peerId, await peerIdOf(a.pub));
  assert.equal(a.peerId.length, 26);
  const sig = await signStr(a.signKey, 'hello');
  assert.ok(await verifyStr(a.pub, 'hello', sig));
  assert.ok(!(await verifyStr(a.pub, 'hellO', sig)));
  assert.ok(!(await verifyStr(b.pub, 'hello', sig)));
  assert.equal(await sas(a.pub, b.pub), await sas(b.pub, a.pub));
});

test('room key wrap/unwrap between members; wrong party cannot unwrap', async () => {
  const owner = await generateIdentity(), m = await generateIdentity(), x = await generateIdentity();
  const raw = newRoomKeyRaw();
  const env = await wrapKey(owner.dhKey, m.pub, raw, 'room1:1');
  assert.deepEqual(await unwrapKey(m.dhKey, owner.pub, env, 'room1:1'), raw);
  await assert.rejects(unwrapKey(x.dhKey, owner.pub, env, 'room1:1'));
  await assert.rejects(unwrapKey(m.dhKey, owner.pub, env, 'room1:2'));
});

test('merkle root changes with any leaf', async () => {
  const leaves = await Promise.all([1, 2, 3, 4, 5].map((i) => sha256(new Uint8Array([i]))));
  const r1 = await merkleRoot(leaves);
  const l2 = leaves.slice(); l2[3] = await sha256(new Uint8Array([99]));
  assert.notDeepEqual(r1, await merkleRoot(l2));
});

test('manifest build/verify, tamper detection, chunk decrypt', async () => {
  const id = await generateIdentity();
  const key = await importAes(newRoomKeyRaw());
  const data = new Uint8Array(700_000).map((_, i) => (i * 7) & 255);
  const file = new File([data], 'x.bin');
  const chunks = new Map();
  const m = await buildManifest({ file, roomId: 'r', key, keyEpoch: 1, identity: id, putChunk: async (i, c) => chunks.set(i, c) });
  assert.equal(m.chunkCount, 3);
  assert.equal(await verifyManifest(m), null);
  assert.equal(await verifyManifest({ ...m, name: 'evil.bin' }), 'bad-id');
  assert.notEqual(await verifyManifest({ ...m, size: m.size + 1 }), null);
  const lh = m.leafHashes; assert.notEqual(await verifyManifest({ ...m, leafHashes: lh.slice(0, -4) + 'AAAA' }), null);
  const plain = await aesDecrypt(key, chunks.get(1), u32be(1));
  assert.deepEqual(plain, data.subarray(262144, 524288));
  await assert.rejects(aesDecrypt(key, chunks.get(1), u32be(2))); // index bound via AAD
});

test('bitfield', () => {
  const b = new Bitfield(10); b.set(0); b.set(9); b.set(9);
  assert.equal(b.count, 2); assert.ok(b.has(9)); assert.ok(!b.has(5));
  const c = Bitfield.fromB64(10, b.toB64()); assert.equal(c.count, 2); assert.ok(Bitfield.full(10).complete);
});

test('frames: encode/decode and out-of-order reassembly', () => {
  const chunk = new Uint8Array(100_000).map((_, i) => i & 255);
  const frames = [...fragments(123, 7, chunk)];
  assert.ok(frames.length > 5);
  assert.equal(decodeFrame(encodeFrame({ type: FT.PIECE_NACK, handle: 1, index: 2 })).type, FT.PIECE_NACK);
  const asm = new Assembler(200_000);
  let out = null;
  for (const f of frames.slice().reverse()) out = asm.push(decodeFrame(f)) ?? out;
  assert.deepEqual(out.data, chunk); assert.equal(out.index, 7);
  assert.equal(new Assembler(10).push(decodeFrame(frames[0])), null); // oversize guarded
});

test('scheduler: rarest-first, no duplicates outside endgame, node only as fallback', () => {
  const n = 20, have = new Bitfield(n);
  const a = new Bitfield(n), b = new Bitfield(n), node = Bitfield.full(n);
  for (let i = 0; i < n; i++) a.set(i);
  for (let i = 0; i < 10; i++) b.set(i);            // chunks 0-9 are common, 10-19 rare
  const peers = [{ id: 'a', bits: a, stat: new PeerStat(), free: 4 }, { id: 'b', bits: b, stat: new PeerStat(), free: 4 }, { id: 'node', isNode: true, bits: node, stat: new PeerStat(), free: 4 }];
  have.set(0);
  const plan = planRequests({ have, peers, inflight: new Map(), rng: mulberry32(3), epsilon: 0 });
  const all = [...plan.values()].flat();
  assert.equal(new Set(all).size, all.length);
  assert.ok(plan.get('a').every((i) => i >= 10), 'peer a is asked for the rare chunks');
  assert.ok(!plan.has('node'), 'node unused when peers have the chunks');
  const onlyNode = planRequests({ have: new Bitfield(n), peers: [{ id: 'node', isNode: true, bits: node, stat: new PeerStat(), free: 3 }], inflight: new Map() });
  assert.equal(onlyNode.get('node').length, 3);
});

test('bandit prefers the faster peer', () => {
  const n = 40, bits = Bitfield.full(n);
  const fast = new PeerStat(), slow = new PeerStat();
  for (let i = 0; i < 5; i++) { fast.record(1e6, 100); slow.record(1e6, 2000); }
  const peers = [{ id: 'slow', bits, stat: slow, free: 4 }, { id: 'fast', bits, stat: fast, free: 4 }];
  const plan = planRequests({ have: new Bitfield(n), peers, inflight: new Map(), epsilon: 0, rng: mulberry32(1) });
  assert.equal(plan.get('fast').length, 4);
});

test('gossip: signatures, channel permissions, tamper, replay, anti-entropy', async () => {
  const owner = await generateIdentity(), mem = await generateIdentity(), out = await generateIdentity();
  const key = await importAes(newRoomKeyRaw());
  const members = new Map([[owner.pub, { role: 'owner', status: 'active' }], [mem.pub, { role: 'member', status: 'active' }]]);
  const ann = await createMessage({ room: 'r', channel: 'announcements', seq: 1, payload: { text: 'hi' }, key, epoch: 1, identity: owner });
  assert.equal(await verifyMessage(ann, { members }), null);
  assert.deepEqual(await openMessage(ann, key), { text: 'hi' });
  const bad = await createMessage({ room: 'r', channel: 'announcements', seq: 1, payload: {}, key, epoch: 1, identity: mem });
  assert.equal(await verifyMessage(bad, { members }), 'forbidden');
  assert.equal(await verifyMessage({ ...ann, body: ann.body.slice(0, -2) + 'AA' }, { members }), 'bad-id');
  const stranger = await createMessage({ room: 'r', channel: 'chat', seq: 1, payload: {}, key, epoch: 1, identity: out });
  assert.equal(await verifyMessage(stranger, { members }), 'not-member');
  assert.equal(await verifyMessage({ ...ann, expiresAt: Date.now() + 5 }, { members }), 'bad-id');
  const old = await createMessage({ room: 'r', channel: 'chat', seq: 2, payload: {}, key, epoch: 1, identity: mem, lifetimeMs: -10 });
  assert.equal(await verifyMessage(old, { members }), 'expired');
  assert.equal(await verifyMessage({ ...ann, hops: 99 }, { members }), 'hops');
  assert.equal(await verifyMessage({ ...ann, hops: 2 }, { members }), null); // hops excluded from signature

  // anti-entropy between two nodes that were never connected live
  const mkStore = () => { const t = new Map(); return { get: async (s, k) => t.get(s + k), put: async (s, v, k) => t.set(s + (k ?? v.msgId), v), del: async () => {}, byIndex: async () => [] }; };
  const inbox = { A: [], B: [] };
  const mk = (me, name) => new Gossip({ room: 'r', identity: me, store: mkStore(), getMembers: () => members, getKey: () => key, getEpoch: () => 1, getLinks: () => [], send: (l, msg) => inbox[l.to].push(msg) });
  const A = mk(owner), B = mk(mem);
  await A.post('announcements', { text: 'one' }); await A.post('announcements', { text: 'two' });
  B.onSummary({ to: 'A' }, A.summary());                  // B learns A has more -> pulls
  const pull = inbox.A.shift(); assert.equal(pull.t, 'SYNC_PULL');
  A.onPull({ to: 'B' }, pull.wants);
  for (const x of inbox.B) await B.ingest(x.msg, 'A', { sync: true });
  assert.equal(B.msgs.size, 2);
  assert.equal(await B.ingest([...B.msgs.values()][0], 'A'), 'dup');
});

test('simulation: swarm beats single source, bandit completes, failures recovered', () => {
  const base = { peers: 20, fileMB: 50, chunkKB: 1024, sourceMbps: 100, peerUpMbps: 50, seed: 5 };
  const single = runSim({ ...base, strategy: 'single' });
  const swarm = runSim({ ...base, strategy: 'bandit' });
  assert.equal(single.completed, 20); assert.equal(swarm.completed, 20);
  assert.ok(swarm.timeToLast < single.timeToLast * 0.6, `${swarm.timeToLast} vs ${single.timeToLast}`);
  assert.ok(swarm.sourcePct < 60, `source pct ${swarm.sourcePct}`);
  const fail = runSim({ ...base, strategy: 'bandit', failFrac: 0.2, failAtSec: 5 });
  assert.equal(fail.failedTransfers, 0);
});

test('clustering groups paraphrased questions and keeps unrelated apart', () => {
  const qs = ['When is the assignment deadline?', 'what is the deadline for the assignment', 'Can you explain recursion again?', 'Please explain recursion once more', 'Is attendance mandatory?'];
  const cl = clusterItems(qs.map((q, i) => ({ id: i, vec: lexVec(q), votes: 1 })), 0.45);
  assert.equal(cl.length, 3);
});
