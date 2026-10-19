import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PlatformSecurityEventCode, UuidSchema } from "@pos-platform/contracts";
import { PostgresPlatformSecurityEventRepository } from "./platform-security-event-repository.js";
import { PostgresPlatformWebAuthnMaterialRepository, type VerifiedPlatformWebAuthnMaterial } from "./platform-webauthn-material-repository.js";
import type { LockedPlatformWebAuthnChallenge } from "./platform-webauthn-challenge-repository.js";

/** Internal proof record; only the trusted Central Authority WebAuthn verifier may provide it. */
export interface PlatformWebAuthnProofToCommit {
  readonly userVerified: true;
  readonly newCounter: number;
  readonly credentialBackedUp: boolean;
}

export interface CommitPlatformWebAuthnAssertion {
  readonly userId: string;
  readonly factorId: string;
  readonly sessionId: string;
  readonly challenge: string;
  readonly purpose: "REAUTHENTICATE" | "RECOVERY_APPROVAL";
  /** Must come from trusted server configuration, not request JSON. */
  readonly rpId: string;
  readonly expectedOrigin: string;
}

export interface LockedPlatformWebAuthnProofContext {
  readonly challenge: LockedPlatformWebAuthnChallenge;
  readonly material: VerifiedPlatformWebAuthnMaterial;
}

/**
 * Coordinates DB state only; NOT a session, MFA or recovery authority.
 * A successful result means proof, counter, one-use challenge and audit were
 * committed atomically. No caller may translate this alone into privileges.
 */
export class PostgresPlatformWebAuthnAssertionTransaction {
  constructor(private readonly pool: Pool) {}

  async verifyAndCommit(
    input: CommitPlatformWebAuthnAssertion,
    verify: (ctx: LockedPlatformWebAuthnProofContext) => Promise<PlatformWebAuthnProofToCommit | null>,
  ): Promise<boolean> {
    const userId = UuidSchema.parse(input.userId);
    const factorId = UuidSchema.parse(input.factorId);
    const sessionId = UuidSchema.parse(input.sessionId);
    if (input.purpose !== "REAUTHENTICATE" && input.purpose !== "RECOVERY_APPROVAL")
      throw new Error("PLATFORM_WEBAUTHN_COMMIT_PURPOSE_INVALID");
    if (typeof input.challenge !== "string" || typeof input.rpId !== "string" ||
        typeof input.expectedOrigin !== "string") return false;
    const raw = Buffer.from(input.challenge, "base64url");
    if (raw.length !== 32 || raw.toString("base64url") !== input.challenge) return false;
    const digest = createHash("sha256").update(input.challenge, "utf8").digest("hex");
    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query("BEGIN");
      begun = true;
      const found = await client.query<{
        id: string; user_id: string; factor_id: string; session_id: string;
        purpose: "REAUTHENTICATE" | "RECOVERY_APPROVAL";
        rp_id: string; expected_origin: string; correlation_id: string;
      }>(
        `SELECT c.id::text, c.user_id::text, c.factor_id::text, c.session_id::text,
                c.purpose, c.rp_id, c.expected_origin, c.correlation_id::text
           FROM identity.webauthn_challenges AS c
           JOIN identity.sessions AS s
             ON s.id = c.session_id AND s.user_id = c.user_id
            AND s.tenant_id IS NULL AND s.tenant_membership_id IS NULL
            AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
          WHERE c.challenge_hash = $1 AND c.user_id = $2
            AND c.factor_id = $3 AND c.session_id = $4
            AND c.purpose = $5 AND c.consumed_at IS NULL
            AND c.expires_at > clock_timestamp()
            AND c.rp_id = $6 AND c.expected_origin = $7
          FOR UPDATE OF c, s`,
        [digest, userId, factorId, sessionId, input.purpose, input.rpId, input.expectedOrigin],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK"); begun = false;
        return false;
      }
      const material = await new PostgresPlatformWebAuthnMaterialRepository(this.pool)
        .findVerifiedMaterial(userId, factorId, client);
      if (!material) {
        await client.query("ROLLBACK"); begun = false;
        return false;
      }
      const result = await verify({
        challenge: {
          challenge: input.challenge, userId: row.user_id, factorId: row.factor_id,
          sessionId: row.session_id, purpose: row.purpose,
          rpId: row.rp_id, expectedOrigin: row.expected_origin,
        }, material,
      });
      if (result?.userVerified !== true ||
          !Number.isSafeInteger(result.newCounter) ||
          result.newCounter < 0 || result.newCounter > 0xffffffff ||
          typeof result.credentialBackedUp !== "boolean") {
        await client.query("ROLLBACK"); begun = false;
        return false;
      }
      const advanced = await new PostgresPlatformWebAuthnMaterialRepository(this.pool)
        .advanceCounterCas(client, {
          userId, factorId, materialId: material.materialId,
          expectedCounter: material.counter, expectedVersion: material.version,
          newCounter: result.newCounter, backedUp: result.credentialBackedUp,
        });
      if (!advanced) {
        await client.query("ROLLBACK"); begun = false;
        return false;
      }
      const consumed = await client.query<{ id: string }>(
        `UPDATE identity.webauthn_challenges
            SET consumed_at = clock_timestamp(), version = version + 1
          WHERE id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING id::text`, [row.id],
      );
      if (consumed.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_COMMIT_CHALLENGE_RACE");
      const timestamp = await client.query<{ occurred_at: Date }>(
        "SELECT clock_timestamp() AS occurred_at",
      );
      const now = timestamp.rows[0]?.occurred_at;
      if (!(now instanceof Date)) throw new Error("PLATFORM_WEBAUTHN_COMMIT_CLOCK_MISSING");
      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: userId, session_id: sessionId, tenant_id: null,
        event_code: PlatformSecurityEventCode.WEBAUTHN_ASSERTION_VERIFIED,
        result: "SUCCEEDED", reason_code: null, correlation_id: row.correlation_id,
        occurred_at: now.toISOString(),
      }, client);
      await client.query("COMMIT");
      begun = false;
      return true;
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
