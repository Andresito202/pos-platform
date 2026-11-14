import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/fixed-window-rate-limiter.js";

describe("FixedWindowRateLimiter", () => {
  it("bounds unique-address churn without evicting a live blocked budget",()=>{
    const limiter=new FixedWindowRateLimiter(2,1000,60000);
    expect(limiter.allow("already-limited",1000)).toBe(true);expect(limiter.allow("already-limited",1000)).toBe(true);
    const started=performance.now();let admitted=0;
    for(let i=0;i<100000;i++)if(limiter.allow("address-"+i,1000))admitted++;
    expect(admitted).toBe(999);expect(limiter.retainedBuckets).toBe(1000);
    expect(limiter.allow("already-limited",1000)).toBe(false);
    // Old commercial handler retained every address forever. Exact old cache
    // shape as baseline, not a second production limiter.
    const old=new Map<string,{start:number;count:number}>();for(let i=0;i<100000;i++)old.set("address-"+i,{start:1000,count:1});
    expect(old.size).toBe(100000);
    console.info(JSON.stringify({measurement:"RATE_CACHE_UNIQUE_ADDRESSES",addresses:100000,old_retained:old.size,new_retained:limiter.retainedBuckets,elapsed_ms:performance.now()-started}));
  });
  it("manual cleanup preserves active budgets, automatic cleanup reclaims only expired entries",()=>{
    const limiter=new FixedWindowRateLimiter(1,2,60000);limiter.allow("old",1000);limiter.allow("new",2000);
    expect(limiter.pruneExpired(60999)).toBe(0);expect(limiter.allow("old",60999)).toBe(false);
    expect(limiter.pruneExpired(61000)).toBe(1);expect(limiter.retainedBuckets).toBe(1);
    expect(limiter.allow("new",61000)).toBe(false);expect(limiter.allow("replacement",61000)).toBe(true);
    expect(limiter.allow("after-expiry",122000)).toBe(true);expect(limiter.retainedBuckets).toBe(1);
    expect(limiter.allow("after-expiry",121999)).toBe(false);
  });
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

  it("applies the session-trust rate limit before bearer-token validation", () => {
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const routeStart = source.indexOf('request.url === "/v1/session-trust"');
    const routeEnd = source.indexOf('request.url !== "/v1/device-enrollment"', routeStart);
    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);

    const route = source.slice(routeStart, routeEnd);
    const limiterIndex = route.indexOf("limiter.allow(");
    const authorizationIndex = route.indexOf("const authorization");
    const authorizedIndex = route.indexOf("const authorized");

    // Assert that every anchor exists before comparing order. A missing limiter
    // must fail the test rather than pass because indexOf returned -1.
    expect(limiterIndex).toBeGreaterThanOrEqual(0);
    expect(authorizationIndex).toBeGreaterThanOrEqual(0);
    expect(authorizedIndex).toBeGreaterThan(authorizationIndex);
    expect(limiterIndex).toBeLessThan(authorizationIndex);
    expect(route).toContain('prefix=sas?"AUTHORIZATION_TRUST":"SESSION_TRUST"');
    expect(route).toContain('`${prefix}_UNAUTHORIZED`');
  });
});
