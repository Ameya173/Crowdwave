import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_pub TEXT NOT NULL, owner_peer TEXT NOT NULL,
  key_epoch INTEGER NOT NULL DEFAULT 1, open_join INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS members (
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL, pub_key TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner','moderator','member')),
  status TEXT NOT NULL CHECK (status IN ('pending','active','removed')),
  envelope TEXT, envelope_epoch INTEGER, joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, peer_id)
);
CREATE INDEX IF NOT EXISTS idx_members_peer ON members(peer_id);
CREATE TABLE IF NOT EXISTS manifests (
  transfer_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  name TEXT NOT NULL, size INTEGER NOT NULL, chunk_size INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
  merkle_root TEXT NOT NULL, leaf_hashes BLOB NOT NULL, key_epoch INTEGER NOT NULL, author_pub TEXT NOT NULL,
  signature TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS chunks (
  transfer_id TEXT NOT NULL REFERENCES manifests(transfer_id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
  cached_at INTEGER NOT NULL, last_access INTEGER NOT NULL, PRIMARY KEY (transfer_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_chunks_lru ON chunks(last_access);
CREATE TABLE IF NOT EXISTS messages (
  msg_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  channel TEXT NOT NULL, author_pub TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL,
  ts INTEGER NOT NULL, expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, ts);
CREATE TABLE IF NOT EXISTS metric_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, room_id TEXT, kind TEXT NOT NULL, value REAL NOT NULL, meta TEXT
);
`;
export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'crowdwave.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
