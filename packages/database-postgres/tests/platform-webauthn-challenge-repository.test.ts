import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPlatformWebAuthnChallengeRepository } from "../src/index.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const CORRELATION = "018f0000-0000-7000-8000-0000000000c4";
const CHALLENGE_ID = "018f0000-0000-7000-8000-0000000000a4";
const CHALLENGE = Buffer.alloc(32, 7).toString("base64url");
const DIGEST = createHash("sha256").update(CHALLENGE, "utf8").digest("hex");
const EXPIRES = () => new Date(Date.now() + 120000).toISOString();

function fixture(mode: "normal" | "absent" | "update-failure" = "normal") {
  const sql: string[] = [];
  const query = vi.fn(async (statement: string, values?: unknown[]) => {
    sql.push(statement);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
    if (statement.includes("FROM identity.webauthn_challenges")) {
      expect(values).toEqual([DIGEST, USER, "REAUTHENTICATE", SESSION]);
      return { rows: mode === "absent" ? [] : [{
        id: CHALLENGE_ID, user_id: USER, factor_id: null,
        session_id: SESSION, purpose: "REAUTHENTICATE",
        rp_id: "pos.example.test", expected_origin: "https://pos.example.test",
      }] };
    }
    if (statement.includes("UPDATE identity.webauthn_challenges")) {
      if (mode === "update-failure") throw new Error("consume unavailable");
      expect(values).toEqual([CHALLENGE_ID]);
      return { rows: [{ id: CHALLENGE_ID }] };
    }
    if (statement.includes("INSERT INTO identity.webauthn_challenges")) return { rows: [] };
    throw new Error("unexpected SQL");
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const pool = { query, connect } as unknown as Pool;
  const repository = new PostgresPlatformWebAuthnChallengeRepository(pool);
  return { repository, query, sql, release, connect };
}

describe("durable WebAuthn challenge persistence (not identity authentication)", () => {
  it("issues an unpredictable 32-byte challenge but persists only its digest", async () => {
    const t = fixture();
    const created = await t.repository.issue({
      userId: USER, factorId: null, sessionId: SESSION,
      purpose: "REAUTHENTICATE", rpId: "pos.example.test",
      expectedOrigin: "https://pos.example.test",
      expiresAt: EXPIRES(), correlationId: CORRELATION,
    });
    expect(Buffer.from(created.challenge, "base64url")).toHaveLength(32);
    expect(created.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    const inserted = t.query.mock.calls.find(([q]) => q.includes("INSERT INTO identity.webauthn_challenges"));
    expect(inserted).toBeDefined();
    const values = inserted?.[1] as unknown[];
    expect(values[5]).toBe(createHash("sha256").update(created.challenge).digest("hex"));
    expect(values).not.toContain(created.challenge);
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("locks a bound live challenge, verifies server-stored RP and origin, consumes once", async () => {
    const t = fixture();
    const verify = vi.fn(async (value: { rpId: string; expectedOrigin: string }) => {
      expect(value.rpId).toBe("pos.example.test");
      expect(value.expectedOrigin).toBe("https://pos.example.test");
      return true;
    });
    expect(await t.repository.consumeAfterVerifiedProof({
      userId: USER, purpose: "REAUTHENTICATE", sessionId: SESSION, challenge: CHALLENGE,
    }, verify)).toBe(true);
    expect(verify).toHaveBeenCalledOnce();
    expect(t.sql[0]).toBe("BEGIN");
    expect(t.sql.join("\n")).toContain("FOR UPDATE");
    expect(t.sql.join("\n")).toContain("consumed_at IS NULL");
    expect(t.sql.at(-1)).toBe("COMMIT");
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("denies absent, expired, consumed or wrong-scope challenges without invoking the proof checker", async () => {
    const t = fixture("absent");
    const verify = vi.fn().mockResolvedValue(true);
    expect(await t.repository.consumeAfterVerifiedProof({
      userId: USER, purpose: "REAUTHENTICATE", sessionId: SESSION, challenge: CHALLENGE,
    }, verify)).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(t.sql.at(-1)).toBe("ROLLBACK");
  });

  it("never consumes when cryptographic proof checker returns false", async () => {
    const t = fixture();
    expect(await t.repository.consumeAfterVerifiedProof({
      userId: USER, purpose: "REAUTHENTICATE", sessionId: SESSION, challenge: CHALLENGE,
    }, async () => false)).toBe(false);
    expect(t.sql.some(s => s.includes("UPDATE identity.webauthn_challenges"))).toBe(false);
    expect(t.sql.at(-1)).toBe("ROLLBACK");
  });

  it("rolls back on concurrent consumption/update failure", async () => {
    const t = fixture("update-failure");
    await expect(t.repository.consumeAfterVerifiedProof({
      userId: USER, purpose: "REAUTHENTICATE", sessionId: SESSION, challenge: CHALLENGE,
    }, async () => true)).rejects.toThrow("consume unavailable");
    expect(t.sql.at(-1)).toBe("ROLLBACK");
    expect(t.release).toHaveBeenCalledOnce();
  });

  it("rejects malformed, noncanonical challenges or disallowed RP origin without DB writes", async () => {
    const t = fixture();
    expect(await t.repository.consumeAfterVerifiedProof({
      userId: USER, purpose: "REAUTHENTICATE", sessionId: SESSION,
      challenge: "not-a-32-byte-challenge",
    }, async () => true)).toBe(false);
    await expect(t.repository.issue({
      userId: USER, factorId: null, sessionId: null, purpose: "ENROLL",
      rpId: "pos.example.test", expectedOrigin: "https://evil.example.test",
      expiresAt: EXPIRES(), correlationId: CORRELATION,
    })).rejects.toThrow("PLATFORM_WEBAUTHN_ORIGIN_INVALID");
    expect(t.query).not.toHaveBeenCalled();
    expect(t.connect).not.toHaveBeenCalled();
  });
});
