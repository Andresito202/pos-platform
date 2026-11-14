import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { UtcDateTimeSchema, UuidSchema, UuidV7Schema, uuidV7 } from "@pos-platform/contracts";

export type PlatformWebAuthnChallengePurpose =
  | "ENROLL" | "AUTHENTICATE" | "GLOBAL_AUTHENTICATE" | "REAUTHENTICATE" | "RECOVERY_APPROVAL";

export interface IssuePlatformWebAuthnChallenge {
  readonly userId: string;
  readonly factorId: string | null;
  readonly sessionId: string | null;
  readonly purpose: PlatformWebAuthnChallengePurpose;
  readonly rpId: string;
  readonly expectedOrigin: string;
  readonly expiresAt: string;
  readonly correlationId: string;
}

export interface VerifyPlatformWebAuthnChallenge {
  readonly userId: string;
  readonly challenge: string;
  readonly purpose: PlatformWebAuthnChallengePurpose;
  readonly sessionId: string | null;
}

export interface LockedPlatformWebAuthnChallenge {
  readonly challenge: string;
  readonly userId: string;
  readonly factorId: string | null;
  readonly sessionId: string | null;
  readonly purpose: PlatformWebAuthnChallengePurpose;
  readonly rpId: string;
  readonly expectedOrigin: string;
}

/**
 * INTERNAL durable challenge persistence, NOT a WebAuthn or MFA verifier.
 *
 * The real central WebAuthn service must authenticate its caller, bind user ID
 * to verified identity, and invoke consumeAfterVerifiedProof ONLY with an
 * actual @simplewebauthn/server signature/origin/RP/UV verification callback.
 * No HTTP, session issuance, MFA SATISFIED update or factor enrollment here.
 */
export class PostgresPlatformWebAuthnChallengeRepository {
  constructor(private readonly pool: Pool) {}

