import React, { useRef, useState } from 'react';
import { fmtBytes } from '../core/bytes.js';
import { toCsv } from '../core/embargo.js';
import { Bar, Tag, Countdown, Spinner } from './common.jsx';

const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function download(name, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}

/* Icons */
const UploadIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
);
const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
  </svg>
);
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const SaveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
  </svg>
);
const DownArrowIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
  </svg>
);
const PauseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
  </svg>
);
const CsvIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
  </svg>
);

export default function Files({ s }) {
  const input = useRef();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [lock, setLock] = useState(false);
  const [when, setWhen] = useState(localInput(Date.now() + 3600e3));
  const [open, setOpen] = useState(null);

  const share = async (files) => {
    const embargoUntil = lock ? new Date(when).getTime() : null;
    if (lock && !(embargoUntil > Date.now() + 5000)) return setErr('Pick an unlock time in the future.');
    for (const f of files) {
      setErr('');
      try {
        setBusy({ name: f.name, p: 0 });
        await s.swarm.share(f, { embargoUntil, onProgress: (i, n) => setBusy({ name: f.name, p: i / n }) });
      } catch (e) { setErr(e.message); }
    }
    setBusy(null);
  };

  const list = [...s.swarm.T.values()].sort((a, b) => b.m.createdAt - a.m.createdAt);
  const staff = s.rec.role === 'owner' || s.rec.role === 'moderator';

  return (
    <div>
      {/* ── Drop zone ── */}
      <div
        className={'drop' + (over ? ' over' : '')}
        role="button"
        tabIndex={0}
        onClick={() => input.current.click()}
        onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); share([...e.dataTransfer.files]); }}
        style={{ marginBottom: 14 }}
      >
        <div className="drop-icon"><UploadIcon /></div>
        <strong style={{ fontSize: '1rem' }}>Share a file with the room</strong>
        <div className="muted small" style={{ marginTop: 6 }}>
          Tap to choose or drop here. Files are encrypted and split into chunks on your device first.
        </div>
        <input ref={input} type="file" multiple hidden onChange={(e) => { share([...e.target.files]); e.target.value = ''; }} />
      </div>

      {/* ── Embargo toggle ── */}
      <div className="lock" style={{ marginBottom: 14 }}>
        <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
            <LockIcon /> Embargoed drop
          </span>
        </label>
        {lock
          ? (
            <>
              <span className="small muted">Locked until</span>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Unlock time" style={{ width: 'auto' }} />
            </>
          )
          : (
            <span className="small muted">Send now, open later: everyone downloads in advance, then you release the key to all at once.</span>
          )}
      </div>
      {lock && (
        <p className="small muted" style={{ marginBottom: 14, marginTop: -6 }}>
          Your device holds the key and releases it at that time, so keep this room open on your device then, or press "Release now".
          Nobody else, including the Campus Node, can read the file before that.
        </p>
      )}

      {/* ── Upload progress ── */}
      {busy && (
        <div className="card" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Spinner />
            <span className="small">Encrypting and hashing <strong>{busy.name}</strong>…</span>
            <span className="small muted" style={{ marginLeft: 'auto' }}>{Math.round(busy.p * 100)}%</span>
          </div>
          <Bar v={busy.p} />
        </div>
      )}
      {err && <div className="err" style={{ marginBottom: 14 }}>{err}</div>}

      {/* ── File list ── */}
      <div>
        {!list.length && (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📂</div>
            <p className="muted">No files yet. Anything shared in this room appears here for everyone.</p>
          </div>
        )}
        {list.map((T) => {
          const done = T.bits.complete, p = T.bits.count / T.n, mine = T.m.authorPub === s.identity.pub;
          const author = [...s.members.values()].find((m) => m.pub === T.m.authorPub);
          const embargo = T.m.keyMode === 'file', unlocked = s.swarm.isUnlocked(T);
          const cov = (mine || staff) ? s.coverage(T.tid) : null, got = T.fromPeers + T.fromNode;
          return (
            <div className="card" key={T.tid} style={{ animation: 'fadeSlideUp .3s ease both' }}>
              {/* Header row */}
              <div className="row sp" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{
                    width: 36, height: 36,
                    background: 'var(--primary-light)',
                    borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--primary)', flexShrink: 0,
                  }}>
                    <FileIcon />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{T.m.name}</strong>
                    <span className="muted small">{fmtBytes(T.m.size)} · {T.n} chunks · from {mine ? 'you' : author?.name || 'a member'}</span>
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {embargo && <Tag kind={unlocked ? 'ok' : 'amb'}>{unlocked ? '🔓 unlocked' : '🔒 locked'}</Tag>}
                  {done
                    ? <Tag kind="ok"><CheckIcon /> verified</Tag>
                    : <Tag kind={T.state === 'downloading' ? 'blu' : ''}>{T.state}</Tag>}
                  {T.info && <Tag>{T.info.seeders} seeding</Tag>}
                </div>
              </div>

              {/* Embargo vault */}
              {embargo && !unlocked && (
                <div className="vault" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <LockIcon />
                    <span className="small muted">Opens in</span>
                    {T.m.embargoUntil ? <Countdown to={T.m.embargoUntil} /> : null}
                  </div>
                  <div className="small muted">
                    {done
                      ? 'You already have every chunk, verified. It will open the moment the author releases it.'
                      : 'You can download it now; it stays encrypted until release.'}
                  </div>
                  {mine && (
                    <button className="btn sm" style={{ marginTop: 10 }} onClick={() => s.release(T.tid).catch((e) => setErr(e.message))}>
                      Release now
                    </button>
                  )}
                </div>
              )}

              {/* Progress bar */}
              <div style={{ marginBottom: 8 }}>
                <Bar v={p} seed={done} />
              </div>
              <div className="row sp small muted" style={{ marginBottom: 10 }}>
                <span>
                  {Math.round(p * 100)}%
                  {' · ↓ '}{fmtBytes(T.bytesDown)}
                  {' · ↑ '}{fmtBytes(T.bytesUp)}
                  {T.speed > 1 && !done ? ` · ${fmtBytes(T.speed)}/s` : ''}
                  {got > 0 && !mine ? ` · ${Math.round((T.fromPeers / got) * 100)}% came from nearby devices` : ''}
                </span>
                <span>
                  {T.nodeSeeded > 0 && T.nodeSeeded < T.n ? `Campus Node: ${T.nodeSeeded}/${T.n}` : T.nodeSeeded === T.n ? 'Cached on Campus Node' : ''}
                  {T.nodeErr ? ' · node: ' + T.nodeErr : ''}
                </span>
              </div>

              {/* Delivery receipts */}
              {cov && cov.total > 0 && (
                <div style={{
                  padding: 14,
                  background: 'var(--success-light)',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--success)',
                  marginBottom: 12,
                }}>
                  <div className="row sp small" style={{ marginBottom: 8 }}>
                    <strong style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckIcon />
                      Delivery receipts: {cov.ready} of {cov.total} devices verified
                    </strong>
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn sm ghost" onClick={() => setOpen(open === T.tid ? null : T.tid)}>
                        {open === T.tid ? 'Hide' : 'Who?'}
                      </button>
                      <button className="btn sm ghost" onClick={() => download(T.m.name + '-receipts.csv', toCsv(T.m.name, cov.rows))}>
                        <CsvIcon /> Export CSV
                      </button>
                    </span>
                  </div>
                  <Bar v={cov.total ? cov.ready / cov.total : 0} seed={cov.ready === cov.total} />
                  {open === T.tid && (
                    <table style={{ marginTop: 10 }}>
                      <tbody>
                        {cov.rows.map((r) => (
                          <tr key={r.peerId}>
                            <td>{r.name}</td>
                            <td>{r.ready ? <Tag kind="ok"><CheckIcon /> verified</Tag> : <Tag>waiting</Tag>}</td>
                            <td className="small muted">{r.at ? new Date(r.at).toLocaleTimeString() : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="small muted" style={{ margin: '8px 0 0' }}>
                    Each receipt is signed by that device and bound to this exact file. It is the device's own statement, not an independent audit.
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="row" style={{ gap: 8 }}>
                {!done && T.state !== 'downloading' && (
                  <button className="btn sm" onClick={() => s.swarm.start(T.tid)}>
                    <DownArrowIcon /> {T.bits.count ? 'Resume' : 'Download'}
                  </button>
                )}
                {!done && T.state === 'downloading' && (
                  <button className="btn sm ghost" onClick={() => s.swarm.pause(T.tid)}>
                    <PauseIcon /> Pause
                  </button>
                )}
                {done && (
                  <button
                    className="btn sm"
                    disabled={!unlocked}
                    title={unlocked ? '' : 'Locked until released'}
                    onClick={() => s.swarm.saveFile(T.tid).catch((e) => setErr(e.message))}
                  >
                    <SaveIcon /> {unlocked ? 'Save file' : 'Locked'}
                  </button>
                )}
                <button className="btn sm warn" onClick={() => confirm('Remove from this device?') && s.swarm.remove(T.tid)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
