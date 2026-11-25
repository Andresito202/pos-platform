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
 *
 * Dirty state is flushed on the flush interval even when traffic stops, and
 * `dispose()` must be called on shutdown so the last window is not lost.
 */
export class DurableFixedWindowRateLimiter {
  private readonly memory: FixedWindowRateLimiter;
  private readonly path: string;
  private readonly windowMs: number;
  private readonly maximum: number;
  private dirty = false;
  private lastFlush = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.markDirty(now);
    return ok;
  }

  pruneExpired(now = Date.now()): number {
    const removed = this.memory.pruneExpired(now);
    if (removed > 0) {
      this.markDirty(now);
      this.flush(now);
    }
    return removed;
  }

  /** Persist immediately if dirty. Safe to call repeatedly; clears pending timer. */
  flush(now = Date.now()): void {
    this.clearFlushTimer();
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

  /** Flush pending abuse budgets before process exit. */
  dispose(): void {
    this.flush(this.now());
  }

  private markDirty(now: number): void {
    this.dirty = true;
    if (now - this.lastFlush >= this.flushEveryMs) {
      this.flush(now);
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || !this.dirty) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush(this.now());
    }, this.flushEveryMs);
    // Keep the process alive only for the flush window; shutdown still calls dispose().
    this.flushTimer.unref?.();
  }

  private clearFlushTimer(): void {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
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
