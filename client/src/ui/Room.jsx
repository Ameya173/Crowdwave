import React, { useEffect, useState } from 'react';
import { useApp, go } from '../app.js';
import { peerIdOf } from '../core/crypto.js';
import Files from './Files.jsx';
import Messages from './Messages.jsx';
import Swarm from './Swarm.jsx';
import Members from './Members.jsx';
import { Tag, Spinner } from './common.jsx';

/* Icon: files */
const FilesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
  </svg>
);
/* Icon: messages */
const MsgIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
/* Icon: swarm */
const SwarmIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);
/* Icon: people */
const PeopleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
/* Icon: back */
const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
/* Icon: moon/wake */
const MoonIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export default function Room({ roomId }) {
  const app = useApp();
  const [tab, setTab] = useState('files');
  const [ownerId, setOwnerId] = useState('');

  useEffect(() => {
    if (app.identity && app.rooms.length >= 0) app.openRoom(roomId);
  }, [roomId, app.identity, app.rooms.length]);

  const s = app.session?.roomId === roomId ? app.session : null;

  useEffect(() => {
    if (s?.rec.ownerPub) peerIdOf(s.rec.ownerPub).then(setOwnerId);
  }, [s?.rec.ownerPub]);

  /* Room not found */
  if (!app.rooms.find((r) => r.roomId === roomId))
    return (
      <div className="wrap">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔍</div>
          <h2>Room not found on this device</h2>
          <p style={{ color: 'var(--text-2)', marginBottom: 20 }}>Use an invite link to join it.</p>
          <a href="#/" className="btn ghost"><BackIcon /> Back to home</a>
        </div>
      </div>
    );

  /* Loading */
  if (!s)
    return (
      <div className="wrap">
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Spinner />
          <span>Opening room…</span>
        </div>
      </div>
    );

  /* ── Room header ── */
  const head = (
    <div className="room-header">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="small muted" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-2)', fontWeight: 500 }}>
              <BackIcon /> All rooms
            </a>
          </div>
          <h1 style={{ marginBottom: 6 }}>{s.rec.name}</h1>
          <div className="room-meta">
            <Tag kind={s.rec.role === 'owner' ? 'amb' : s.rec.role === 'moderator' ? 'blu' : ''}>{s.rec.role}</Tag>
            <span className="tag">
              <span className="pulse-dot on" style={{ width: 7, height: 7 }} />
              {s.online.size + 1} online
            </span>
            {s.wake && (
              <span className="tag blu"><MoonIcon /> Screen kept awake</span>
            )}
          </div>
        </div>
        <div>
          <Tag kind={app.status === 'ready' ? 'ok' : 'bad'}>
            {app.status === 'ready' ? 'Campus Node connected' : 'Node offline: peers only'}
          </Tag>
        </div>
      </div>
    </div>
  );

  /* ── Status states ── */
  if (s.status === 'pending')
    return (
      <div className="wrap">
        {head}
        <div className="card note" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Spinner />
          <div>
            <strong>Waiting for approval</strong>
            <div className="small muted">Waiting for the room owner to approve you. Keep this page open; the owner must be online.</div>
          </div>
        </div>
      </div>
    );

  if (s.status === 'rejected')
    return (
      <div className="wrap">
        {head}
        <div className="card err">
          <strong>Access declined</strong>
          <div style={{ marginTop: 4 }}>The owner declined your request.</div>
        </div>
      </div>
    );

  if (s.status === 'removed')
    return (
      <div className="wrap">
        {head}
        <div className="card err">
          <strong>Removed</strong>
          <div style={{ marginTop: 4 }}>You are no longer a member of this room.</div>
        </div>
      </div>
    );

  if (s.status === 'error')
    return (
      <div className="wrap">
        {head}
        <div className="card err" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div><strong>Connection error</strong><div style={{ marginTop: 4 }}>{s.error}</div></div>
          <button className="btn sm" onClick={() => s.join()}>Try again</button>
        </div>
      </div>
    );

  if (s.status !== 'active')
    return (
      <div className="wrap">
        {head}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Spinner />
          <span>Connecting to the Campus Node…</span>
        </div>
      </div>
    );

  const pendingCount = s.isOwner && s.pending.length;
  const tabs = [
    ['files',    <><FilesIcon />  Files</>,   null],
    ['messages', <><MsgIcon />   Messages</>, null],
    ['swarm',    <><SwarmIcon /> Swarm</>,    null],
    ['people',   <><PeopleIcon /> People &amp; settings</>, pendingCount || null],
  ];

  return (
    <div className="wrap">
      {head}
      {s.error && <div className="err" style={{ marginBottom: 16 }}>{s.error}</div>}

      <div className="tabs" role="tablist">
        {tabs.map(([k, label, badge]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={'tab' + (tab === k ? ' on' : '')}
            onClick={() => setTab(k)}
          >
            {label}
            {badge ? <span className="tab-badge">{badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'files'    && <Files   s={s} />}
      {tab === 'messages' && <Messages s={s} />}
      {tab === 'swarm'    && <Swarm   s={s} />}
      {tab === 'people'   && <Members s={s} ownerId={ownerId} />}
    </div>
  );
}
