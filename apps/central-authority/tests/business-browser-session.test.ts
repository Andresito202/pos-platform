import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "@pos-platform/database-postgres";
import { BusinessBrowserSessionAuthority } from "../src/business-browser-session-authority.js";
import { BusinessBrowserSessionIssuer } from "../src/business-browser-session-issuer.js";
import type { BusinessInitialMfaFlow } from "../src/business-initial-mfa-flow.js";

const origin = "https://business.example.test";
const token = "a".repeat(43);
const csrf = "b".repeat(43);
const request = {
  method: "POST", origin, fetchSite: "same-origin",
  cookie: `__Host-camacho_business=${token}`, csrfToken: csrf,
};
const policy = () => ({
  origin, sessionLifetimeMs: 300_000, browserLifetimeMs: 300_000,
  maximumMfaAgeMs: 60_000, lockTimeoutMs: 2_000, statementTimeoutMs: 10_000,
});

describe("BUSINESS browser boundary (unit tests; no PostgreSQL fixture)", () => {
  it.each([
    "http://business.example.test",
    "https://business.example.test/path",
    "https://business.example.test/",
    "https://business.example.test?other=origin",
    "https://user:password@business.example.test",
  ])("rejects a noncanonical origin before accepting a session: %s", value => {
    expect(() => new BusinessBrowserSessionAuthority(value, 300_000)).toThrow();
    expect(() => new BusinessBrowserSessionIssuer(
      {} as Pool, {} as BusinessInitialMfaFlow, { ...policy(), origin: value },
    )).toThrow();
  });

  it.each([
    { method: "GET" }, { origin: "https://other.example.test" },
    { fetchSite: "cross-site" }, { csrfToken: null }, { csrfToken: "invalid" },
    { cookie: `__Host-camacho_platform=${token}` },
    { cookie: `${request.cookie}; ${request.cookie}` },
    { cookie: "__Host-camacho_business=invalid" },
  ])("rejects an invalid request without querying custody: %o", invalid => {
    const query = vi.fn();
    const authority = new BusinessBrowserSessionAuthority(origin, 300_000);
    return expect(authority.require({ query } as unknown as PoolClient, { ...request, ...invalid }))
      .resolves.toBeNull().then(() => expect(query).not.toHaveBeenCalled());
  });

  it("rejects an unknown, expired or revoked cookie when custody returns no active row", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const authority = new BusinessBrowserSessionAuthority(origin, 300_000);
    expect(await authority.require({ query } as unknown as PoolClient, request)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does not touch the tenant context or extend activity with another CSRF token", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      session_id: "session", user_id: "user", tenant_id: "tenant", membership_id: "membership",
      csrf_hash: createHash("sha256").update("c".repeat(43)).digest("hex"),
    }] });
    const authority = new BusinessBrowserSessionAuthority(origin, 300_000);
    expect(await authority.require({ query } as unknown as PoolClient, request)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps the validated issuer policy when the caller later mutates its object", async () => {
    const p = policy();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
    const take = vi.fn().mockReturnValue({ purpose: "BUSINESS_INITIAL_MFA" });
    const issuer = new BusinessBrowserSessionIssuer(pool, {
      takeForBusinessSession: take,
    } as unknown as BusinessInitialMfaFlow, p);
    p.origin = "https://attacker.example.test";
    await expect(issuer.issue({}, "01900000-0000-7000-8000-000000000001",
      "01900000-0000-7000-8000-000000000002"))
      .rejects.toThrow("BUSINESS_SESSION_AUTHORIZATION_REJECTED");
    const role = query.mock.calls.find(call => String(call[0]).includes("FROM identity.users"));
    expect(role?.[1][6]).toBe(origin);
    expect(release).toHaveBeenCalledOnce();
  });

  it("resolves trusted cookie custody before reading tenant-isolated membership", async () => {
    // Model only the documented RLS boundary. This is not physical SQL proof.
    let tenantContext: string | null = null;
    const row = {
      session_id: "session", user_id: "user", tenant_id: "tenant", membership_id: "membership",
      csrf_hash: createHash("sha256").update(csrf).digest("hex"),
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("set_config('app.tenant_id'")) tenantContext = String(values?.[0]);
      const isolated = sql.includes("JOIN tenancy.tenant_memberships");
      const readable = !isolated || tenantContext === row.tenant_id;
      return { rows: readable ? [row] : [], rowCount: readable ? 1 : 0 };
    });
    const authority = new BusinessBrowserSessionAuthority(origin, 300_000);
    expect(await authority.require({ query } as unknown as PoolClient, request)).toEqual({
      sessionId: row.session_id, userId: row.user_id,
      tenantId: row.tenant_id, membershipId: row.membership_id,
    });
    expect(tenantContext).toBe(row.tenant_id);
  });
});
