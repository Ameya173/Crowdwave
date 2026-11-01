import React, { useState } from 'react';
import { fmtBytes } from '../core/bytes.js';
import { fmtId } from '../core/crypto.js';
import { Tag, Avatar } from './common.jsx';

/* Connection type colors — updated to match new palette */
const COL = { direct: '#10b981', stun: '#6366f1', relay: '#f59e0b', '…': '#94a3b8' };
const COL_GLOW = { direct: 'rgba(16,185,129,.4)', stun: 'rgba(99,102,241,.4)', relay: 'rgba(245,158,11,.4)', '…': 'rgba(148,163,184,.2)' };

export default function Swarm({ s }) {
  const ts = [...s.swarm.T.values()];
  const [sel, setSel] = useState(null);
  const T = ts.find((t) => t.tid === sel) || ts.find((t) => t.state === 'downloading') || ts[0];
  const links = s.peers.open;
  const W = 420, C = W / 2, R = 150;
  const name = (id) => [...s.members.values()].find((m) => m.peerId === id)?.name || id.slice(0, 6);
  const prog = (l) => (T && l.bits?.get(T.tid) ? l.bits.get(T.tid).count / T.n : 0);

  /* Stats */
  const totalDown = links.reduce((a, l) => a + (l.downTotal || 0), 0);
  const totalUp   = links.reduce((a, l) => a + (l.upTotal || 0), 0);

  return (
    <div>
      {/* ── Stats row ── */}
      <div className="grid2" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="val">{links.length}</div>
          <div className="lbl">Active peers</div>
        </div>
        <div className="metric-card">
          <div className="val">{fmtBytes(totalDown)}</div>
          <div className="lbl">Total received</div>
        </div>
        <div className="metric-card">
          <div className="val">{fmtBytes(totalUp)}</div>
          <div className="lbl">Total sent</div>
        </div>
      </div>

      {/* ── Graph controls ── */}
      <div className="row sp" style={{ marginBottom: 12 }}>
        <div className="small muted">
          {links.length} direct connection{links.length === 1 ? '' : 's'} · {s.online.size} online in room
        </div>
        {ts.length > 0 && (
          <select value={T?.tid} onChange={(e) => setSel(e.target.value)} style={{ width: 'auto' }} aria-label="Transfer">
            {ts.map((t) => <option key={t.tid} value={t.tid}>{t.m.name}</option>)}
          </select>
        )}
      </div>

      {/* ── SVG graph ── */}
      <svg
        className="graph"
        viewBox={`0 0 ${W} ${W}`}
        role="img"
        aria-label="Live map of peers connected to this device"
        style={{ marginBottom: 10, display: 'block' }}
      >
        <defs>
          <filter id="glow-green">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-indigo">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Connection lines */}
        {links.map((l, i) => {
          const a = (i / Math.max(1, links.length)) * Math.PI * 2 - Math.PI / 2;
          const x = C + R * Math.cos(a), y = C + R * Math.sin(a);
          const active = Date.now() - (l.lastData || 0) < 1500;
          return (
            <g key={l.id}>
              {/* Glow line behind */}
              <line
                x1={C} y1={C} x2={x} y2={y}
                stroke={COL_GLOW[l.connType] || COL_GLOW['…']}
                strokeWidth={3 + Math.min(6, (l.bytesDown + l.bytesUp) / 3e6)}
                opacity="0.5"
              />
              {/* Main line */}
              <line
                x1={C} y1={C} x2={x} y2={y}
                stroke={COL[l.connType] || COL['…']}
                strokeWidth={1.5 + Math.min(3, (l.bytesDown + l.bytesUp) / 5e6)}
                opacity=".85"
                className={active ? 'flow' : ''}
              />
              {/* Peer node circle */}
              <circle
                cx={x} cy={y} r="20"
                fill="var(--surface)"
                stroke={COL[l.connType] || COL['…']}
                strokeWidth="2"
                filter={active ? 'url(#glow-indigo)' : undefined}
              />
              {/* Progress arc */}
              <path
                d={`M${x} ${y - 17} A17 17 0 ${prog(l) > 0.5 ? 1 : 0} 1 ${x + 17 * Math.sin(prog(l) * Math.PI * 2)} ${y - 17 * Math.cos(prog(l) * Math.PI * 2)}`}
                fill="none"
                stroke={COL.direct}
                strokeWidth="3"
                display={prog(l) > 0 && prog(l) < 1 ? 'block' : 'none'}
              />
              {/* Full progress dot */}
              {prog(l) >= 1 && <circle cx={x} cy={y} r="13" fill={COL.direct} />}
              {/* Peer label */}
              <text x={x} y={y + 4} fontSize="9" textAnchor="middle" fill="var(--text)" fontWeight="600" dominantBaseline="middle">
                {name(l.id).slice(0, 8)}
              </text>
              <text x={x} y={y + 34} fontSize="9" textAnchor="middle" fill="var(--text-3)">
                {l.rtt ? `${l.rtt}ms` : ''}
              </text>
            </g>
          );
        })}

        {/* Pulse ring on active data */}
        {links.some((l) => Date.now() - (l.lastData || 0) < 1500) && (
          <circle className="pulse" cx={C} cy={C} r="28" />
        )}

        {/* Center "you" node */}
        <circle cx={C} cy={C} r="28" fill="var(--primary)" filter="url(#glow-indigo)" />
        <text x={C} y={C} fontSize="11" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontWeight="700">you</text>

        {/* Empty message */}
        {!links.length && (
          <text x={C} y={C + 70} fontSize="12" textAnchor="middle" fill="var(--text-3)">Waiting for peers…</text>
        )}
      </svg>

      {/* Legend */}
      <p className="small muted" style={{ marginBottom: 14 }}>
        Line colour:&nbsp;
        <b style={{ color: COL.direct }}>direct (same network)</b>,&nbsp;
        <b style={{ color: COL.stun }}>via STUN</b>,&nbsp;
        <b style={{ color: COL.relay }}>via TURN relay</b>.
        Ring = how much of the selected file that peer has.
      </p>

      {/* ── Peers table ── */}
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Peer</th>
              <th>Link</th>
              <th>RTT</th>
              <th>↓ from</th>
              <th>↑ to</th>
              <th>Score</th>
              <th style={{ paddingRight: 16 }}>Has</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id}>
                <td style={{ paddingLeft: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={name(l.id)} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600 }}>{name(l.id)}</div>
                      <div className="mono small muted">{fmtId(l.id).slice(0, 14)}…</div>
                    </div>
                  </div>
                </td>
                <td>
                  <Tag kind={l.connType === 'direct' ? 'ok' : l.connType === 'relay' ? 'amb' : 'blu'}>
                    {l.connType}
                  </Tag>
                </td>
                <td>{l.rtt || '–'} ms</td>
                <td>{fmtBytes(l.downTotal || 0)}</td>
                <td>{fmtBytes(l.upTotal || 0)}</td>
                <td>
                  {l.stat ? fmtBytes(Math.round(l.stat.ewma)) + '/s' : '–'}
                  {l.stat?.err ? <span className="small muted"> ({l.stat.err} err)</span> : ''}
                </td>
                <td style={{ paddingRight: 16 }}>{Math.round(prog(l) * 100)}%</td>
              </tr>
            ))}
            {!links.length && (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-3)' }}>
                  No peers connected. The Campus Node can still serve cached files.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Gossip stats ── */}
      <div className="row small muted" style={{ marginTop: 12, gap: 16, flexWrap: 'wrap' }}>
        <span>
          Gossip: {s.gossip.stats.accepted} accepted · {s.gossip.stats.dup} duplicates · {s.gossip.stats.rejected} rejected · {s.gossip.stats.forwarded} forwarded
        </span>
        <span>Manifests rejected: {s.swarm.rejected}</span>
      </div>
    </div>
  );
}
