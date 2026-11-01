import fs from 'node:fs';
import path from 'node:path';

const TID = /^[0-9a-f]{64}$/;
export const validTid = (s) => typeof s === 'string' && TID.test(s);
/** Encrypted chunk cache on disk, indexed in SQLite, LRU-evicted against a byte quota. */
export class ChunkCache {
  constructor(db, dir, quota) {
    fs.mkdirSync(dir, { recursive: true });
    Object.assign(this, { db, dir, quota });
    this.s = {
      row: db.prepare('SELECT size FROM chunks WHERE transfer_id=? AND idx=?'),
      up: db.prepare('INSERT INTO chunks(transfer_id,idx,hash,size,path,cached_at,last_access) VALUES(?,?,?,?,?,?,?) ON CONFLICT(transfer_id,idx) DO UPDATE SET size=excluded.size,last_access=excluded.last_access,path=excluded.path'),
      touch: db.prepare('UPDATE chunks SET last_access=? WHERE transfer_id=? AND idx=?'),
      idxs: db.prepare('SELECT idx FROM chunks WHERE transfer_id=?'),
      old: db.prepare('SELECT transfer_id,idx,size,path FROM chunks ORDER BY last_access LIMIT 100'),
      del: db.prepare('DELETE FROM chunks WHERE transfer_id=? AND idx=?'),
      delT: db.prepare('DELETE FROM chunks WHERE transfer_id=?'),
    };
    this.recount();
  }
  recount() { this.total = this.db.prepare('SELECT COALESCE(SUM(size),0) s FROM chunks').get().s; }
  file(tid, idx) { return path.join(this.dir, tid, String(idx)); }
  has(tid, idx) { return !!this.s.row.get(tid, idx); }
  put(tid, idx, buf, hash) {
    const f = this.file(tid, idx);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', buf);
    fs.renameSync(f + '.tmp', f);
    const old = this.s.row.get(tid, idx), now = Date.now();
    this.s.up.run(tid, idx, hash, buf.length, f, now, now);
    this.total += buf.length - (old?.size || 0);
    this.evict();
  }
  touch(tid, idx) { this.s.touch.run(Date.now(), tid, idx); }
  bitfield(tid, n) {
    const out = Buffer.alloc((n + 7) >> 3); let count = 0;
    for (const { idx } of this.s.idxs.all(tid)) if (idx < n) { out[idx >> 3] |= 128 >> (idx & 7); count++; }
    return { bitfield: out.toString('base64'), count, n };
  }
  dropTransfer(tid) { fs.rmSync(path.join(this.dir, tid), { recursive: true, force: true }); this.s.delT.run(tid); this.recount(); }
  evict() {
    while (this.total > this.quota) {
      const rows = this.s.old.all();
      if (!rows.length) { this.total = 0; break; }
      for (const r of rows) {
        try { fs.unlinkSync(r.path); } catch { /* already gone */ }
        this.s.del.run(r.transfer_id, r.idx); this.total -= r.size;
        if (this.total <= this.quota * 0.9) break;
      }
    }
  }
}
