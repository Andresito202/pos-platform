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

function fixture(rows: unknown[] = [row], tenantId: string | null = T) {
  const query = vi.fn(async (statement: string, _params?: unknown[]) => {
    if (statement.includes("SELECT tenant_id::text AS tenant_id FROM identity.sessions")) {
      return { rows: tenantId === null ? [] : [{ tenant_id: tenantId }] };
    }
    if (statement.includes("SELECT s.id::text AS session_id")) return { rows };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  return {
    query, release, connect,
    repository: new PostgresBusinessSessionSsaEligibilityRepository(pool, 300_000),
  };
}

function sqlCalls(query: ReturnType<typeof fixture>["query"]): string[] {
  return query.mock.calls.map(([sql]) => sql);
}

describe("D3 business SSA eligibility — tenant RLS and read-only scope", () => {
  it("resolves a tenant from PostgreSQL, sets it only locally, then returns durable scope", async () => {
    const { query, release, connect, repository } = fixture();
    const resolved = await repository.findCandidate(input);
    expect(resolved).toEqual({
      sessionId: S, userId: U, tenantId: T, tenantMembershipId: M,
      companyId: C, deviceId: D, installationId: I,
      sessionExpiresAt: "2026-10-20T11:00:00.000Z",
      deviceCredentialExpiresAt: "2026-10-20T12:00:00.000Z",
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sqlCalls(query)[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    expect(sqlCalls(query)[1]).toContain("SELECT tenant_id::text AS tenant_id FROM identity.sessions");
    expect(query.mock.calls[1]?.[1]).toEqual([S]);
    expect(sqlCalls(query)[2]).toBe("SELECT set_config('app.tenant_id', $1, true)");
    expect(query.mock.calls[2]?.[1]).toEqual([T]);
    expect(query.mock.calls[3]?.[1]).toEqual([S, D, I, 300000]);
    expect(sqlCalls(query).at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fails closed and rolls back when the session has no tenant", async () => {
    const { repository, query, release } = fixture([row], null);
    expect(await repository.findCandidate(input)).toBeNull();
    expect(sqlCalls(query)).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      "SELECT tenant_id::text AS tenant_id FROM identity.sessions WHERE id = $1 AND tenant_id IS NOT NULL",
      "ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns null with rollback when no eligible persisted scope exists", async () => {
    const { repository, query, release } = fixture([]);
    expect(await repository.findCandidate(input)).toBeNull();
    expect(sqlCalls(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects malformed IDs before opening a transaction", async () => {
    const { connect, repository } = fixture();
    for (const bad of [
      { ...input, sessionId: "not-a-session" },
      { ...input, deviceId: "not-a-device" },
      { ...input, installationId: "not-an-installation" },
    ]) await expect(repository.findCandidate(bad)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires an explicit positive reauthentication policy", () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    for (const age of [0, -1, 3.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new PostgresBusinessSessionSsaEligibilityRepository(pool, age))
        .toThrow("SSA_BUSINESS_REAUTH_POLICY_INVALID");
    }
  });

  it("uses existing business session, MFA, membership, company and device predicates", async () => {
    const { query, repository } = fixture();
    await repository.findCandidate(input);
    const sql = sqlCalls(query)[3] ?? "";
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

  it("rejects database corruption and releases a borrowed connection", async () => {
    const { repository, query, release } = fixture([{ ...row, credential_expires_at: "2026-10-20T12:00:00Z" }]);
    await expect(repository.findCandidate(input)).rejects.toThrow("SSA_BUSINESS_ELIGIBILITY_INVALID_TIMESTAMP");
    expect(sqlCalls(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a tenant_id returned by PostgreSQL that is not a UUID", async () => {
    const { repository, query, release } = fixture([row], "not-a-uuid");
    await expect(repository.findCandidate(input)).rejects.toThrow();
    expect(sqlCalls(query)).not.toContain("SELECT set_config('app.tenant_id', $1, true)");
    expect(sqlCalls(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not leak connections or tenant context after a SQL failure", async () => {
    const { repository, query, release } = fixture();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT s.id::text AS session_id")) throw new Error("DB_UNAVAILABLE");
      if (sql.includes("SELECT tenant_id::text AS tenant_id")) return { rows: [{ tenant_id: T }] };
      return { rows: [] };
    });
    await expect(repository.findCandidate(input)).rejects.toThrow("DB_UNAVAILABLE");
    expect(sqlCalls(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not issue SSA, allocate sequence or grant permissions", async () => {
    const { repository } = fixture();
    const resolved = await repository.findCandidate(input);
    expect(resolved).not.toHaveProperty("sequence");
    expect(resolved).not.toHaveProperty("permissions");
    expect(resolved).not.toHaveProperty("roles");
    expect(resolved).not.toHaveProperty("signature");
  });
});
