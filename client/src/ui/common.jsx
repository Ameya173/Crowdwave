import React, { useState } from 'react';

/* ── Avatar helper ───────────────────────────────── */
const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#3b82f6','#ef4444','#14b8a6',
];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export const Avatar = ({ name = '', size = 'md' }) => (
  <div
    className={`avatar ${size}`}
    style={{ background: avatarColor(name) }}
    aria-label={name}
    title={name}
  >
    {initials(name)}
  </div>
);

/* ── Bar ─────────────────────────────────────────── */
export const Bar = ({ v, seed }) => (
  <div className={'bar' + (seed ? ' seed' : '')}>
    <i style={{ width: Math.round(Math.min(1, v) * 100) + '%' }} />
  </div>
);

/* ── Tag / pill ──────────────────────────────────── */
export const Tag = ({ kind = '', children }) => (
  <span className={'tag ' + kind}>{children}</span>
);

/* ── Copy button with checkmark animation ─────────── */
export function Copy({ text, label = 'Copy' }) {
  const [ok, set] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch { prompt('Copy this:', text); }
    set(true);
    setTimeout(() => set(false), 1500);
  };
  return (
    <button className="btn ghost sm" onClick={copy} style={{ gap: 5 }}>
      {ok
        ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Copied!
          </>
        )
        : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {label}
          </>
        )
      }
    </button>
  );
}

/* ── Animated Logo ───────────────────────────────── */
export const Logo = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true" style={{ width: 28, height: 28 }}>
    <defs>
      <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="14" fill="url(#logo-grad)" />
    <path
      d="M10 38c6-12 10-12 14 0s10 12 14 0 10-12 16 0"
      fill="none"
      stroke="#ffffff"
      strokeWidth="4.5"
      strokeLinecap="round"
      style={{ animation: 'none' }}
    />
    <circle cx="32" cy="16" r="4" fill="#fcd34d" />
  </svg>
);

/* ── Spinner ─────────────────────────────────────── */
export const Spinner = ({ size = '' }) => (
  <span className={'spinner' + (size ? ' ' + size : '')} role="status" aria-label="Loading" />
);

/* ── Empty state ─────────────────────────────────── */
export const EmptyState = ({ icon = '📭', message = 'Nothing here yet.' }) => (
  <div className="empty-state">
    <div className="icon">{icon}</div>
    <p>{message}</p>
  </div>
);

/* ── Utility: time ago ───────────────────────────── */
export const ago = (ts) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago';
};

/* ── Countdown ───────────────────────────────────── */
export function Countdown({ to }) {
  const [n, set] = useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => set(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.ceil((to - n) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (v) => String(v).padStart(2, '0');
  return <span className="clock">{d > 0 ? d + 'd ' : ''}{p(h)}:{p(m)}:{p(x)}</span>;
}
