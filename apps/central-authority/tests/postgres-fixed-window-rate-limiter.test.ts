import { describe, expect, it } from "vitest";
import {
  PostgresFixedWindowRateLimiter,
  type PostgresRateLimitClient,
} from "../src/postgres-fixed-window-rate-limiter.js";

function memoryPostgres(): PostgresRateLimitClient & { store: Map<string, { count: number; resetAt: number }> } {
  const store = new Map<string, { count: number; resetAt: number }>();
  return {
    store,
    async query(_text, values = []) {
      const key = String(values[0]);
      const resetAt = (values[1] as Date).getTime();
      const now = (values[2] as Date).getTime();
      const existing = store.get(key);
      if (!existing || existing.resetAt <= now) {
        store.set(key, { count: 1, resetAt });
        return { rows: [{ count: 1 }] };
      }
      const count = existing.count + 1;
      store.set(key, { count, resetAt: existing.resetAt });
      return { rows: [{ count }] };
    },
  };
}

describe("PostgresFixedWindowRateLimiter", () => {
  it("rejects invalid policy and keys", async () => {
    expect(() => new PostgresFixedWindowRateLimiter(memoryPostgres(), 0, 60_000)).toThrow(
      /RATE_LIMIT_POSTGRES_POLICY_REQUIRED/,
    );
    const limiter = new PostgresFixedWindowRateLimiter(memoryPostgres(), 2, 60_000);
    expect(await limiter.allow("")).toBe(false);
    expect(await limiter.allow("x".repeat(513))).toBe(false);
  });

  it("enforces a fixed window without resetting under concurrent-looking increments", async () => {
    const db = memoryPostgres();
    const limiter = new PostgresFixedWindowRateLimiter(db, 3, 60_000);
    const now = 1_000_000;
    expect(await limiter.allow("attacker", now)).toBe(true);
    expect(await limiter.allow("attacker", now + 10)).toBe(true);
    expect(await limiter.allow("attacker", now + 20)).toBe(true);
    expect(await limiter.allow("attacker", now + 30)).toBe(false);
    expect(db.store.get("attacker")?.count).toBe(4);
  });

  it("fails closed when the backend throws", async () => {
    const limiter = new PostgresFixedWindowRateLimiter(
      {
        async query() {
          throw new Error("db down");
        },
      },
      5,
      60_000,
    );
    expect(await limiter.allow("anyone", 1_000)).toBe(false);
  });

  it("opens a new window after reset_at", async () => {
    const db = memoryPostgres();
    const limiter = new PostgresFixedWindowRateLimiter(db, 1, 1_000);
    expect(await limiter.allow("k", 5_000)).toBe(true);
    expect(await limiter.allow("k", 5_100)).toBe(false);
    expect(await limiter.allow("k", 6_100)).toBe(true);
  });
});
