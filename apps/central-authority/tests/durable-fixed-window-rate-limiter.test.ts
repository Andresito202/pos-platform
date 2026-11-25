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
      second.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("flushes exhausted budgets after traffic stops without an explicit flush", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-rate-idle-"));
    const path = join(directory, "rate-limit.json");
    const base = Date.now();
    try {
      const first = new DurableFixedWindowRateLimiter(path, 2, 100, 60_000, 40, () => base);
      expect(first.allow("attacker", base)).toBe(true);
      expect(first.allow("attacker", base)).toBe(true);
      expect(first.allow("attacker", base)).toBe(false);
      // No explicit flush — scheduled timer must persist the exhausted window.
      await new Promise((resolve) => setTimeout(resolve, 80));
      const second = new DurableFixedWindowRateLimiter(path, 2, 100, 60_000, 40, () => base + 10);
      expect(second.allow("attacker", base + 10)).toBe(false);
      second.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("dispose persists dirty state immediately for shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-rate-dispose-"));
    const path = join(directory, "rate-limit.json");
    const base = Date.now();
    try {
      const first = new DurableFixedWindowRateLimiter(path, 2, 100, 60_000, 60_000, () => base);
      expect(first.allow("attacker", base)).toBe(true);
      expect(first.allow("attacker", base)).toBe(true);
      expect(first.allow("attacker", base)).toBe(false);
      first.dispose();
      const second = new DurableFixedWindowRateLimiter(path, 2, 100, 60_000, 60_000, () => base + 5);
      expect(second.allow("attacker", base + 5)).toBe(false);
      second.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
