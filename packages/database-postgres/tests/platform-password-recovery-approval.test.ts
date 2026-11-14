import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPlatformPasswordRecoveryRepository } from "../src/index.js";

const REQUEST = "018f0000-0000-7000-8000-0000000000a4";
const SUBJECT = "018f0000-0000-7000-8000-0000000000b4";
const APPROVER = "018f0000-0000-7000-8000-0000000000d4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const CORRELATION = "018f0000-0000-7000-8000-0000000000c4";
const AT = new Date("2026-10-18T23:00:00.000Z");
const INPUT = { requestId: REQUEST, approverSessionId: SESSION, maxReauthenticationAgeMs: 300_000 };

function fixture(options: { noRequest?: boolean; noPermission?: boolean; auditFailure?: boolean } = {}) {
  const sql: string[] = [];
  const query = vi.fn(async (statement: string, params?: unknown[]) => {
    sql.push(statement);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
    if (statement.includes("FROM identity.password_recovery_requests") && statement.includes("FOR UPDATE")) {
      expect(params).toEqual([REQUEST]);
      return { rows: options.noRequest ? [] : [{ user_id: SUBJECT, correlation_id: CORRELATION }] };
    }
    if (statement.includes("FROM identity.sessions AS s")) {
      expect(params).toEqual([SESSION, SUBJECT, 300_000]);
      return { rows: options.noPermission ? [] : [{ approver_user_id: APPROVER }] };
    }
    if (statement.includes("UPDATE identity.password_recovery_requests")) {
      expect(params).toEqual([REQUEST]);
      return { rows: [{ approved_at: AT }] };
    }
    if (statement.includes("INSERT INTO identity.security_events")) {
      if (options.auditFailure) throw new Error("audit ledger unavailable");
      return { rows: [{
        user_id: SUBJECT, session_id: SESSION, tenant_id: null,
        event_code: "PLATFORM_RECOVERY_APPROVED", result: "SUCCEEDED",
        reason_code: null, correlation_id: CORRELATION,
        occurred_at: AT, server_recorded_at: new Date(AT.getTime() + 1000),
      }] };
    }
    throw new Error("unexpected approval SQL");
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const repository = new PostgresPlatformPasswordRecoveryRepository({ connect } as unknown as Pool);
  return { repository, query, sql, release, connect };
}

describe("assisted platform recovery approval — no public endpoint", () => {
  it("checks an explicit permission, global session, MFA factor, self-denial and reauthentication", async () => {
    const t = fixture();
    expect(await t.repository.approveAssistedRecovery(INPUT)).toEqual({ approverUserId: APPROVER });
    const authorization = t.sql.find(q => q.includes("FROM identity.sessions AS s"));
    expect(authorization).toContain("PLATFORM_RECOVERY_APPROVE");
    expect(authorization).toContain("s.user_id <> $2");
    expect(authorization).toContain("s.tenant_id IS NULL");
    expect(authorization).toContain("s.mfa_status = 'SATISFIED'");
    expect(authorization).toContain("factor.status = 'ACTIVE'");
    expect(authorization).toContain("factor.verified_at IS NOT NULL");
    expect(authorization).toContain("s.last_reauthenticated_at >=");
    expect(authorization).toContain("FOR UPDATE OF s");
    expect(t.sql.at(-1)).toBe("COMMIT");
    expect(t.sql.filter(q => q.includes("INSERT INTO identity.security_events"))).toHaveLength(1);
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("does not grant recovery approval if request was consumed, expired or ineligible", async () => {
    const t = fixture({ noRequest: true });
    await expect(t.repository.approveAssistedRecovery(INPUT))
      .rejects.toThrow("PLATFORM_RECOVERY_APPROVAL_REQUEST_INELIGIBLE");
    expect(t.sql.at(-1)).toBe("ROLLBACK");
    expect(t.sql.some(q => q.includes("UPDATE identity.password_recovery_requests"))).toBe(false);
  });

  it("fails closed without a matching explicit platform grant and MFA session", async () => {
    const t = fixture({ noPermission: true });
    await expect(t.repository.approveAssistedRecovery(INPUT))
      .rejects.toThrow("PLATFORM_RECOVERY_APPROVER_NOT_AUTHORIZED");
    expect(t.sql.at(-1)).toBe("ROLLBACK");
    expect(t.sql.some(q => q.includes("UPDATE identity.password_recovery_requests"))).toBe(false);
    expect(t.sql.some(q => q.includes("INSERT INTO identity.security_events"))).toBe(false);
  });

  it("rolls back the approval if its audit ledger append fails", async () => {
    const t = fixture({ auditFailure: true });
    await expect(t.repository.approveAssistedRecovery(INPUT))
      .rejects.toThrow("audit ledger unavailable");
    expect(t.sql.some(q => q.includes("SET support_verified = true"))).toBe(true);
    expect(t.sql.at(-1)).toBe("ROLLBACK");
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("rejects invalid identifiers and policy before opening a database connection", async () => {
    const t = fixture();
    for (const invalid of [
      { ...INPUT, requestId: "not-uuid" },
      { ...INPUT, approverSessionId: "not-uuid" },
      { ...INPUT, maxReauthenticationAgeMs: 0 },
      { ...INPUT, maxReauthenticationAgeMs: Number.POSITIVE_INFINITY },
    ]) {
      await expect(t.repository.approveAssistedRecovery(invalid)).rejects.toThrow();
    }
    expect(t.connect).not.toHaveBeenCalled();
  });
});
