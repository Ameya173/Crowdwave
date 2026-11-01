export class Metrics {
  constructor() { this.c = new Map(); this.g = new Map(); this.started = Date.now(); }
  inc(name, v = 1) { this.c.set(name, (this.c.get(name) || 0) + v); }
  gauge(name, fn) { this.g.set(name, fn); }
  text() {
    const out = [];
    for (const [k, v] of this.c) out.push(`# TYPE crowdwave_${k} counter`, `crowdwave_${k} ${v}`);
    for (const [k, fn] of this.g) { let v = 0; try { v = fn(); } catch { /* ignore */ } out.push(`# TYPE crowdwave_${k} gauge`, `crowdwave_${k} ${v}`); }
    out.push('# TYPE crowdwave_uptime_seconds gauge', `crowdwave_uptime_seconds ${Math.floor((Date.now() - this.started) / 1000)}`);
    return out.join('\n') + '\n';
  }
}
