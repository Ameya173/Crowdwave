// Gossip dissemination simulator (random mesh, per-hop latency). Mirrors Gossip._forward semantics:
// the origin sends hops=1 to `fanout` random neighbours; a node with hops<ttl forwards with hops+1.
import { mulberry32 } from './scheduler.js';

export function gossipSim({ peers = 100, degree = 8, fanout = 3, ttl = 8, minMs = 15, maxMs = 80, drop = 0, seed = 1, aeRounds = 3, aePeriodMs = 5000 } = {}) {
  const rng = mulberry32(seed), adj = Array.from({ length: peers }, () => new Set());
  const link = (a, b) => { if (a !== b) { adj[a].add(b); adj[b].add(a); } };
  for (let i = 0; i < peers; i++) link(i, (i + 1) % peers);                       // ring keeps the graph connected
  for (let i = 0; i < peers; i++) while (adj[i].size < degree) link(i, Math.floor(rng() * peers));
  const seen = new Array(peers).fill(null), heap = [];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let messages = 0;
  const forward = (t, node, hops, from) => {
    const nb = [...adj[node]].filter((x) => x !== from).sort(() => rng() - 0.5).slice(0, fanout);
    for (const x of nb) { if (rng() < drop) continue; messages++; push([t + minMs + rng() * (maxMs - minMs), x, hops, node]); }
  };
  seen[0] = 0; forward(0, 0, 1, -1);
  while (heap.length) {
    const [t, node, hops, from] = pop();
    if (seen[node] !== null) continue;
    seen[node] = t;
    if (hops < ttl) forward(t, node, hops + 1, from);
  }
  const gossipOnly = seen.filter((x) => x !== null).length;
  // anti-entropy: every period each node still missing the message pulls from one random neighbour
  for (let r = 1; r <= aeRounds; r++) {
    const tr = r * aePeriodMs, got = [];
    for (let i = 0; i < peers; i++) if (seen[i] === null) { const nb = [...adj[i]][Math.floor(rng() * adj[i].size)]; if (seen[nb] !== null && seen[nb] <= tr) got.push(i); }
    for (const i of got) seen[i] = tr + minMs + rng() * (maxMs - minMs);
  }
  const times = seen.filter((x) => x !== null).sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  return { reachPct: (gossipOnly / peers) * 100, reachAfterSyncPct: (times.length / peers) * 100, p50: q(0.5), p95: q(0.95), max: times[times.length - 1], messages };
}
export function sweep(base = {}, runs = 5) {
  const rows = [];
  for (const fanout of [1, 2, 3, 4, 5]) for (const ttl of [2, 3, 4, 6, 8]) {
    const rs = Array.from({ length: runs }, (_, i) => gossipSim({ ...base, fanout, ttl, seed: 7 + i }));
    const avg = (f) => rs.reduce((a, r) => a + r[f], 0) / runs;
    rows.push({ fanout, ttl, reachPct: avg('reachPct'), reachAfterSyncPct: avg('reachAfterSyncPct'), p50: avg('p50'), p95: avg('p95'), messages: avg('messages') });
  }
  return rows;
}
