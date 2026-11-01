import React, { useState } from 'react';
import { useApp, go } from '../app.js';
import { fmtId } from '../core/crypto.js';
import { QrScanner } from './Qr.jsx';
import { Tag, Avatar } from './common.jsx';

export function parseInvite(text) {
  const m = String(text).match(/#\/join\/([a-z2-7]{10})\/([a-z2-7]{26})/);
  return m ? { roomId: m[1], ownerId: m[2] } : null;
}

const ShieldIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const WifiIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);
const LockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const ZapIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);
const QrIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="3" height="3" />
    <line x1="21" y1="14" x2="21" y2="14.01" /><line x1="21" y1="21" x2="21" y2="21.01" />
    <line x1="17" y1="21" x2="17" y2="21.01" />
  </svg>
);
const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const DoorIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export default function Home() {
  const app = useApp();
  const [name, setName] = useState(app.identity?.name || '');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [room, setRoom] = useState({ name: '', openJoin: false, hours: 24 });
  const [invite, setInvite] = useState('');
  const [scan, setScan] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (app.identity?.name && !name) {
      setName(app.identity.name);
    }
  }, [app.identity?.name]);

  const handleSaveName = async () => {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      setSaveErr('Please enter a display name.');
      return;
    }
    setSaveErr('');
    try {
      await app.setName(trimmed);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      setSaveErr('Could not save name: ' + (e.message || e));
    }
  };

  const join = async (text) => {
    const i = parseInvite(text);
    if (!i) return setErr('That does not look like a Crowdwave invite link.');
    setErr('');
    await app.addInvite(i.roomId, i.ownerId);
    go('#/room/' + i.roomId);
  };

  const create = async () => {
    if (!room.name.trim()) return setErr('Give the room a name.');
    setBusy(true); setErr('');
    try { go('#/room/' + (await app.createRoom({ name: room.name.trim(), openJoin: room.openJoin, hours: +room.hours || 0 }))); }
    catch (e) { setErr('Could not create the room: ' + e.message); }
    setBusy(false);
  };

  return (
    <div className="wrap">
      {/* ── Hero ── */}
      <div className="card hero anim-fade" style={{ marginBottom: 20 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>Send it early. Prove everyone has it. <b>Open it together.</b></h1>
          <p>
            Crowdwave moves files between phones and laptops on the same Wi-Fi, even with no internet.
            Everything is encrypted on your device, delivery is proven with signed receipts, and embargoed
            files open for the whole room at the moment you release them.
          </p>
          <div className="feature-badges">
            <span className="feature-badge"><ShieldIcon /> E2E Encrypted</span>
            <span className="feature-badge"><WifiIcon /> Works Offline</span>
            <span className="feature-badge"><LockIcon /> Signed Receipts</span>
            <span className="feature-badge"><ZapIcon /> Peer-to-Peer</span>
          </div>
        </div>
      </div>

      {/* ── Device + Join grid ── */}
      <div className="grid2 anim-fade-2">
        {/* This device */}
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>This device</h2>
          <div style={{ marginBottom: 14 }}>
            <label className="small muted" htmlFor="nm" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Your display name
            </label>
            <div className="row">
              <input
                id="nm"
                type="text"
                maxLength={32}
                value={name}
                onChange={(e) => { setName(e.target.value); setSaveErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); }}
                placeholder="e.g. Ameya"
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={handleSaveName}>
                Save
              </button>
            </div>
            {saveSuccess && (
              <div className="save-badge" style={{ marginTop: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Display name saved!</span>
              </div>
            )}
            {saveErr && <div className="err" style={{ marginTop: 8, padding: '6px 10px', fontSize: '.82rem' }}>{saveErr}</div>}
          </div>
          <div style={{ marginBottom: 10 }}>
            <div className="small muted" style={{ marginBottom: 4, fontWeight: 600 }}>Device ID</div>
            <div className="mono" style={{ padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
              {fmtId(app.identity?.peerId)}
            </div>
            <div className="small muted" style={{ marginTop: 5 }}>Verify in person if you want to be sure</div>
          </div>
          <div className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Server connection:
            <Tag kind={app.status === 'ready' ? 'ok' : 'bad'}>
              {app.status === 'ready' ? 'Connected' : app.status}
            </Tag>
          </div>
        </div>

        {/* Join a room */}
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>Join a room</h2>
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              type="text"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="Paste invite link"
              style={{ flex: 1 }}
              aria-label="Invite link"
            />
            <button className="btn" onClick={() => join(invite)}>
              <DoorIcon /> Join
            </button>
          </div>
          <div>
            {scan
              ? <QrScanner onClose={() => setScan(false)} onResult={(t) => { setScan(false); join(t); }} />
              : (
                <button className="btn ghost" onClick={() => setScan(true)} style={{ width: '100%' }}>
                  <QrIcon /> Scan a QR code
                </button>
              )}
          </div>
        </div>
      </div>

      {/* ── Create a room ── */}
      <div className="card anim-fade-3">
        <h2 style={{ marginBottom: 16 }}>Create a room</h2>
        <div className="grid2" style={{ marginBottom: 14 }}>
          <div>
            <label className="small muted" htmlFor="rn" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Room name</label>
            <input
              id="rn"
              type="text"
              maxLength={64}
              value={room.name}
              onChange={(e) => setRoom({ ...room, name: e.target.value })}
              placeholder="CS-301 Lab, Hackathon floor 2…"
            />
          </div>
          <div>
            <label className="small muted" htmlFor="rh" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Auto-delete after (hours, 0 = keep 30 days)
            </label>
            <input
              id="rh"
              type="number"
              min="0"
              max="720"
              value={room.hours}
              onChange={(e) => setRoom({ ...room, hours: e.target.value })}
            />
          </div>
        </div>

        <label className="switch" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={room.openJoin} onChange={(e) => setRoom({ ...room, openJoin: e.target.checked })} />
          <span>
            <strong>Open join</strong> — let anyone with the invite in automatically while you are online
            <br />
            <span className="small muted">Otherwise you approve each person.</span>
          </span>
        </label>

        <button className="btn lg" disabled={busy || app.status !== 'ready'} onClick={create}>
          <PlusIcon /> Create room
        </button>
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {/* ── Your rooms ── */}
      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Your rooms</h2>
        {!app.rooms.length && (
          <div className="empty-state">
            <div className="icon">🏠</div>
            <p>No rooms yet. Create one above or join with an invite.</p>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {app.rooms.map((r) => (
            <div
              key={r.roomId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                transition: 'background .2s, box-shadow .2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--primary-light)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}
            >
              <Avatar name={r.name} size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {r.name}
                  <Tag kind={r.role === 'owner' ? 'amb' : ''}>{r.role}</Tag>
                </div>
                {r.expiresAt && (
                  <div className="small muted">Expires {new Date(r.expiresAt).toLocaleString()}</div>
                )}
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => go('#/room/' + r.roomId)}>Open</button>
                <button
                  className="btn sm warn"
                  onClick={() => confirm('Remove this room and its downloaded files from this device?') && app.forgetRoom(r.roomId)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
