const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_BUCKETS_MAX = 10_000;

/** In-memory fixed-window limiter for a single service process. */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; startedAt: number }>();

  allow(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= RATE_LIMIT_WINDOW_MS) {
      if (this.buckets.size >= RATE_LIMIT_BUCKETS_MAX) {
        const first = this.buckets.keys().next().value;
        if (first) this.buckets.delete(first);
      }
      this.buckets.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (existing.count >= RATE_LIMIT_MAX) return false;
    existing.count += 1;
    return true;
  }
}
