import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresPlatformWebAuthnAssertionTransaction } from "../src/index.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const FACTOR = "018f0000-0000-7000-8000-0000000000d4";
const MATERIAL = "018f0000-0000-7000-8000-0000000000a4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const CHALLENGE_ID = "018f0000-0000-7000-8000-0000000000f4";
const CORRELATION = "018f0000-0000-7000-8000-0000000000c4";
const NOW = new Date("2026-10-18T23:45:00.000Z");
const CHALLENGE = Buffer.alloc(32, 9).toString("base64url");
const input = { userId: USER, factorId: FACTOR, sessionId: SESSION, challenge: CHALLENGE,
  purpose: "REAUTHENTICATE" as const, rpId: "admin.example.test",
  expectedOrigin: "https://admin.example.test" };
const proof = { userVerified: true as const, newCounter: 1, credentialBackedUp: false };

function fixture(options: { challenge?: boolean; material?: boolean; cas?: boolean;
  auditFailure?: boolean; consumed?: boolean } = {}) {
  const sql: string[] = [];
  const query = vi.fn(async (statement: string, args?: unknown[]) => {
    sql.push(statement);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
    if (statement.includes("FROM identity.webauthn_challenges AS c")) {
      expect(args?.slice(1)).toEqual([USER, FACTOR, SESSION, "REAUTHENTICATE", "admin.example.test", "https://admin.example.test"]);
      return { rows: options.challenge === false ? [] : [{
        id: CHALLENGE_ID, user_id: USER, factor_id: FACTOR, session_id: SESSION,
        purpose: "REAUTHENTICATE", rp_id: "admin.example.test",
        expected_origin: "https://admin.example.test", correlation_id: CORRELATION,
      }] };
    }
    if (statement.includes("FROM identity.webauthn_credential_material AS m"))
      return { rows: options.material === false ? [] : [{
        material_id: MATERIAL, user_id: USER, factor_id: FACTOR,
        secret_reference: "webauthn:v1:" + MATERIAL, credential_id: "X".repeat(43),
        public_key_cose_base64url: "X".repeat(120), counter: "0", version: "1",
        backup_eligible: false, backed_up: false,
      }] };
    if (statement.includes("UPDATE identity.webauthn_credential_material AS m"))
      return { rows: options.cas === false ? [] : [{ id: MATERIAL }] };
    if (statement.includes("UPDATE identity.webauthn_challenges"))
      return { rows: options.consumed === false ? [] : [{ id: CHALLENGE_ID }] };
    if (statement === "SELECT clock_timestamp() AS occurred_at") return { rows: [{ occurred_at: NOW }] };
    if (statement.includes("INSERT INTO identity.security_events")) {
      if (options.auditFailure) throw new Error("security audit unavailable");
      expect(args?.[4]).toBe("PLATFORM_WEBAUTHN_ASSERTION_VERIFIED");
      return { rows: [{ user_id: USER, session_id: SESSION, tenant_id: null,
        event_code: "PLATFORM_WEBAUTHN_ASSERTION_VERIFIED", result: "SUCCEEDED",
        reason_code: null, correlation_id: CORRELATION,
        occurred_at: NOW, server_recorded_at: new Date(NOW.getTime() + 1000),
      }] };
    }
    throw new Error("unexpected WebAuthn transaction SQL");
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { sql, query, release, connect, coordinator:
    new PostgresPlatformWebAuthnAssertionTransaction({ connect } as unknown as Pool) };
}

describe("atomic internal WebAuthn proof; not a session authorization", () => {
  it("locks challenge and material, CAS-updates counter, consumes and audits in one transaction", async () => {
    const f = fixture();
    const verify = vi.fn().mockResolvedValue(proof);
    expect(await f.coordinator.verifyAndCommit(input, verify)).toBe(true);
    expect(verify).toHaveBeenCalledOnce();
    expect(f.sql[0]).toBe("BEGIN");
    expect(f.sql.at(-1)).toBe("COMMIT");
    expect(f.sql.find(q => q.includes("FROM identity.webauthn_challenges AS c"))).toContain("FOR UPDATE OF c, s");
    expect(f.sql.find(q => q.includes("FROM identity.webauthn_credential_material AS m"))).toContain("FOR UPDATE OF m");
    expect(f.sql.filter(q => q.includes("UPDATE identity.webauthn_challenges"))).toHaveLength(1);
    expect(f.sql.filter(q => q.includes("INSERT INTO identity.security_events"))).toHaveLength(1);
    expect(f.sql.some(q => q.includes("UPDATE identity.sessions"))).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("rejects absent or expired challenge without invoking proof or CAS", async () => {
    const f = fixture({ challenge: false });
    const verify = vi.fn().mockResolvedValue(proof);
    expect(await f.coordinator.verifyAndCommit(input, verify)).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(f.sql.at(-1)).toBe("ROLLBACK");
    expect(f.sql.some(q => q.includes("UPDATE identity.webauthn_credential_material"))).toBe(false);
  });

  it("never consumes challenge if cryptographic proof failed", async () => {
    const f = fixture();
    expect(await f.coordinator.verifyAndCommit(input, async () => null)).toBe(false);
    expect(f.sql.at(-1)).toBe("ROLLBACK");
    expect(f.sql.some(q => q.includes("UPDATE identity.webauthn_challenges"))).toBe(false);
  });

  it("rolls back failed counter CAS, including unconsumed challenge", async () => {
    const f = fixture({ cas: false });
    expect(await f.coordinator.verifyAndCommit(input, async () => proof)).toBe(false);
    expect(f.sql.at(-1)).toBe("ROLLBACK");
    expect(f.sql.some(q => q.includes("UPDATE identity.webauthn_challenges"))).toBe(false);
  });

  it("reverts counter and challenge changes if append-only security audit fails", async () => {
    const f = fixture({ auditFailure: true });
    await expect(f.coordinator.verifyAndCommit(input, async () => proof))
      .rejects.toThrow("security audit unavailable");
    expect(f.sql.some(q => q.includes("UPDATE identity.webauthn_challenges"))).toBe(true);
    expect(f.sql.at(-1)).toBe("ROLLBACK");
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("reverts counter CAS if challenge is lost before consumption", async () => {
    const f = fixture({ consumed: false });
    await expect(f.coordinator.verifyAndCommit(input, async () => proof))
      .rejects.toThrow("PLATFORM_WEBAUTHN_COMMIT_CHALLENGE_RACE");
    expect(f.sql.at(-1)).toBe("ROLLBACK");
  });

  it("rejects invalid identity or malformed challenge before DB connection", async () => {
    const f = fixture();
    await expect(f.coordinator.verifyAndCommit({ ...input, userId: "invalid" }, async () => proof)).rejects.toThrow();
    expect(await f.coordinator.verifyAndCommit({ ...input, challenge: "wrong" }, async () => proof)).toBe(false);
    expect(f.connect).not.toHaveBeenCalled();
  });
});