  async issue(input: IssuePlatformWebAuthnChallenge): Promise<{ challengeId: string; challenge: string }> {
    const userId = UuidSchema.parse(input.userId);
    const factorId = input.factorId === null ? null : UuidSchema.parse(input.factorId);
    const sessionId = input.sessionId === null ? null : UuidSchema.parse(input.sessionId);
    const correlationId = UuidV7Schema.parse(input.correlationId);
    if (!["ENROLL", "AUTHENTICATE", "GLOBAL_AUTHENTICATE", "REAUTHENTICATE", "RECOVERY_APPROVAL"].includes(input.purpose)) {
      throw new Error("PLATFORM_WEBAUTHN_PURPOSE_UNSUPPORTED");
    }
    if (typeof input.rpId !== "string" || !/^[a-z0-9.-]{1,253}$/.test(input.rpId) ||
        typeof input.expectedOrigin !== "string") {
      throw new Error("PLATFORM_WEBAUTHN_ORIGIN_INVALID");
    }
    let origin: URL;
    try {
      origin = new URL(input.expectedOrigin);
    } catch {
      throw new Error("PLATFORM_WEBAUTHN_ORIGIN_INVALID");
    }
    if (origin.protocol !== "https:" || origin.hostname !== input.rpId ||
        origin.origin !== input.expectedOrigin || origin.username || origin.password) {
      throw new Error("PLATFORM_WEBAUTHN_ORIGIN_INVALID");
    }
    if ((input.purpose === "REAUTHENTICATE" || input.purpose === "RECOVERY_APPROVAL") &&
      sessionId === null) {
      throw new Error("PLATFORM_WEBAUTHN_SESSION_REQUIRED");
    }
    if(input.purpose==="GLOBAL_AUTHENTICATE"&&sessionId!==null)throw Error("GLOBAL_INITIAL_SESSION_MUST_BE_NULL");
    const expiresAt = UtcDateTimeSchema.parse(input.expiresAt);
    if (Date.parse(expiresAt) <= Date.now()) throw new Error("PLATFORM_WEBAUTHN_EXPIRY_INVALID");

    const challenge = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(challenge, "utf8").digest("hex");
    const challengeId = uuidV7();
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO identity.webauthn_challenges (
         id, user_id, factor_id, session_id, purpose, challenge_hash,
         rp_id, expected_origin, issued_at, expires_at, correlation_id
       )
       SELECT $1, u.id, $3::uuid, $4::uuid, $5, $6, $7, $8,
              clock_timestamp(), $9::timestamptz, $10::uuid
         FROM identity.users AS u
        WHERE u.id = $2 AND u.status = 'ACTIVE'
          AND ($3::uuid IS NULL OR EXISTS (
            SELECT 1 FROM identity.mfa_factors AS f
             WHERE f.id = $3 AND f.user_id = u.id AND f.status <> 'REVOKED'
          ))
          AND ($4::uuid IS NULL OR EXISTS (
            SELECT 1 FROM identity.sessions AS s
             WHERE s.id = $4 AND s.user_id = u.id
               AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
          ))
       RETURNING id::text`,
      [challengeId, userId, factorId, sessionId, input.purpose, digest,
       input.rpId, input.expectedOrigin, expiresAt, correlationId],
    );
    if (inserted.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_IDENTITY_SCOPE_INVALID");
    return { challengeId, challenge };
  }

  /**
   * Row-locks the challenge, invokes the caller's cryptographic proof checker
   * using the server-stored RP/origin, then irreversibly consumes it in the
   * same transaction. Returning false or throwing rolls everything back.
   * Does not itself assert user presence, UV, counter or credential validity.
   */
  async consumeAfterVerifiedProof(
    input: VerifyPlatformWebAuthnChallenge,
    verify: (challenge: LockedPlatformWebAuthnChallenge) => Promise<boolean>,
  ): Promise<boolean> {
    const userId = UuidSchema.parse(input.userId);
    const sessionId = input.sessionId === null ? null : UuidSchema.parse(input.sessionId);
    if (!["ENROLL", "AUTHENTICATE", "REAUTHENTICATE", "RECOVERY_APPROVAL"].includes(input.purpose)) {
      throw new Error("PLATFORM_WEBAUTHN_PURPOSE_UNSUPPORTED");
    }
    if (typeof input.challenge !== "string") return false;
    const raw = Buffer.from(input.challenge, "base64url");
    if (raw.length !== 32 || raw.toString("base64url") !== input.challenge) return false;
    if ((input.purpose === "REAUTHENTICATE" || input.purpose === "RECOVERY_APPROVAL") &&
      sessionId === null) return false;
    const digest = createHash("sha256").update(input.challenge, "utf8").digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string; user_id: string; factor_id: string | null;
        session_id: string | null; purpose: PlatformWebAuthnChallengePurpose;
        rp_id: string; expected_origin: string;
      }>(
        `SELECT id::text, user_id::text, factor_id::text, session_id::text,
                purpose, rp_id, expected_origin
           FROM identity.webauthn_challenges
          WHERE challenge_hash = $1 AND user_id = $2 AND purpose = $3
            AND session_id IS NOT DISTINCT FROM $4::uuid
            AND consumed_at IS NULL AND expires_at > clock_timestamp()
          FOR UPDATE`,
        [digest, userId, input.purpose, sessionId],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      const verified = await verify({
        challenge: input.challenge, userId: row.user_id,
        factorId: row.factor_id, sessionId: row.session_id,
        purpose: row.purpose, rpId: row.rp_id, expectedOrigin: row.expected_origin,
      });
      if (verified !== true) {
        await client.query("ROLLBACK");
        return false;
      }
      const updated = await client.query<{ id: string }>(
        `UPDATE identity.webauthn_challenges
            SET consumed_at = clock_timestamp(), version = version + 1
          WHERE id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING id::text`,
        [row.id],
      );
      if (updated.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_CONSUMPTION_RACE");
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
