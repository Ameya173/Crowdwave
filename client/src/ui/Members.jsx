import React, { useEffect, useState } from 'react';
import { sas, fmtId } from '../core/crypto.js';
import { QrCode } from './Qr.jsx';
import { Copy, Tag, Avatar } from './common.jsx';

function Sas({ a, b }) {
  const [v, set] = useState('');
  useEffect(() => { sas(a, b).then(set); }, [a, b]);
  return <span className="mono">{v}</span>;
}

/* Icons */
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const KeyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);
const ShieldIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function Members({ s, ownerId }) {
  const link = `${location.origin}/#/join/${s.roomId}/${ownerId}`;
  const [show, setShow] = useState(null);
  const [err, setErr] = useState('');
  const run = (fn) => fn().catch((e) => setErr(e.code || e.message));
  const list = [...s.members.values()].filter((m) => m.status === 'active');
  const set = (k) => (e) => s.saveSettings({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div>
      {err && <div className="err" style={{ marginBottom: 14 }}>{err}</div>}

      {/* ── Invite + Settings grid ── */}
      <div className="grid2" style={{ marginBottom: 16 }}>
        {/* Invite card */}
        <div className="card">
          <h2 style={{ marginBottom: 14 }}>Invite people</h2>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <QrCode text={link} />
          </div>
          <div className="mono small" style={{
            padding: '8px 10px',
            background: 'var(--surface-2)',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)',
            wordBreak: 'break-all',
            marginBottom: 10,
            color: 'var(--text-2)',
          }}>
            {link}
          </div>
          <Copy text={link} label="Copy invite link" />
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            The link contains the room owner's fingerprint, so joiners can tell if they were sent to the wrong room.
          </p>
        </div>

        {/* Transfer settings */}
        <div className="card">
          <h2 style={{ marginBottom: 14 }}>Transfer settings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {[
              ['autoDownload', 'Download new files automatically'],
              ['useNode', 'Use the Campus Node as a fallback source'],
              ['seedToNode', 'Copy files I share to the Campus Node (encrypted)'],
              ['classroom', 'Classroom mode: serve every peer fairly (off = tit-for-tat)'],
            ].map(([k, l]) => (
              <label className="switch settings-row" key={k} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={!!s.settings[k]} onChange={set(k)} style={{ accentColor: 'var(--primary)', marginTop: 3 }} />
                <span style={{ fontSize: '.9rem' }}>{l}</span>
              </label>
            ))}
          </div>
          <div className="grid2" style={{ gap: 10 }}>
            <div>
              <label className="small muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Peer selection</label>
              <select value={s.settings.peerSelect} onChange={set('peerSelect')}>
                <option value="bandit">Bandit (fastest peers)</option>
                <option value="random">Random</option>
              </select>
            </div>
            <div>
              <label className="small muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Chunk selection</label>
              <select value={s.settings.pieceSelect} onChange={set('pieceSelect')}>
                <option value="rarest">Rarest first</option>
                <option value="random">Random</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Pending approvals ── */}
      {s.isOwner && s.pending.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--warning)', borderWidth: 1 }}>
          <h2 style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: 'var(--warning-light)', color: 'var(--warning)', borderRadius: 99, padding: '2px 10px', fontSize: '.82rem', fontWeight: 700 }}>
              {s.pending.length} waiting
            </span>
            Waiting to join
          </h2>
          {s.pending.map((p) => (
            <div key={p.peerId} className="pending-row">
              <Avatar name={p.name || '?'} size="md" />
              <div className="info">
                <strong>{p.name || 'Unnamed device'}</strong>
                <div className="mono small muted">{fmtId(p.peerId)}</div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <button
                  className="btn sm"
                  onClick={() => run(() => s.approve(p.peerId))}
                  style={{ background: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <CheckIcon /> Approve
                </button>
                <button
                  className="btn sm warn"
                  onClick={() => run(() => s.reject(p.peerId))}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <XIcon /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Members list ── */}
      <div className="card">
        <div className="row sp" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>People ({list.length})</h2>
          {s.isOwner && (
            <button
              className="btn sm ghost"
              onClick={() => confirm('Create a new room key for everyone? New files will use it.') && run(() => s.rekey())}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <KeyIcon /> Rotate room key
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginBottom: 14 }}>
          Key epoch {s.epoch}. Compare the 4-group code with the other person to confirm you are talking to the right device.
        </p>
        <div>
          {list.map((m) => {
            const online = m.peerId === s.me || s.online.has(m.peerId);
            return (
              <div key={m.pub} className="member-row">
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar name={m.name || '?'} size="md" />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 0, right: 0,
                      width: 10, height: 10,
                      borderRadius: '50%',
                      background: online ? 'var(--success)' : 'var(--text-3)',
                      border: '2px solid var(--surface)',
                    }}
                  />
                </div>
                <div className="info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{m.name || 'Unnamed device'}</strong>
                    {m.peerId === s.me && <span className="small muted">(you)</span>}
                    <Tag kind={m.role === 'owner' ? 'amb' : m.role === 'moderator' ? 'blu' : ''}>{m.role}</Tag>
                  </div>
                  {show === m.pub && (
                    <div className="small" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ShieldIcon />
                      Security code: <Sas a={s.identity.pub} b={m.pub} />
                      <span className="muted">· ID {fmtId(m.peerId)}</span>
                    </div>
                  )}
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {m.peerId !== s.me && (
                    <button className="btn sm ghost" onClick={() => setShow(show === m.pub ? null : m.pub)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ShieldIcon /> Verify <ChevronDownIcon />
                    </button>
                  )}
                  {s.isOwner && m.role !== 'owner' && (
                    <>
                      <button
                        className="btn sm ghost"
                        onClick={() => run(() => s.setRole(m.peerId, m.role === 'moderator' ? 'member' : 'moderator'))}
                      >
                        {m.role === 'moderator' ? 'Demote' : 'Make mod'}
                      </button>
                      <button
                        className="btn sm warn"
                        onClick={() => confirm(`Remove ${m.name || 'this person'} and rotate the room key?`) && run(() => s.removeMember(m.peerId))}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
