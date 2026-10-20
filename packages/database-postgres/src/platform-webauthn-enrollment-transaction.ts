import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PlatformSecurityEventCode, UuidSchema, uuidV7 } from "@pos-platform/contracts";
import { PostgresPlatformSecurityEventRepository } from "./platform-security-event-repository.js";
import type { LockedPlatformWebAuthnChallenge } from "./platform-webauthn-challenge-repository.js";

/**
 * A trusted authentication service must resolve a proof of control of a
 * server-issued session. A request-supplied UUID or a database row alone is
 * NOT authentication. There is intentionally no production resolver or HTTP
 * endpoint in this increment.
 */
export interface PlatformWebAuthnEnrollmentSession {
  readonly userId: string;
  readonly sessionId: string;
}
export type ResolveAuthenticatedPlatformEnrollmentSession = (
  authorizationProof: string,
) => Promise<PlatformWebAuthnEnrollmentSession | null>;

export interface PlatformWebAuthnEnrollmentMaterial {
  readonly credentialId: string;
  readonly publicKeyCoseBase64url: string;
  readonly counter: number;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly userVerified: true;
}

export interface EnrollPlatformWebAuthnCredential {
  /** Opaque proof validated by the trusted session resolver, never a session UUID. */
  readonly authorizationProof: string;
  readonly challenge: string;
  /** The service supplies RP ID and origin from trusted configuration. */
  readonly rpId: string;
  readonly expectedOrigin: string;
}
export interface EnrolledPlatformWebAuthnFactor {
  readonly userId: string;
  readonly factorId: string;
  readonly materialId: string;
}

/**
 * INTERNAL persistence coordinator only, not an authenticator or a session
 * issuer. A central caller must inject a genuine, user-bound, revocable
 * session-proof resolver and the actual WebAuthn registration verifier.
 *
 * The coordinator locks existing session, challenge and account rows; writes
 * the PENDING -> ACTIVE factor, its public credential material, challenge
 * consumption and security event in one PostgreSQL transaction. Failure
 * rolls every write back. No new identity, session or MFA schema is created.
 */
export class PostgresPlatformWebAuthnEnrollmentTransaction {
  constructor(
    private readonly pool: Pool,
    private readonly resolveAuthenticatedSession: ResolveAuthenticatedPlatformEnrollmentSession,
    private readonly maxReauthenticationAgeMs: number,
  ) {
    if (!Number.isSafeInteger(maxReauthenticationAgeMs) || maxReauthenticationAgeMs <= 0) {
      throw new Error("PLATFORM_WEBAUTHN_ENROLL_REAUTH_POLICY_INVALID");
    }
  }

