import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPlatformPasswordRecoveryRepository } from "../src/index.js";

const requestId = "018f0000-0000-7000-8000-0000000000a4";
const userId = "018f0000-0000-7000-8000-0000000000b4";
const correlationId = "018f0000-0000-7000-8000-0000000000c4";
const tokenHash = "a".repeat(64);
const newVerifier = "$argon2id$v=19$m=19456,t=2,p=1$MTIzNDU2Nzg5MGFiY2RlZg$" + "Y".repeat(43);
const input = { requestId, tokenHash, newVerifier };
const occurredAt = new Date("2026-10-18T22:00:00.000Z");

function setup(opts: { approved?: boolean; expired?: boolean; badAudit?: boolean } = {}) {
  const sql: string[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    sql.push(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
    if (text.includes("FROM identity.password_recovery_requests") && text.includes("FOR UPDATE")) {
      return { rows: [{
        user_id: userId, token_hash: tokenHash, correlation_id: correlationId,
        support_verified: opts.approved ?? true, is_expired: opts.expired ?? false,
      }] };
    }
    if (text.includes("SELECT id::text FROM identity.users")) return { rows: [{ id: userId }] };
    if (text.includes("UPDATE identity.user_credentials")) return { rows: [{ id: "retired" }] };
    if (text.includes("INSERT INTO identity.user_credentials")) return { rows: [{ id: values?.[0] }] };
    if (text.includes("UPDATE identity.session_refresh_tokens") || text.includes("UPDATE identity.sessions")) {
      return { rows: [] };
    }
    if (text.includes("UPDATE identity.password_recovery_requests")) return { rows: [{ consumed_at: occurredAt }] };
    if (text.includes("INSERT INTO identity.security_events")) {
      if (opts.badAudit) throw new Error("ledger unavailable");
      return { rows: [{
        user_id: userId, session_id: null, tenant_id: null,
        event_code: "PLATFORM_RECOVERY_COMPLETED", result: "SUCCEEDED",
        reason_code: null, correlation_id: correlationId,
        occurred_at: occurredAt, server_recorded_at: new Date(occurredAt.getTime() + 1000),
      }] };
    }
    throw new Error("unexpected SQL");
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return {
    repository: new PostgresPlatformPasswordRecoveryRepository({ connect } as unknown as Pool),
    sql, release, connect,
  };
}

describe("assisted recovery completion, no HTTP handler", () => {
  it("rotates the credential, revokes tokens and sessions, consumes and audits in one transaction", async () => {
    const t = setup();
    const response = await t.repository.completeAssistedRecovery(input);
    expect(response.credentialId).toMatch(/^[a-f0-9-]{36}$/);
    expect(t.sql[0]).toBe("BEGIN");
    expect(t.sql.at(-1)).toBe("COMMIT");
    expect(t.sql.some(s => s.includes("UPDATE identity.user_credentials"))).toBe(true);
    expect(t.sql.some(s => s.includes("INSERT INTO identity.user_credentials"))).toBe(true);
    expect(t.sql.some(s => s.includes("UPDATE identity.session_refresh_tokens"))).toBe(true);
    expect(t.sql.some(s => s.includes("UPDATE identity.sessions"))).toBe(true);
    expect(t.sql.some(s => s.includes("status = 'CONSUMED'"))).toBe(true);
    expect(t.sql.some(s => s.includes("INSERT INTO identity.security_events"))).toBe(true);
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("fails closed when reinforced approval or expiry is invalid", async () => {
    for (const options of [{ approved: false }, { expired: true }]) {
      const t = setup(options);
      await expect(t.repository.completeAssistedRecovery(input))
        .rejects.toThrow("PLATFORM_RECOVERY_COMPLETION_NOT_AUTHORIZED");
      expect(t.sql.at(-1)).toBe("ROLLBACK");
      expect(t.sql.some(s => s.includes("UPDATE identity.user_credentials"))).toBe(false);
    }
  });

  it("rolls back the credential and revocations if append-only audit fails", async () => {
    const t = setup({ badAudit: true });
    await expect(t.repository.completeAssistedRecovery(input)).rejects.toThrow("ledger unavailable");
    expect(t.sql.at(-1)).toBe("ROLLBACK");
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("rejects unversioned verifier before taking a connection", async () => {
    const t = setup();
    await expect(t.repository.completeAssistedRecovery({ ...input, newVerifier: "invalid" })).rejects.toThrow();
    expect(t.connect).not.toHaveBeenCalled();
  });
});
