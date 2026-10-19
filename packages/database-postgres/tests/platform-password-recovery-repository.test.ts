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