  async verifyAndEnroll(
    input: EnrollPlatformWebAuthnCredential,
    verify: (challenge: LockedPlatformWebAuthnChallenge) => Promise<PlatformWebAuthnEnrollmentMaterial | null>,
  ): Promise<EnrolledPlatformWebAuthnFactor | null> {
    if (typeof input.authorizationProof !== "string" || !input.authorizationProof ||
        typeof input.challenge !== "string" ||
        typeof input.rpId !== "string" || !input.rpId ||
        typeof input.expectedOrigin !== "string" || !input.expectedOrigin) return null;
    const challengeBytes = Buffer.from(input.challenge, "base64url");
    if (challengeBytes.length !== 32 ||
        challengeBytes.toString("base64url") !== input.challenge) return null;

    // Deliberately outside SQL: PostgreSQL cannot authenticate bearer control.
    const authenticated = await this.resolveAuthenticatedSession(input.authorizationProof);
    if (!authenticated) return null;
    const userId = UuidSchema.parse(authenticated.userId);
    const sessionId = UuidSchema.parse(authenticated.sessionId);
    const digest = createHash("sha256").update(input.challenge, "utf8").digest("hex");
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query("BEGIN");
      started = true;
      const found = await client.query<{
        id: string;
        user_id: string;
        session_id: string;
        rp_id: string;
        expected_origin: string;
        correlation_id: string;
      }>(
        `SELECT c.id::text, c.user_id::text, c.session_id::text, c.rp_id,
                c.expected_origin, c.correlation_id::text
           FROM identity.webauthn_challenges AS c
           JOIN identity.sessions AS s
             ON s.id = c.session_id AND s.user_id = c.user_id
           JOIN identity.users AS u ON u.id = c.user_id AND u.status = 'ACTIVE'
          WHERE c.challenge_hash = $1 AND c.user_id = $2
            AND c.session_id = $3 AND c.purpose = 'ENROLL'
            AND c.factor_id IS NULL AND c.consumed_at IS NULL
            AND c.expires_at > clock_timestamp()
            AND c.rp_id = $4 AND c.expected_origin = $5
            AND s.tenant_id IS NULL AND s.tenant_membership_id IS NULL
            AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
            AND s.authenticated_at <= clock_timestamp()
            AND s.last_reauthenticated_at IS NOT NULL
            AND s.last_reauthenticated_at <= clock_timestamp()
            AND s.last_reauthenticated_at >= clock_timestamp() - ($6::bigint * interval '1 millisecond')
            AND EXISTS (
              SELECT 1 FROM "authorization".platform_role_assignments AS pra
              JOIN "authorization".roles AS r
                ON r.id = pra.role_id AND r.scope_type = 'PLATFORM' AND r.status = 'ACTIVE'
             WHERE pra.user_id = u.id AND pra.role_scope_type = 'PLATFORM'
               AND pra.status = 'ACTIVE' AND pra.valid_from <= clock_timestamp()
               AND (pra.valid_until IS NULL OR pra.valid_until > clock_timestamp())
            )
          FOR UPDATE OF c, s, u`,
        [digest, userId, sessionId, input.rpId, input.expectedOrigin, this.maxReauthenticationAgeMs],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK"); started = false;
        return null;
      }

      const material = await verify({
        challenge: input.challenge, userId: row.user_id, factorId: null,
        sessionId: row.session_id, purpose: "ENROLL",
        rpId: row.rp_id, expectedOrigin: row.expected_origin,
      });
      if (!material || !validMaterial(material)) {
        await client.query("ROLLBACK"); started = false;
        return null;
      }

      const factorId = uuidV7();
      const materialId = uuidV7();
      const insertedFactor = await client.query<{ id: string }>(
        `INSERT INTO identity.mfa_factors
           (id, user_id, factor_type, secret_reference, status, enrolled_at, version)
         VALUES ($1, $2, 'WEBAUTHN', $3, 'PENDING', clock_timestamp(), 1)
         RETURNING id::text`,
        [factorId, userId, "webauthn:v1:" + materialId],
      );
      if (insertedFactor.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_ENROLL_FACTOR_INSERT_FAILED");

      const insertedMaterial = await client.query<{ id: string }>(
        `INSERT INTO identity.webauthn_credential_material
           (id, factor_id, credential_id, public_key_cose_base64url,
            counter, backup_eligible, backed_up, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
         RETURNING id::text`,
        [materialId, factorId, material.credentialId, material.publicKeyCoseBase64url,
         material.counter, material.backupEligible, material.backedUp],
      );
      if (insertedMaterial.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_ENROLL_MATERIAL_INSERT_FAILED");

      const activated = await client.query<{ id: string }>(
        `UPDATE identity.mfa_factors
            SET status = 'ACTIVE', verified_at = clock_timestamp(), version = version + 1
          WHERE id = $1 AND user_id = $2 AND factor_type = 'WEBAUTHN'
            AND status = 'PENDING' AND verified_at IS NULL AND revoked_at IS NULL
          RETURNING id::text`,
        [factorId, userId],
      );
      if (activated.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_ENROLL_FACTOR_ACTIVATION_FAILED");

      const consumed = await client.query<{ id: string }>(
        `UPDATE identity.webauthn_challenges
            SET consumed_at = clock_timestamp(), version = version + 1
          WHERE id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING id::text`, [row.id],
      );
      if (consumed.rows.length !== 1) throw new Error("PLATFORM_WEBAUTHN_ENROLL_CHALLENGE_RACE");

      const timestamp = await client.query<{ occurred_at: Date }>(
        "SELECT clock_timestamp() AS occurred_at",
      );
      const now = timestamp.rows[0]?.occurred_at;
      if (!(now instanceof Date)) throw new Error("PLATFORM_WEBAUTHN_ENROLL_CLOCK_MISSING");
      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: userId, session_id: sessionId, tenant_id: null,
        event_code: PlatformSecurityEventCode.MFA_ENROLLED,
        result: "SUCCEEDED", reason_code: null,
        correlation_id: row.correlation_id,
        occurred_at: now.toISOString(),
      }, client);
      await client.query("COMMIT");
      started = false;
      return { userId, factorId, materialId };
    } catch (error) {
      if (started) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function validMaterial(material: PlatformWebAuthnEnrollmentMaterial): boolean {
  if (material.userVerified !== true || typeof material.credentialId !== "string" ||
      typeof material.publicKeyCoseBase64url !== "string" ||
      !Number.isSafeInteger(material.counter) || material.counter < 0 ||
      material.counter > 0xffffffff || typeof material.backupEligible !== "boolean" ||
      typeof material.backedUp !== "boolean" ||
      (material.backedUp && !material.backupEligible)) return false;
  const id = Buffer.from(material.credentialId, "base64url");
  const cose = Buffer.from(material.publicKeyCoseBase64url, "base64url");
  return id.length >= 16 && id.length <= 1024 &&
    id.toString("base64url") === material.credentialId &&
    cose.length >= 32 && cose.length <= 2048 &&
    cose.toString("base64url") === material.publicKeyCoseBase64url;
}
