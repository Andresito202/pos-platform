import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableFixedWindowRateLimiter } from "../src/durable-fixed-window-rate-limiter.js";
import { FixedWindowRateLimiter } from "../src/fixed-window-rate-limiter.js";

describe("FixedWindowRateLimiter abuse budget", () => {
  it("denies new keys under capacity pressure instead of resetting active budgets", () => {
    const limiter = new FixedWindowRateLimiter(2, 1, 60_000);
    expect(limiter.allow("a", 1_000)).toBe(true);
    expect(limiter.allow("b", 1_000)).toBe(false);
    expect(limiter.allow("a", 1_000)).toBe(true);
    expect(limiter.allow("a", 1_000)).toBe(false);
  });

  it("merges imported budgets without lowering counts", () => {
    const limiter = new FixedWindowRateLimiter(5, 10, 60_000);
    expect(limiter.allow("k", 1_000)).toBe(true);
    limiter.importActiveBuckets([["k", { count: 4, startedAt: 1_000 }]], 1_100);
    expect(limiter.allow("k", 1_200)).toBe(true);
    expect(limiter.allow("k", 1_300)).toBe(false);
  });
});

describe("DurableFixedWindowRateLimiter", () => {
  it("rejects relative state paths", () => {
    expect(() => new DurableFixedWindowRateLimiter("relative.json")).toThrow(
      /RATE_LIMIT_DURABLE_ABSOLUTE_PATH_REQUIRED/,
    );
  });

  it("survives process restart without resetting abuse budgets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-rate-"));
    const path = join(directory, "rate-limit.json");
    const base = Date.now();
    try {
      const first = new DurableFixedWindowRateLimiter(path, 3, 100, 60_000, 1, () => base);
      expect(first.allow("attacker", base)).toBe(true);
      expect(first.allow("attacker", base + 100)).toBe(true);
      expect(first.allow("attacker", base + 200)).toBe(true);
      expect(first.allow("attacker", base + 300)).toBe(false);
      first.flush(base + 400);
      const { readFileSync } = await import("node:fs");
      expect(JSON.parse(readFileSync(path, "utf8")).buckets.attacker.count).toBe(3);

      const second = new DurableFixedWindowRateLimiter(
        path,
        3,
        100,
        60_000,
        1,
        () => base + 500,
      );
      expect(second.retainedBuckets).toBe(1);
      expect(second.allow("attacker", base + 500)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
