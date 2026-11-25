import { describe, expect, it } from "vitest";
import {
  PostgresFixedWindowRateLimiter,
  allowsNonPostgresRateLimit,
  type PostgresRateLimitClient,
} from "../src/postgres-fixed-window-rate-limiter.js";

function memoryPostgres(): PostgresRateLimitClient & { store: Map<string, { count: number; resetAt: number }>; setTime: (now: number) => void } {
  const store = new Map<string, { count: number; resetAt: number }>();
  let now = 1_000_000;
  return {
    store,
    setTime: (value) => { now = value; },
    async query(sql, values = []) {
      expect(sql).toContain("statement_timestamp()");
      expect(values).toHaveLength(2);
      const key = String(values[0]);
      const resetAt = now + Number(values[1]);
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
    expect(await limiter.allow("attacker")).toBe(true);
    expect(await limiter.allow("attacker")).toBe(true);
    expect(await limiter.allow("attacker")).toBe(true);
    expect(await limiter.allow("attacker")).toBe(false);
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
    expect(await limiter.allow("anyone")).toBe(false);
  });

  it("opens a new window after reset_at", async () => {
    const db = memoryPostgres();
    const limiter = new PostgresFixedWindowRateLimiter(db, 1, 1_000);
    db.setTime(5_000);
    expect(await limiter.allow("k")).toBe(true);
    db.setTime(5_100);
    expect(await limiter.allow("k")).toBe(false);
    db.setTime(6_100);
    expect(await limiter.allow("k")).toBe(true);
  });
});

it("restricts non-Postgres backends to explicit local development/test", () => {
  expect(allowsNonPostgresRateLimit("test", "LOCAL")).toBe(true);
  expect(allowsNonPostgresRateLimit("development", "LOCAL")).toBe(true);
  for (const env of ["PRODUCTION", "PREPRODUCTION", undefined]) {
    expect(allowsNonPostgresRateLimit("development", env)).toBe(false);
  }
  expect(allowsNonPostgresRateLimit("production", "LOCAL")).toBe(false);
  expect(allowsNonPostgresRateLimit(undefined, "LOCAL")).toBe(false);
});
