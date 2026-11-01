// Fluid-model swarm simulator used by the CLI benchmark and the in-app Benchmark page.
// It reuses the real scheduler (planRequests) so the strategy comparison exercises production logic.
import { Bitfield } from './bitfield.js';
import { PeerStat, planRequests, mulberry32 } from './scheduler.js';

export const STRATEGIES = {
  single: { label: 'Single source' },
  random: { label: 'Swarm: random peer + random piece', peerSelect: 'random', pieceSelect: 'random' },
  rarest: { label: 'Swarm: random peer + rarest-first', peerSelect: 'random', pieceSelect: 'rarest' },
  bandit: { label: 'Swarm: bandit peer + rarest-first', peerSelect: 'bandit', pieceSelect: 'rarest' },
};

export function runSim(opts = {}) {
  const o = { peers: 30, fileMB: 100, chunkKB: 1024, sourceMbps: 100, peerUpMbps: 50, peerDownMbps: 100, hetero: 0.6, strategy: 'bandit',
    epsilon: 0.1, failFrac: 0, failAtSec: 20, dt: 0.5, seed: 1, maxOutstanding: 4, uploadSlots: 5, maxTime: 20000, ...opts };
  const rng = mulberry32(o.seed);
  const chunkBytes = o.chunkKB * 1024, fileBytes = o.fileMB * 1024 * 1024;
  const n = Math.max(1, Math.ceil(fileBytes / chunkBytes));
  const mbps = (x) => (x * 1e6) / 8;
  const E = [{ id: 'S', up: mbps(o.sourceMbps), down: 0, bits: Bitfield.full(n), alive: true, source: true }];
  for (let i = 1; i <= o.peers; i++) {
    E.push({ id: 'P' + i, up: mbps(o.peerUpMbps) * Math.max(0.15, 1 + o.hetero * (rng() * 2 - 1)), down: mbps(o.peerDownMbps),
      bits: new Bitfield(n), alive: true, stats: new Map(), inflight: new Map(), doneAt: null });
  }
  const byId = new Map(E.map((e) => [e.id, e]));
  const queues = new Map(E.map((e) => [e.id, []])); // uploader id -> requests
  const strat = STRATEGIES[o.strategy];
  let t = 0, sourceBytes = 0, killed = false, step = 0;
  const peersAll = E.slice(1);

  while (t < o.maxTime) {
    if (!killed && o.failFrac > 0 && t >= o.failAtSec) {
      killed = true;
      const victims = peersAll.filter((p) => !p.doneAt).sort(() => rng() - 0.5).slice(0, Math.floor(o.peers * o.failFrac));
      for (const v of victims) v.alive = false;
      for (const [uid, q] of queues) {
        queues.set(uid, q.filter((r) => {
          const ok = byId.get(r.from).alive && byId.get(r.to).alive;
          if (!ok && byId.get(r.to).alive) byId.get(r.to).stats.get(r.from)?.fail();
          return ok;
        }));
      }
      for (const p of peersAll) if (p.alive) for (const set of p.inflight.values()) for (const id of [...set]) if (!byId.get(id).alive) set.delete(id);
    }
    const live = peersAll.filter((p) => p.alive && !p.doneAt);
    if (!live.length) break;
    // 1. plan
    for (const d of live) {
      const list = [];
      const sources = o.strategy === 'single' ? [E[0]] : E.filter((e) => e !== d && e.alive);
      for (const s of sources) {
        let st = d.stats.get(s.id); if (!st) d.stats.set(s.id, (st = new PeerStat()));
        let cnt = 0; for (const set of d.inflight.values()) if (set.has(s.id)) cnt++;
        list.push({ id: s.id, bits: s.bits, stat: st, free: Math.max(0, o.maxOutstanding - cnt) });
      }
      if (!list.some((p) => p.free > 0)) continue;
      const plan = planRequests({ have: d.bits, peers: list, inflight: d.inflight, rng, epsilon: o.epsilon,
        peerSelect: strat.peerSelect ?? 'random', pieceSelect: strat.pieceSelect ?? 'rarest' });
      for (const [pid, idxs] of plan) for (const idx of idxs) {
        (d.inflight.get(idx) ?? d.inflight.set(idx, new Set()).get(idx)).add(pid);
        queues.get(pid).push({ from: pid, to: d.id, idx, rem: chunkBytes, t0: t, tStart: null });
      }
    }
    // 2. allocate bandwidth: each uploader serves its first N requests, split evenly
    const active = [];
    for (const e of E) {
      if (!e.alive) continue;
      const q = queues.get(e.id).slice(0, o.uploadSlots);
      for (const r of q) { if (r.tStart === null) r.tStart = t; active.push([e, r, q.length]); }
    }
    const downCount = new Map();
    for (const [, r] of active) downCount.set(r.to, (downCount.get(r.to) || 0) + 1);
    const done = [];
    for (const [up, r, k] of active) {
      const d = byId.get(r.to);
      const rate = Math.min(up.up / k, d.down / downCount.get(r.to));
      const moved = Math.min(r.rem, rate * o.dt);
      r.rem -= moved;
      if (up.source) sourceBytes += moved;
      if (r.rem <= 1e-6) done.push(r);
    }
    t += o.dt; step++;
    // 3. completions
    for (const r of done) {
      const q = queues.get(r.from); const k = q.indexOf(r); if (k >= 0) q.splice(k, 1);
      const d = byId.get(r.to); if (!d.alive) continue;
      d.stats.get(r.from)?.record(chunkBytes, Math.max((t - r.tStart) * 1000, 1));
      d.inflight.get(r.idx)?.delete(r.from);
      if (d.bits.set(r.idx)) {
        d.inflight.delete(r.idx);
        for (const [uid, qq] of queues) { // cancel duplicate requests (endgame)
          const j = qq.findIndex((x) => x.to === d.id && x.idx === r.idx); if (j >= 0) qq.splice(j, 1);
        }
        if (d.bits.complete) d.doneAt = t;
      }
    }
  }
  const times = peersAll.filter((p) => p.doneAt).map((p) => p.doneAt).sort((a, b) => a - b);
  const alive = peersAll.filter((p) => p.alive).length;
  return {
    strategy: o.strategy, peers: o.peers, alive, completed: times.length, failedTransfers: alive - times.length,
    timeToLast: times.length ? times[times.length - 1] : null,
    mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    median: times.length ? times[Math.floor(times.length / 2)] : null,
    sourceMB: sourceBytes / 1048576,
    sourcePct: (sourceBytes / (fileBytes * o.peers)) * 100,
  };
}
export function compare(opts, runs = 3) {
  const out = {};
  for (const s of Object.keys(STRATEGIES)) {
    const rs = Array.from({ length: runs }, (_, i) => runSim({ ...opts, strategy: s, seed: (opts.seed ?? 1) + i * 101 }));
    const avg = (f) => rs.reduce((a, r) => a + (r[f] ?? 0), 0) / rs.length;
    const mean = avg('timeToLast');
    const sd = Math.sqrt(rs.reduce((a, r) => a + ((r.timeToLast ?? 0) - mean) ** 2, 0) / rs.length);
    out[s] = { label: STRATEGIES[s].label, timeToLast: mean, sd, mean: avg('mean'), sourceMB: avg('sourceMB'), sourcePct: avg('sourcePct'), failed: avg('failedTransfers'), runs };
  }
  return out;
}
