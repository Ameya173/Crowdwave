// Peer selection (epsilon-greedy bandit) + piece selection (rarest-first, random-first, endgame).
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export class PeerStat {
  constructor() { this.ewma = 0; this.ok = 0; this.err = 0; }
  get errRate() { const t = this.ok + this.err; return t ? this.err / t : 0; }
  record(bytes, ms) { const tp = (bytes / Math.max(ms, 1)) * 1000; this.ewma = this.ewma ? 0.7 * this.ewma + 0.3 * tp : tp; this.ok++; }
  fail() { this.err++; }
  /** Untried peers get an optimistic prior so they are sampled early. */
  get score() { return (this.ewma || 1e6) * (1 - this.errRate); }
}
function shuffle(a, rng) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/**
 * peers: [{id, bits:Bitfield|null, stat:PeerStat, free:number, isNode?:boolean}]
 * inflight: Map<idx, Set<peerId>>   have: Bitfield
 * Returns Map<peerId, number[]> of chunk indices to request.
 */
export function planRequests({ have, peers, inflight, rng = Math.random, peerSelect = 'bandit', pieceSelect = 'rarest', epsilon = 0.1, endgameRatio = 0.95, maxDup = 3 }) {
  const n = have.n;
  const out = new Map();
  if (have.complete) return out;
  const avail = new Uint16Array(n), availPeers = new Uint16Array(n);
  for (const p of peers) {
    if (!p.bits) continue;
    for (let i = 0; i < n; i++) if (p.bits.has(i)) { avail[i]++; if (!p.isNode) availPeers[i]++; }
  }
  const endgame = have.count / n >= endgameRatio;
  const slots = new Map(peers.map((p) => [p.id, p.free]));
  const planned = new Map(); // idx -> count planned this round
  const mine = new Set();    // `${idx}:${peerId}`
  const candidates = (p) => {
    const list = [];
    for (let i = 0; i < n; i++) {
      if (have.has(i) || !p.bits.has(i)) continue;
      if (p.isNode && availPeers[i] > 0) continue;           // node is a fallback seed only
      const fl = inflight.get(i);
      if (fl && fl.has(p.id)) continue;
      if (mine.has(i + ':' + p.id)) continue;
      const active = (fl ? fl.size : 0) + (planned.get(i) || 0);
      if (endgame ? active >= maxDup : active > 0) continue;
      list.push(i);
    }
    return list;
  };
  for (;;) {
    const eligible = peers.filter((p) => p.bits && (slots.get(p.id) || 0) > 0);
    if (!eligible.length) break;
    const order = peerSelect === 'random' || rng() < epsilon ? shuffle(eligible, rng) : eligible.slice().sort((a, b) => b.stat.score - a.stat.score);
    let did = false;
    for (const p of order) {
      const c = candidates(p);
      if (!c.length) { slots.set(p.id, 0); continue; }
      let pick;
      if (pieceSelect === 'random' || have.count === 0) pick = c[Math.floor(rng() * c.length)];
      else {
        let min = Infinity, ties = [];
        for (const i of c) { if (avail[i] < min) { min = avail[i]; ties = [i]; } else if (avail[i] === min) ties.push(i); }
        pick = ties[Math.floor(rng() * ties.length)];
      }
      (out.get(p.id) ?? out.set(p.id, []).get(p.id)).push(pick);
      planned.set(pick, (planned.get(pick) || 0) + 1);
      mine.add(pick + ':' + p.id);
      slots.set(p.id, slots.get(p.id) - 1);
      did = true;
      break;
    }
    if (!did) break;
  }
  return out;
}
export const requestTimeoutMs = (rttMs, chunkBytes, bytesPerSec) => 3 * Math.max(rttMs, 20) + (chunkBytes / Math.max(bytesPerSec, 50 * 1024)) * 1000 + 2000;
