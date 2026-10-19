import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPlatformPasswordRecoveryRepository } from "../src/index.js";

const INPUT = {
  userId: "018f0000-0000-7000-8000-0000000000a1",
  tokenHash: "a".repeat(64),
  correlationId: "018f0000-0000-7000-8000-0000000000c2",
  expiresAt: "2026-10-18T21:00:00.000Z",
  maxAttempts: 5,
};

const REQUESTED_AT = new Date("2026-10-18T20:00:00.000Z");

function setup(options: { noRequestRow?: boolean; failAudit?: boolean } = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("INSERT INTO identity.password_recovery_requests")) {
      return { rows: options.noRequestRow ? [] : [{
        id: values?.[0], requested_at: REQUESTED_AT,
      }] };
    }
    if (sql.includes("INSERT INTO identity.security_events")) {
      if (options.failAudit) throw new Error("security event unavailable");
      return { rows: [{
        user_id: INPUT.userId,
        session_id: null,
        tenant_id: null,
        event_code: "PLATFORM_RECOVERY_REQUESTED",
        result: "SUCCEEDED",
        reason_code: null,
        correlation_id: INPUT.correlationId,
        occurred_at: REQUESTED_AT,
        server_recorded_at: new Date("2026-10-18T20:00:01.000Z"),
      }] };
    }
    throw new Error("unexpected query: " + sql);
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const repo = new PostgresPlatformPasswordRecoveryRepository({ connect } as unknown as Pool);
  return { repo, query, connect, release };
}

