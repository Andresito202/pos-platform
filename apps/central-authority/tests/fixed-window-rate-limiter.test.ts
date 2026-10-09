import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/fixed-window-rate-limiter.js";

describe("FixedWindowRateLimiter", () => {
  it("rejects requests after the per-key limit until the window expires", () => {
    const limiter = new FixedWindowRateLimiter();

    for (let request = 0; request < 30; request += 1) {
      expect(limiter.allow("client-a", 1_000)).toBe(true);
    }
    expect(limiter.allow("client-a", 1_000)).toBe(false);
    expect(limiter.allow("client-a", 60_999)).toBe(false);
    expect(limiter.allow("client-a", 61_000)).toBe(true);
  });

  it("keeps separate budgets for separate keys", () => {
    const limiter = new FixedWindowRateLimiter();

    for (let request = 0; request < 30; request += 1) {
      expect(limiter.allow("client-a", 1_000)).toBe(true);
    }
    expect(limiter.allow("client-a", 1_000)).toBe(false);
    expect(limiter.allow("client-b", 1_000)).toBe(true);
  });

  it("starts a new window when the clock moves to a later window boundary", () => {
    const limiter = new FixedWindowRateLimiter();

    for (let request = 0; request < 30; request += 1) {
      expect(limiter.allow("client-a", 1_000)).toBe(true);
    }
    expect(limiter.allow("client-a", 61_000)).toBe(true);
    expect(limiter.allow("client-a", 61_000)).toBe(true);
  });
});
