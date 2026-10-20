import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresBusinessSessionSsaEligibilityRepository } from "../src/business-session-ssa-eligibility-repository.js";

const S = "018f0000-0000-7000-8000-0000000000a1";
const U = "018f0000-0000-7000-8000-0000000000a2";
const T = "018f0000-0000-7000-8000-0000000000a3";
const M = "018f0000-0000-7000-8000-0000000000a4";
const C = "018f0000-0000-7000-8000-0000000000a5";
const D = "018f0000-0000-7000-8000-0000000000a6";
const I = "018f0000-0000-7000-8000-0000000000a7";
const input = { sessionId: S, deviceId: D, installationId: I };
const row = {
  session_id: S, user_id: U, tenant_id: T, tenant_membership_id: M,
  company_id: C, device_id: D, installation_id: I,
  session_expires_at: new Date("2026-10-20T11:00:00Z"),
  credential_expires_at: new Date("2026-10-20T12:00:00Z"),
};

function fixture(rows: unknown[] = [row]) {
  const query = vi.fn(async (_statement: string, _params?: unknown[]) => ({ rows }));
  const pool = { query } as unknown as Pool;
  return {
    query,
    repository: new PostgresBusinessSessionSsaEligibilityRepository(pool, 300_000),
  };
}

describe("D3 business SSA eligibility gate (not login or device authentication)", () => {
  it("returns server-resolved identity, scope and expirations", async () => {
    const { query, repository } = fixture();
    expect(await repository.findCandidate(input)).toEqual({
      sessionId: S, userId: U, tenantId: T, tenantMembershipId: M,
      companyId: C, deviceId: D, installationId: I,
      sessionExpiresAt: "2026-10-20T11:00:00.000Z",
      deviceCredentialExpiresAt: "2026-10-20T12:00:00.000Z",
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([S, D, I, 300000]);
  });

  it("returns null when no eligible persisted session/device scope exists", async () => {
    const { repository } = fixture([]);
    expect(await repository.findCandidate(input)).toBeNull();
  });

  it("refuses malformed identifiers before querying the database", async () => {
    const { query, repository } = fixture();
    for (const bad of [
      { ...input, sessionId: "not-a-session" },
      { ...input, deviceId: "not-a-device" },
      { ...input, installationId: "not-an-installation" },
    ]) {
      await expect(repository.findCandidate(bad)).rejects.toThrow();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("requires a positive, safe integer reauthentication policy", () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    for (const age of [0, -1, 3.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new PostgresBusinessSessionSsaEligibilityRepository(pool, age))
        .toThrow("SSA_BUSINESS_REAUTH_POLICY_INVALID");
    }
  });

  it("checks server state and active credentials using one read-only SQL statement", async () => {
    const { query, repository } = fixture();
    await repository.findCandidate(input);
    const sql = query.mock.calls[0]?.[0] ?? "";
    for (const invariant of [
      "JOIN tenancy.tenant_memberships AS tm",
      "tm.user_id = s.user_id AND tm.status = 'ACTIVE'",
      "JOIN tenancy.tenants AS t",
      "t.status = 'ACTIVE'",
      "JOIN organization.companies AS company",
      "company.status = 'ACTIVE'",
      "JOIN identity.device_registry AS d",
      "d.status = 'ACTIVE'",
      "JOIN identity.device_credentials AS dc",
      "dc.status = 'ACTIVE'",
      "dc.tenant_id = d.tenant_id AND dc.company_id = d.company_id",
      "dc.trust_key_id = d.trust_key_id",
      "s.tenant_id IS NOT NULL",
      "s.device_id IS NULL",
      "s.mfa_status = 'SATISFIED'",
      "s.revoked_at IS NULL",
      "s.last_reauthenticated_at >= clock_timestamp()",
      "mf.verified_at IS NOT NULL",
    ]) expect(sql).toContain(invariant);
    expect(sql).toMatch(/^\s*SELECT\s/);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  });

  it("fails closed if the database returns corrupted timestamps", async () => {
    const { repository } = fixture([{ ...row, credential_expires_at: "2026-10-20T12:00:00Z" }]);
    await expect(repository.findCandidate(input))
      .rejects.toThrow("SSA_BUSINESS_ELIGIBILITY_INVALID_TIMESTAMP");
  });

  it("never produces an assertion or grants authorizations", async () => {
    const { repository } = fixture();
    const result = await repository.findCandidate(input);
    expect(result).not.toHaveProperty("sequence");
    expect(result).not.toHaveProperty("keyId");
    expect(result).not.toHaveProperty("permissions");
    expect(result).not.toHaveProperty("roles");
  });
});
