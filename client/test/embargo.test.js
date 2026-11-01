import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentity, importAes, newRoomKeyRaw, aesDecrypt } from '../src/core/crypto.js';
import { buildManifest, verifyManifest } from '../src/core/manifest.js';
import { validUnlock, keyWorks, coverage, toCsv } from '../src/core/embargo.js';
import { gossipSim, sweep } from '../src/core/gossipsim.js';
import { b64, u32be } from '../src/core/bytes.js';

test('embargoed file: room key cannot open it, released key can, forged unlocks are rejected', async () => {
  const author = await generateIdentity(), other = await generateIdentity();
  const roomKey = await importAes(newRoomKeyRaw());
  const raw = newRoomKeyRaw(), fileKey = await importAes(raw);
  const chunks = new Map();
  const file = new File([new Uint8Array(300_000).fill(7)], 'paper.pdf');
  const m = await buildManifest({ file, roomId: 'r', key: fileKey, keyEpoch: 1, identity: author, putChunk: async (i, c) => chunks.set(i, c), keyMode: 'file', embargoUntil: Date.now() + 60_000 });
  assert.equal(m.keyMode, 'file');
  assert.equal(await verifyManifest(m), null);
  assert.notEqual(await verifyManifest({ ...m, keyMode: 'room' }), null, 'keyMode is covered by the signature');
  assert.notEqual(await verifyManifest({ ...m, embargoUntil: 1 }), null, 'embargoUntil is covered by the signature');
  await assert.rejects(aesDecrypt(roomKey, chunks.get(0), u32be(0)), 'members cannot read it early');
  assert.ok(await keyWorks(b64(raw), chunks.get(0)));
  assert.ok(!(await keyWorks(b64(newRoomKeyRaw()), chunks.get(0))));
  const good = { k: 'unlock', tid: m.transferId, key: b64(raw) };
  assert.ok(validUnlock(m, author.pub, good));
  assert.ok(!validUnlock(m, other.pub, good), 'only the author can release');
  assert.ok(!validUnlock(m, author.pub, { ...good, tid: 'x' }));
  assert.ok(!validUnlock({ ...m, keyMode: 'room' }, author.pub, good));
});

test('receipt coverage counts only matching roots and active non-author members; CSV is injection-safe', () => {
  const m = { merkleRoot: 'ROOT', name: 'a.pdf' };
  const members = [{ peerId: 'A', name: 'Author', status: 'active' }, { peerId: 'B', name: 'Bo', status: 'active' }, { peerId: 'C', name: '=HYPERLINK("x")', status: 'active' }, { peerId: 'D', name: 'Gone', status: 'removed' }];
  const rc = new Map([['B', { root: 'ROOT', at: 1000 }], ['C', { root: 'OTHER', at: 2000 }], ['D', { root: 'ROOT', at: 3000 }]]);
  const c = coverage(m, rc, members, 'A');
  assert.equal(c.total, 2); assert.equal(c.ready, 1);
  const csv = toCsv('a.pdf', c.rows);
  assert.match(csv, /Bo,B,verified,1970/); assert.match(csv, /'=HYPERLINK/);
});

test('gossip simulation: fanout 3 / TTL 8 reaches (almost) everyone quickly; low TTL does not', () => {
  const good = gossipSim({ peers: 100, fanout: 3, ttl: 8, seed: 3 });
  assert.ok(good.reachPct >= 94, 'epidemic reach ' + good.reachPct);   // rumor mongering can miss a few sites (Demers et al.)
  assert.equal(good.reachAfterSyncPct, 100);                           // anti-entropy closes the gap
  const fast = gossipSim({ peers: 100, fanout: 3, ttl: 8, seed: 3, aeRounds: 0 });
  assert.ok(fast.p95 < 1500, 'p95 ' + fast.p95);
  assert.ok(gossipSim({ peers: 100, fanout: 1, ttl: 2, seed: 3 }).reachPct < 20);
  assert.equal(sweep({ peers: 100 }, 2).length, 25);
});
