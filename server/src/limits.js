export class Bucket {
  constructor(ratePerSec, burst) { this.rate = ratePerSec; this.max = burst; this.tokens = burst; this.t = Date.now(); }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.max, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
