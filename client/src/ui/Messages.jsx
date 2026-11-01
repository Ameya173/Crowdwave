import React, { useState } from 'react';
import { ago, Tag } from './common.jsx';

/* Icons */
const SendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const AnnouncementIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);
const UpvoteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const BrainIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.04-4.98A2.5 2.5 0 0 1 5.5 8a2.5 2.5 0 0 1 .5-4.96A2.5 2.5 0 0 1 9.5 2z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.04-4.98A2.5 2.5 0 0 0 18.5 8a2.5 2.5 0 0 0-.5-4.96A2.5 2.5 0 0 0 14.5 2z" />
  </svg>
);

export default function Messages({ s }) {
  const [ch, setCh] = useState('announcements');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const canAnnounce = s.rec.role === 'owner' || s.rec.role === 'moderator';

  const post = async () => {
    if (!text.trim()) return;
    setErr('');
    try {
      if (ch === 'announcements') await s.postAnnouncement(text.trim());
      else if (ch === 'chat') await s.postChat(text.trim());
      else await s.askQuestion(text.trim());
      setText('');
    } catch (e) { setErr(e.message); }
  };

  const items = s.feed.filter((f) => f.channel === ch);
  const clusters = ch === 'qa' ? s.clusters() : [];
  const ph = { announcements: 'Announcement for everyone…', chat: 'Say something…', qa: 'Ask a question (shown without your name)…' }[ch];

  return (
    <div>
      {/* Sub-tabs for message channels */}
      <div className="tabs" role="tablist">
        {[['announcements', <><AnnouncementIcon /> Announcements</>], ['chat', 'Chat'], ['qa', 'Questions']].map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={ch === k}
            className={'tab' + (ch === k ? ' on' : '')}
            onClick={() => setCh(k)}
          >
            {l}
            {ch !== k && k === 'announcements' && items.length > 0 && <span className="tab-badge">{items.length}</span>}
          </button>
        ))}
      </div>

      {/* Q&A notice */}
      {ch === 'qa' && (
        <div className="note small" style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 8px' }}>
            Questions show a random label instead of your name. Your device still signs them, so the room owner
            could trace a question to a device key. This is <strong>pseudonymous</strong>, not anonymous.
          </p>
          <div className="row">
            <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={s.settings.ai} onChange={(e) => s.saveSettings({ ai: e.target.checked })} style={{ accentColor: 'var(--primary)' }} />
              <BrainIcon /> Smarter grouping (downloads a ~25 MB model once)
            </label>
            {s.settings.ai && (
              <Tag kind={s.aiState === 'ready' ? 'ok' : s.aiState === 'failed' ? 'bad' : 'amb'}>
                {s.aiState === 'ready' ? 'model ready' : s.aiState === 'failed' ? 'model failed, using offline grouping' : 'loading model…'}
              </Tag>
            )}
          </div>
        </div>
      )}

      {/* Input area */}
      {(ch !== 'announcements' || canAnnounce)
        ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                rows={2}
                value={text}
                maxLength={2000}
                placeholder={ph}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } }}
                style={{ flex: 1, resize: 'vertical', minHeight: 64 }}
                aria-label={ph}
              />
              <button
                className="btn"
                onClick={post}
                style={{ alignSelf: 'flex-end', minWidth: 80 }}
              >
                <SendIcon /> {ch === 'qa' ? 'Ask' : 'Send'}
              </button>
            </div>
          </div>
        )
        : (
          <p className="muted small" style={{ marginBottom: 14 }}>Only the owner and moderators can post announcements.</p>
        )}

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {/* ── Announcements ── */}
      {ch === 'announcements' && (
        <div>
          {!items.length && (
            <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-3)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📢</div>
              <p style={{ margin: 0 }}>No announcements yet.</p>
            </div>
          )}
          {items.slice().reverse().map((f) => (
            <div key={f.id} className="ann" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AnnouncementIcon />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <strong>{f.authorName}</strong>
                  <span className="small muted">{ago(f.ts)}</span>
                </div>
                <div style={{ lineHeight: 1.6 }}>{f.payload.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Chat ── */}
      {ch === 'chat' && (
        <div className="card" style={{ padding: '14px 16px' }}>
          {!items.length && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-3)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>💬</div>
              <span>No messages yet.</span>
            </div>
          )}
          {items.map((f) => (
            <div key={f.id} className="chat-bubble">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="who">{f.authorName}</span>
                <span className="ts">{ago(f.ts)}</span>
              </div>
              <div className="body">{f.payload.text}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Q&A clusters ── */}
      {ch === 'qa' && (
        !clusters.length
          ? (
            <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-3)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>❓</div>
              <p style={{ margin: 0 }}>No questions yet. Be the first to ask!</p>
            </div>
          )
          : clusters.map((c) => {
            const top = c.items.slice().sort((a, b) => b.votes - a.votes)[0];
            return (
              <div className="cluster" key={c.id}>
                <div className="q" style={{ border: 0, paddingTop: 0 }}>
                  {/* Vote column */}
                  <div className="vote">
                    <b>{c.votes}</b>
                    <button
                      className="vote-btn"
                      onClick={() => s.vote(top.id)}
                      aria-label={`Upvote: ${top.text}`}
                    >
                      <UpvoteIcon />
                    </button>
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, lineHeight: 1.55 }}>{top.text}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      asked by #{top.anon} · {ago(top.ts)}
                      {c.items.length > 1 ? ` · ${c.items.length} similar questions grouped` : ''}
                    </div>
                    {c.items.filter((x) => x !== top).map((x) => (
                      <div key={x.id} className="alt" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <span style={{ flex: 1 }}>{x.text}</span>
                        <button className="btn sm ghost" onClick={() => s.vote(x.id)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <UpvoteIcon /> +1
                        </button>
                        <span className="small muted">({x.votes})</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
      )}
    </div>
  );
}
