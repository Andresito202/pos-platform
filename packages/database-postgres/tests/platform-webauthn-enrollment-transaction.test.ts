import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  PostgresPlatformWebAuthnEnrollmentTransaction,
  type PlatformWebAuthnEnrollmentMaterial,
} from "../src/platform-webauthn-enrollment-transaction.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const CHALLENGE = randomBytes(32).toString("base64url");
const CORRELATION = "018f0000-0000-7000-8000-0000000000a4";
const rpId = "admin.example.test", expectedOrigin = "https://admin.example.test";
const validInput = { authorizationProof: "opaque-user-auth-proof", challenge: CHALLENGE, rpId, expectedOrigin };
const material: PlatformWebAuthnEnrollmentMaterial = {
  credentialId: randomBytes(32).toString("base64url"),
  publicKeyCoseBase64url: randomBytes(65).toString("base64url"),
  counter: 0, backupEligible: false, backedUp: false, userVerified: true,
};

function stubDb(options: {
  missingChallenge?: boolean;
  rejectAudit?: boolean;
  duplicateCredential?: boolean;
} = {}) {
  const sql: string[] = [];
  const query = vi.fn(async (statement: string, params: unknown[] = []) => {
    sql.push(statement);
    if (statement.includes("FROM identity.webauthn_challenges AS c")) {
      return { rows: options.missingChallenge ? [] : [{
        id: "018f0000-0000-7000-8000-0000000000c4", user_id: USER,
        session_id: SESSION, rp_id: rpId, expected_origin: expectedOrigin,
        correlation_id: CORRELATION,
      }] };
    }
    if (statement.includes("INSERT INTO identity.mfa_factors")) {
      return { rows: [{ id: params[0] }] };
    }
    if (statement.includes("INSERT INTO identity.webauthn_credential_material")) {
      if (options.duplicateCredential) throw new Error("duplicate key value violates unique constraint");
      return { rows: [{ id: params[0] }] };
    }
    if (statement.includes("UPDATE identity.mfa_factors") ||
        statement.includes("UPDATE identity.webauthn_challenges")) {
      return { rows: [{ id: params[0] }] };
    }
    if (statement.includes("SELECT clock_timestamp()")) {
      return { rows: [{ occurred_at: new Date("2026-10-20T00:00:00.000Z") }] };
    }
    if (statement.includes("INSERT INTO identity.security_events")) {
      if (options.rejectAudit) throw new Error("permission denied for security_events");
      return { rows: [{
        user_id: params[1], session_id: params[2], tenant_id: params[3],
        event_code: params[4], result: params[5], reason_code: params[6],
        correlation_id: params[7], occurred_at: new Date(String(params[8])),
        server_recorded_at: new Date("2026-10-20T00:00:00.001Z"),
      }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, connect, query, release, sql };
}
const resolver = vi.fn(async (proof: string) => proof === validInput.authorizationProof
  ? { userId: USER, sessionId: SESSION } : null);
const verifier = vi.fn(async () => material);

describe("D3-R5.2e.2 atomic enrollment persistence (no session issuer)", () => {
  it("requires an authenticated session resolver and rejects an unknown proof before SQL", async () => {
    const db = stubDb();
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    expect(await tx.verifyAndEnroll({ ...validInput, authorizationProof: "wrong" }, verifier)).toBeNull();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("rejects malformed challenges before invoking session resolver or SQL", async () => {
    const db = stubDb(), resolve = vi.fn(async () => ({ userId: USER, sessionId: SESSION }));
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolve, 300000);
    expect(await tx.verifyAndEnroll({ ...validInput, challenge: "abc" }, verifier)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("locks the existing session, challenge and user before verified enrollment and audit commit", async () => {
    const db = stubDb(), check = vi.fn(async () => material);
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    const result = await tx.verifyAndEnroll(validInput, check);
    expect(result).toMatchObject({ userId: USER });
    expect(check).toHaveBeenCalledWith({
      challenge: CHALLENGE, userId: USER, sessionId: SESSION,
      factorId: null, purpose: "ENROLL", rpId, expectedOrigin,
    });
    expect(db.sql.join("\n")).toContain("FOR UPDATE OF c, s, u");
    expect(db.sql.join("\n")).toContain("s.tenant_id IS NULL");
    expect(db.sql.join("\n")).toContain('"authorization".platform_role_assignments');
    expect(db.sql.join("\n")).toContain("s.last_reauthenticated_at IS NOT NULL");
    expect(db.sql.join("\n")).toContain("'PENDING'");
    expect(db.sql.join("\n")).toContain("SET status = 'ACTIVE'");
    expect(db.query.mock.calls.some(([statement, params]) => statement.includes("INSERT INTO identity.security_events") && params?.[4] === "PLATFORM_MFA_ENROLLED")).toBe(true);
    expect(db.sql.at(-1)).toBe("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("rejects revoked, mismatched, expired or reused challenges without calling crypto", async () => {
    const db = stubDb({ missingChallenge: true }), check = vi.fn(async () => material);
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    expect(await tx.verifyAndEnroll(validInput, check)).toBeNull();
    expect(check).not.toHaveBeenCalled();
    expect(db.sql).toContain("ROLLBACK");
    expect(db.sql.some((s) => s.includes("INSERT INTO identity.mfa_factors"))).toBe(false);
  });

  it("rolls back and does not insert material if registration proof is rejected", async () => {
    const db = stubDb();
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    expect(await tx.verifyAndEnroll(validInput, async () => null)).toBeNull();
    expect(db.sql.at(-1)).toBe("ROLLBACK");
    expect(db.sql.some((s) => s.includes("INSERT INTO identity.mfa_factors"))).toBe(false);
  });

  it("rolls back when public material is structurally invalid", async () => {
    const db = stubDb();
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    expect(await tx.verifyAndEnroll(validInput, async () => ({
      ...material, backedUp: true, backupEligible: false,
    }))).toBeNull();
    expect(db.sql.at(-1)).toBe("ROLLBACK");
  });

  it("rolls back factor and material writes when the security event cannot be appended", async () => {
    const db = stubDb({ rejectAudit: true });
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    await expect(tx.verifyAndEnroll(validInput, async () => material)).rejects.toThrow("permission denied");
    expect(db.sql.at(-1)).toBe("ROLLBACK");
    expect(db.sql.some((s) => s.includes("INSERT INTO identity.mfa_factors"))).toBe(true);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("does not consume the challenge after a duplicate credential unique constraint failure", async () => {
    const db = stubDb({ duplicateCredential: true });
    const tx = new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 300000);
    await expect(tx.verifyAndEnroll(validInput, async () => material)).rejects.toThrow("duplicate");
    expect(db.sql.at(-1)).toBe("ROLLBACK");
    expect(db.sql.some((s) => s.includes("UPDATE identity.webauthn_challenges"))).toBe(false);
  });

  it("requires an explicit positive reauthentication policy", () => {
    const db = stubDb();
    expect(() => new PostgresPlatformWebAuthnEnrollmentTransaction(db.pool, resolver, 0))
      .toThrow("PLATFORM_WEBAUTHN_ENROLL_REAUTH_POLICY_INVALID");
  });
});
