// Gossip sweep: reach and latency versus fanout and TTL, 100 peers in a random mesh (degree 8), plus anti-entropy recovery.
import { sweep } from '../client/src/core/gossipsim.js';
import fs from 'node:fs';
const rows = sweep({ peers: 100, degree: 8 }, 8);
console.table(rows.map((r) => ({ fanout: r.fanout, ttl: r.ttl, 'reach % (gossip only)': r.reachPct.toFixed(1), 'reach % (after 3 sync rounds)': r.reachAfterSyncPct.toFixed(1), 'p50 ms': r.p50.toFixed(0), 'p95 ms': r.p95.toFixed(0), messages: r.messages.toFixed(0) })));
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/gossip.json', import.meta.url), JSON.stringify(rows, null, 2));
console.log('Saved bench/out/gossip.json. Defaults used by the app: fanout 3, TTL 8.');
