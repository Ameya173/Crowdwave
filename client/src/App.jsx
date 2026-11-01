import React, { useEffect, useRef, useState } from 'react';
import { app, useApp, useHash, go } from './app.js';
import Home from './ui/Home.jsx';
import Room from './ui/Room.jsx';
import Bench from './ui/Bench.jsx';
import { Logo } from './ui/common.jsx';

function Join({ roomId, ownerId }) {
  useEffect(() => { app.addInvite(roomId, ownerId).then(() => go('#/room/' + roomId)); }, [roomId]);
  return (
    <div className="wrap">
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="spinner" />
        <span>Joining room…</span>
      </div>
    </div>
  );
}

/* Sun icon */
const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);
/* Moon icon */
const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);
/* Auto/circle icon */
const AutoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
  </svg>
);
/* Download icon */
const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const themeOrder = { auto: 'dark', dark: 'light', light: 'auto' };
const themeIcon  = { auto: <AutoIcon />, dark: <MoonIcon />, light: <SunIcon /> };
const themeLabel = { auto: 'Auto', dark: 'Dark', light: 'Light' };

export default function App() {
  const a = useApp();
  const hash = useHash();
  const [theme, setTheme] = useState(localStorage.getItem('cw.theme') || 'auto');
  const [installEvt, setInstallEvt] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef(null);

  useEffect(() => {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('cw.theme', theme);

    const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0f1117' : '#f8f9ff');
  }, [theme]);

  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e) => {
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', e.matches ? '#0f1117' : '#f8f9ff');
    };
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, [theme]);

  useEffect(() => {
    const f = (e) => { e.preventDefault(); setInstallEvt(e); };
    addEventListener('beforeinstallprompt', f);
    return () => removeEventListener('beforeinstallprompt', f);
  }, []);

  useEffect(() => { app.init(); }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const parts = hash.replace(/^#\//, '').split('/');
  const currentRoom = parts[0] === 'room' && parts[1] ? a.rooms?.find(r => r.roomId === parts[1]) : null;

  let view;
  if (a.fatal)
    view = (
      <div className="wrap">
        <div className="card err"><h2>Cannot start</h2>{a.fatal}</div>
      </div>
    );
  else if (!a.identity)
    view = (
      <div className="wrap">
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="spinner" />
          <span>Starting…</span>
        </div>
      </div>
    );
  else if (parts[0] === 'room' && parts[1])  view = <Room roomId={parts[1]} key={parts[1]} />;
  else if (parts[0] === 'join' && parts[1] && parts[2]) view = <Join roomId={parts[1]} ownerId={parts[2]} />;
  else if (parts[0] === 'bench') view = <Bench />;
  else view = <Home />;

  return (
    <>
      <header className={'top' + (scrolled ? ' scrolled' : '')} ref={headerRef}>
        <div className="wrap">
          <a className="brand" href="#/">
            <Logo />
            Crowdwave
          </a>

          {currentRoom && (
            <div className="breadcrumb">
              <a href="#/">All rooms</a>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{currentRoom.name}</span>
            </div>
          )}

          <span className="grow" />

          <div className="top-actions">
            {installEvt && (
              <button
                className="install-btn"
                onClick={() => { installEvt.prompt(); setInstallEvt(null); }}
              >
                <DownloadIcon />
                <span>Install app</span>
              </button>
            )}

            <button
              className="btn-icon"
              onClick={() => setTheme(themeOrder[theme])}
              aria-label={`Theme: ${themeLabel[theme]} — click to cycle`}
              title={`Theme: ${themeLabel[theme]}`}
            >
              {themeIcon[theme]}
            </button>

            <a href="#/bench" className="btn-icon" title="Benchmark" aria-label="Benchmark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </a>

            <div className="status-pill">
              <span className={'pulse-dot' + (a.status === 'ready' ? ' on' : ' off')} />
              {a.status === 'ready' ? 'Online' : a.status}
            </div>
          </div>
        </div>
      </header>
      {view}
    </>
  );
}