describe("PostgresPlatformPasswordRecoveryRepository", () => {
  it("creates an EMAIL system request and append-only security event in one transaction", async () => {
    const { repo, query, connect, release } = setup();
    const result = await repo.createRequest(INPUT);
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    const calls = query.mock.calls as [string, unknown[] | undefined][];
    expect(calls.map(([sql]) => sql === "BEGIN" || sql === "COMMIT"
      ? sql : sql.includes("identity.password_recovery_requests") ? "RECOVERY" : "SECURITY"))
      .toEqual(["BEGIN", "RECOVERY", "SECURITY", "COMMIT"]);

    const [insertSql, params] = calls[1]!;
    expect(insertSql).toContain("'REQUESTED', 'SYSTEM'");
    expect(insertSql).toContain("'EMAIL'");
    expect(insertSql).toContain("NULL, false, 0");
    expect(insertSql).toContain("clock_timestamp()");
    expect(params).toEqual([
      result.requestId, INPUT.userId, INPUT.tokenHash,
      INPUT.maxAttempts, INPUT.expiresAt, INPUT.correlationId,
    ]);
    expect(insertSql).not.toMatch(/\b(password|verifier|raw_token|token_value)\b/i);
    const [auditSql] = calls[2]!;
    expect(auditSql).toContain("INSERT INTO identity.security_events");
  });

  it("rolls back the request if writing the security event fails", async () => {
    const { repo, query, release } = setup({ failAudit: true });
    await expect(repo.createRequest(INPUT)).rejects.toThrow("security event unavailable");
    expect(query.mock.calls.map(([sql]) => sql === "BEGIN" || sql === "ROLLBACK"
      ? sql : sql.includes("identity.password_recovery_requests") ? "RECOVERY" : "SECURITY"))
      .toEqual(["BEGIN", "RECOVERY", "SECURITY", "ROLLBACK"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back when PostgreSQL returns no recovery row", async () => {
    const { repo, query, release } = setup({ noRequestRow: true });
    await expect(repo.createRequest(INPUT)).rejects.toThrow("PLATFORM_RECOVERY_INSERT_RETURNED_NO_ROW");
    expect(query.mock.calls.map(([sql]) => sql === "BEGIN" || sql === "ROLLBACK" ? sql : "RECOVERY"))
      .toEqual(["BEGIN", "RECOVERY", "ROLLBACK"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects unhashed tokens, invalid correlations, dates and attempt policies before connecting", async () => {
    const { repo, connect } = setup();
    const invalid = [
      { ...INPUT, tokenHash: "plaintext-reset-token" },
      { ...INPUT, correlationId: "not-a-uuid" },
      { ...INPUT, expiresAt: "tomorrow" },
      { ...INPUT, maxAttempts: 0 },
      { ...INPUT, maxAttempts: 21 },
      { ...INPUT, maxAttempts: 1.5 },
    ];
    for (const request of invalid) {
      await expect(repo.createRequest(request)).rejects.toThrow();
    }
    expect(connect).not.toHaveBeenCalled();
  });
});


const VERIFY_ID = "018f0000-0000-7000-8000-0000000000b2";
const EVENT_AT = new Date("2026-10-18T20:45:00.000Z");

function setupVerification(options: {
  missing?: boolean;
  status?: string;
  expired?: boolean;
  attempts?: number;
  maxAttempts?: number;
  tokenHash?: string;
  failAudit?: boolean;
} = {}) {
  const state = {
    status: options.status ?? "REQUESTED",
    attempt_count: options.attempts ?? 0,
    max_attempts: options.maxAttempts ?? 5,
  };
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("FROM identity.password_recovery_requests") && sql.includes("FOR UPDATE")) {
      expect(params).toEqual([VERIFY_ID]);
      return { rows: options.missing ? [] : [{
        user_id: INPUT.userId,
        token_hash: options.tokenHash ?? INPUT.tokenHash,
        status: state.status,
        attempt_count: state.attempt_count,
        max_attempts: state.max_attempts,
        correlation_id: INPUT.correlationId,
        is_expired: options.expired ?? false,
      }] };
    }
    if (sql.includes("UPDATE identity.password_recovery_requests")) {
      expect(params).toEqual([VERIFY_ID]);
      if (sql.includes("status = 'VERIFIED'")) state.status = "VERIFIED";
      else if (sql.includes("status = 'EXPIRED'")) state.status = "EXPIRED";
      else {
        state.attempt_count += 1;
        state.status = state.attempt_count >= state.max_attempts ? "LOCKED" : "REQUESTED";
      }
      return { rows: [{ event_at: EVENT_AT }] };
    }
    if (sql.includes("INSERT INTO identity.security_events")) {
      if (options.failAudit) throw new Error("security audit failed");
      return { rows: [{
        user_id: INPUT.userId,
        session_id: null,
        tenant_id: null,
        event_code: "PLATFORM_RECOVERY_REJECTED",
        result: "REJECTED",
        reason_code: params?.[7] ?? null,
        correlation_id: INPUT.correlationId,
        occurred_at: EVENT_AT,
        server_recorded_at: new Date("2026-10-18T20:45:01.000Z"),
      }] };
    }
    throw new Error("unexpected SQL: " + sql);
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const repository = new PostgresPlatformPasswordRecoveryRepository({ connect } as unknown as Pool);
  const input = { requestId: VERIFY_ID, tokenHash: INPUT.tokenHash };
  return { repository, input, state, query, connect, release };
}

describe("platform password recovery token verification", () => {
  it("verifies a matching hash only once using a row lock", async () => {
    const t = setupVerification();
    await expect(t.repository.verifyRequestToken(t.input)).resolves.toBe(true);
    await expect(t.repository.verifyRequestToken(t.input)).resolves.toBe(false);
    expect(t.state.status).toBe("VERIFIED");
    expect(t.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(t.query.mock.calls.filter(([sql]) => sql.includes("status = 'VERIFIED'"))).toHaveLength(1);
    expect(t.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO identity.security_events"))).toBe(false);
    expect(t.release).toHaveBeenCalledTimes(2);
  });

  it("rejects an incorrect hash, increases attempts and writes security audit in one transaction", async () => {
    const t = setupVerification();
    await expect(t.repository.verifyRequestToken({
      ...t.input, tokenHash: "b".repeat(64),
    })).resolves.toBe(false);
    expect(t.state.status).toBe("REQUESTED");
    expect(t.state.attempt_count).toBe(1);
    const sql = t.query.mock.calls.map(([s]) => s);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("FOR UPDATE");
    expect(sql[2]).toContain("attempt_count = attempt_count + 1");
    expect(sql[3]).toContain("INSERT INTO identity.security_events");
    expect(sql[4]).toBe("COMMIT");
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("locks the request at the attempt limit and denies further verification", async () => {
    const t = setupVerification({ attempts: 4, maxAttempts: 5 });
    await expect(t.repository.verifyRequestToken({
      ...t.input, tokenHash: "b".repeat(64),
    })).resolves.toBe(false);
    expect(t.state.status).toBe("LOCKED");
    expect(t.state.attempt_count).toBe(5);
    await expect(t.repository.verifyRequestToken(t.input)).resolves.toBe(false);
    expect(t.query.mock.calls.filter(([sql]) => sql.includes("UPDATE identity.password_recovery_requests"))).toHaveLength(1);
  });

  it("expires an active request using database time without verifying its token", async () => {
    const t = setupVerification({ expired: true });
    await expect(t.repository.verifyRequestToken(t.input)).resolves.toBe(false);
    expect(t.state.status).toBe("EXPIRED");
    expect(t.query.mock.calls.some(([sql]) => sql.includes("status = 'EXPIRED'"))).toBe(true);
    expect(t.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO identity.security_events"))).toBe(true);
  });

  it("returns the same rejection for a missing and consumed request without writing", async () => {
    for (const options of [{ missing: true }, { status: "CONSUMED" }]) {
      const t = setupVerification(options);
      await expect(t.repository.verifyRequestToken(t.input)).resolves.toBe(false);
      expect(t.query.mock.calls.some(([sql]) => sql.includes("UPDATE identity.password_recovery_requests"))).toBe(false);
      expect(t.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO identity.security_events"))).toBe(false);
      expect(t.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    }
  });

  it("rolls back verification attempt if security audit fails", async () => {
    const t = setupVerification({ failAudit: true });
    await expect(t.repository.verifyRequestToken({
      ...t.input, tokenHash: "b".repeat(64),
    })).rejects.toThrow("security audit failed");
    expect(t.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("fails closed on a malformed persisted digest or invalid input before a transaction", async () => {
    const malformed = setupVerification({ tokenHash: "bad-hash" });
    await expect(malformed.repository.verifyRequestToken(malformed.input))
      .rejects.toThrow("PLATFORM_RECOVERY_STORED_HASH_INVALID");
    expect(malformed.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");

    const invalid = setupVerification();
    for (const request of [
      { ...invalid.input, tokenHash: "plaintext" },
      { ...invalid.input, requestId: "invalid" },
    ]) {
      await expect(invalid.repository.verifyRequestToken(request)).rejects.toThrow();
    }
    expect(invalid.connect).not.toHaveBeenCalled();
  });
});
