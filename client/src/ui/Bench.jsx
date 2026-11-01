import React, { useState } from 'react';
import { compare, runSim } from '../core/sim.js';
import { gossipSim } from '../core/gossipsim.js';

export default function Bench() {
  const [p, setP] = useState({ peers: 30, fileMB: 100, sourceMbps: 100, peerUpMbps: 50, runs: 2 });
  const [res, setRes] = useState(null); const [fail, setFail] = useState(null); const [busy, setBusy] = useState(false); const [gos, setGos] = useState(null);
  const set = (k) => (e) => setP({ ...p, [k]: +e.target.value });
  const run = () => {
    setBusy(true); setRes(null);
    setTimeout(() => {
      const base = { peers: p.peers, fileMB: p.fileMB, chunkKB: 1024, sourceMbps: p.sourceMbps, peerUpMbps: p.peerUpMbps, dt: 0.5 };
      const r = compare(base, p.runs);
      setRes(r); setGos(gossipSim({ peers: Math.max(p.peers, 20), fanout: 3, ttl: 8, aeRounds: 0, seed: 4 })); setFail(runSim({ ...base, strategy: 'bandit', failFrac: 0.2, failAtSec: r.bandit.timeToLast / 3 })); setBusy(false);
    }, 30);
  };
  const max = res ? Math.max(...Object.values(res).map((x) => x.timeToLast)) : 1;
  return (
    <div className="wrap">
      <div className="card flat"><h1>Benchmark: swarm vs single source</h1><p className="muted">A simulation that runs the same chunk-scheduling code as the real app. It models bandwidth, so use it to compare strategies; the real-device numbers come from your own trial.</p></div>
      <div className="card"><div className="grid2">
        {[['peers', 'Receivers', 2, 100], ['fileMB', 'File size (MB)', 1, 2000], ['sourceMbps', 'Source upload (Mbps)', 1, 1000], ['peerUpMbps', 'Typical peer upload (Mbps)', 1, 1000], ['runs', 'Runs per strategy', 1, 5]].map(([k, l, a, b]) => <div key={k}><label className="small muted">{l}</label><input type="number" min={a} max={b} value={p[k]} onChange={set(k)} /></div>)}
      </div><div style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={run}>{busy ? 'Simulating…' : 'Run simulation'}</button></div></div>
      {res && <div className="card"><h2>Time until the last device finishes</h2>
        <div className="bars">{Object.entries(res).map(([k, v]) => <div className="b" key={k}><span>{v.label}</span><div className="bar" style={{ height: 16 }}><i style={{ width: (v.timeToLast / max) * 100 + '%', background: k === 'single' ? '#9fb3c8' : '#1d6fd8' }} /></div><b>{v.timeToLast.toFixed(0)} s</b></div>)}</div>
        <p style={{ marginTop: 14 }}><b>{(res.single.timeToLast / res.bandit.timeToLast).toFixed(1)}× faster</b> with the swarm; the source uploaded {res.bandit.sourcePct.toFixed(1)}% of the bytes it would send alone.</p>
        {gos && <p className="muted">Embargoed drop: if everyone downloads before the unlock time, opening the file costs only the key release, which in the gossip model reached {gos.reachPct.toFixed(0)}% of devices with a 95th-percentile delay of {gos.p95.toFixed(0)} ms. Starting the download at release time would cost {res.bandit.timeToLast.toFixed(0)} s.</p>}
        {fail && <p className="muted">With 20% of peers dropping out mid-transfer: {fail.completed} of {fail.alive} remaining devices completed, {fail.failedTransfers} failed transfers.</p>}</div>}
    </div>
  );
}
