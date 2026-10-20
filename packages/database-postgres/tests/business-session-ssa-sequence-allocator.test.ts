import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresBusinessSsaSequenceAllocator } from "../src/business-session-ssa-sequence-allocator.js";

const S = "018f0000-0000-7000-8000-0000000000a1";
const U = "018f0000-0000-7000-8000-0000000000a2";
const T = "018f0000-0000-7000-8000-0000000000a3";
const M = "018f0000-0000-7000-8000-0000000000a4";
const C = "018f0000-0000-7000-8000-0000000000a5";
const D = "018f0000-0000-7000-8000-0000000000a6";
const I = "018f0000-0000-7000-8000-0000000000a7";
const INPUT = { sessionId: S, deviceId: D, installationId: I };
const scope = {
  session_id: S, user_id: U, tenant_id: T, tenant_membership_id: M,
  company_id: C, device_id: D, installation_id: I,
  session_expires_at: new Date(Date.now() + 60_000),
  credential_expires_at: new Date(Date.now() + 60_000),
};

function mockDb(config: {
  tenant?: string | null;
  scope?: object | null;
  factor?: boolean;
  next?: string | null;
  throwAt?: string;
} = {}) {
  const query = vi.fn(async (sql: string, _args?: unknown[]) => {
    if (config.throwAt && sql.includes(config.throwAt)) throw new Error("DATABASE_INJECTED_FAILURE");
    if (sql.includes("SELECT tenant_id::text AS tenant_id"))
      return { rows: config.tenant === null ? [] : [{ tenant_id: config.tenant ?? T }] };
    if (sql.includes("SELECT s.id::text AS session_id"))
      return { rows: config.scope === null ? [] : [config.scope ?? scope] };
    if (sql.includes("SELECT id::text AS id FROM identity.mfa_factors"))
      return { rows: config.factor === false ? [] : [{ id: "018f0000-0000-7000-8000-0000000000a8" }] };
    if (sql.includes("INSERT INTO identity.session_assertion_sequences"))
      return { rows: config.next === null ? [] : [{ sequence: config.next ?? "1" }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  const repo = new PostgresBusinessSsaSequenceAllocator(pool, 300000);
  return { repo, query, release, connect };
}
function statements(query: ReturnType<typeof mockDb>["query"]): string[] {
  return query.mock.calls.map(([sql]) => sql);
}

describe("central SSA durable sequence allocation (not authentication)", () => {
  it("only commits a sequence after locking eligible business and MFA scope", async () => {
    const { repo, query, release } = mockDb({ next: "7" });
    const reserved = await repo.reserveForVerifiedProof(INPUT);
    expect(reserved?.sequence).toBe(7);
    expect(reserved?.eligibleScope).toMatchObject({
      sessionId: S, userId: U, tenantId: T, tenantMembershipId: M,
      deviceId: D, installationId: I, companyId: C,
    });
    const all = statements(query);
    expect(all[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(all[1]).toContain("FROM identity.sessions WHERE id=$1");
    expect(all[2]).toBe("SELECT set_config('app.tenant_id', $1, true)");
    expect(query.mock.calls[2]?.[1]).toEqual([T]);
    expect(all[3]).toContain("FOR SHARE OF s, u, tm, t, d, company, dc");
    expect(query.mock.calls[3]?.[1]).toEqual([S, D, I, 300000]);
    expect(all[4]).toContain("ORDER BY id LIMIT 1 FOR SHARE");
    expect(all[5]).toContain("ON CONFLICT ON CONSTRAINT session_assertion_sequences_pk");
    expect(query.mock.calls[5]?.[1]).toEqual([U, I, D]);
    expect(all.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not allocate for global sessions, invalid scope or missing MFA", async () => {
    const cases: Array<{ tenant?: string | null; scope?: object | null; factor?: boolean }> = [
      { tenant: null }, { scope: null }, { factor: false },
    ];
    for (const config of cases) {
      const { repo, query, release } = mockDb(config);
      expect(await repo.reserveForVerifiedProof(INPUT)).toBeNull();
      expect(statements(query)).not.toContainEqual(expect.stringContaining("INSERT INTO identity.session_assertion_sequences"));
      expect(statements(query).at(-1)).toBe("ROLLBACK");
      expect(release).toHaveBeenCalledOnce();
    }
  });

  it("refuses exhausted or malformed database sequence responses", async () => {
    for (const next of [null, "0", "9007199254740992", "not-an-int"]) {
      const { repo, query, release } = mockDb({ next });
      await expect(repo.reserveForVerifiedProof(INPUT)).rejects.toThrow("SSA_SEQUENCE_EXHAUSTED_OR_INVALID");
      expect(statements(query).at(-1)).toBe("ROLLBACK");
      expect(release).toHaveBeenCalledOnce();
    }
  });

  it("refuses expired session and expired credential", async () => {
    for (const expired of ["session_expires_at", "credential_expires_at"] as const) {
      const { repo, query, release } = mockDb({ scope: { ...scope, [expired]: new Date(0) } });
      await expect(repo.reserveForVerifiedProof(INPUT)).rejects.toThrow("SSA_SEQUENCE_ELIGIBILITY_EXPIRED");
      expect(statements(query)).not.toContainEqual(expect.stringContaining("INSERT INTO identity.session_assertion_sequences"));
      expect(statements(query).at(-1)).toBe("ROLLBACK");
      expect(release).toHaveBeenCalledOnce();
    }
  });

  it("rolls back and releases connection on database errors", async () => {
    const { repo, query, release } = mockDb({ throwAt: "INSERT INTO identity.session_assertion_sequences" });
    await expect(repo.reserveForVerifiedProof(INPUT)).rejects.toThrow("DATABASE_INJECTED_FAILURE");
    expect(statements(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses malformed identifiers before borrowing a connection", async () => {
    const { repo, connect } = mockDb();
    await expect(repo.reserveForVerifiedProof({ ...INPUT, deviceId: "bad" })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects invalid reauthentication policy", () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    for (const age of [0, -1, NaN, 2.5, Infinity]) {
      expect(() => new PostgresBusinessSsaSequenceAllocator(pool, age))
        .toThrow("SSA_SEQUENCE_REAUTH_POLICY_INVALID");
    }
  });
});
