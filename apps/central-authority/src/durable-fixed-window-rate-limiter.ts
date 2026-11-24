import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";

type Snapshot = {
  readonly windowMs: number;
  readonly maximum: number;
  readonly buckets: Record<string, { count: number; startedAt: number }>;
};

/**
 * Process-local fixed-window limiter with atomic file durability.
 * Survives Central restarts on a single node. Does not synchronize multi-node
 * clusters — that remains residual risk until a shared store is authorized.
 */
export class DurableFixedWindowRateLimiter {
  private readonly memory: FixedWindowRateLimiter;
  private readonly path: string;
  private readonly windowMs: number;
  private readonly maximum: number;
  private dirty = false;
  private lastFlush = 0;

  constructor(
    path: string,
    maximum = 30,
    capacity = 10_000,
    windowMs = 60_000,
    private readonly flushEveryMs = 1_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!isAbsolute(path)) throw new Error("RATE_LIMIT_DURABLE_ABSOLUTE_PATH_REQUIRED");
    if (![maximum, capacity, windowMs, flushEveryMs].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new Error("RATE_LIMIT_DURABLE_POLICY_REQUIRED");
    }
    this.path = path;
    this.windowMs = windowMs;
    this.maximum = maximum;
    this.memory = new FixedWindowRateLimiter(maximum, capacity, windowMs);
    this.restore(this.now());
  }

  get retainedBuckets(): number {
    return this.memory.retainedBuckets;
  }

  allow(key: string, now = Date.now()): boolean {
    const ok = this.memory.allow(key, now);
    this.dirty = true;
    if (now - this.lastFlush >= this.flushEveryMs) this.flush(now);
    return ok;
  }

  pruneExpired(now = Date.now()): number {
    const removed = this.memory.pruneExpired(now);
    if (removed > 0) {
      this.dirty = true;
      this.flush(now);
    }
    return removed;
  }

  flush(now = Date.now()): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const buckets: Snapshot["buckets"] = {};
    for (const [key, value] of this.memory.exportActiveBuckets(now)) {
      buckets[key] = { count: value.count, startedAt: value.startedAt };
    }
    const body = JSON.stringify({
      windowMs: this.windowMs,
      maximum: this.maximum,
      buckets,
    } satisfies Snapshot);
    const tmp = `${this.path}.${process.pid}.${now}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600, flag: "w" });
    renameSync(tmp, this.path);
    this.dirty = false;
    this.lastFlush = now;
  }

  private restore(now: number): void {
    try {
      const stat = lstatSync(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) return;
      const parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(this.path)),
      ) as Snapshot;
      if (
        !parsed
        || typeof parsed !== "object"
        || parsed.windowMs !== this.windowMs
        || parsed.maximum !== this.maximum
        || !parsed.buckets
        || typeof parsed.buckets !== "object"
      ) {
        return;
      }
      const entries = Object.entries(parsed.buckets).map(
        ([key, bucket]) => [key, bucket] as const,
      );
      this.memory.importActiveBuckets(entries, now);
    } catch {
      // Corrupt/missing state starts empty; never widens budgets from partial JSON.
    }
  }
}
