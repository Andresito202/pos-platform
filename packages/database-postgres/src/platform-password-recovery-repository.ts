import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { Sha256HexSchema, UtcDateTimeSchema, UuidSchema, UuidV7Schema, uuidV7 } from "@pos-platform/contracts";
import { PlatformSecurityEventCode } from "@pos-platform/contracts";
import { PostgresPlatformSecurityEventRepository } from "./platform-security-event-repository.js";

/**
 * Persistence only: the trusted central service must resolve account eligibility,
 * generate a high-entropy token, hash it and determine expiry/attempt policy.
 * This class neither sends email nor verifies or consumes reset tokens.
 */
export interface CreatePlatformPasswordRecoveryRequest {
  readonly userId: string;
  readonly tokenHash: string;
  readonly correlationId: string;
  readonly expiresAt: string;
  readonly maxAttempts: number;
}


export interface VerifyPlatformPasswordRecoveryToken {
  readonly requestId: string;
  /** SHA-256 of the high-entropy token presented to the trusted central service. */
  readonly tokenHash: string;
}

/**
 * Assisted recovery only. The flag support_verified must already have been
 * set by a separate, privileged identity-proof workflow. This is NOT a public
 * endpoint and must not be called merely because an email link was opened.
 */
export interface CompleteAssistedPlatformRecovery {
  readonly requestId: string;
  readonly tokenHash: string;
  /** Versioned Argon2id PHC verifier; never a plaintext password. */
  readonly newVerifier: string;
}

export class PostgresPlatformPasswordRecoveryRepository {
  constructor(private readonly pool: Pool) {}

  /** One transaction: recovery request and append-only security event, or neither. */
  async createRequest(input: CreatePlatformPasswordRecoveryRequest): Promise<{ requestId: string }> {
    const userId = UuidSchema.parse(input.userId);
    const tokenHash = Sha256HexSchema.parse(input.tokenHash);
    const correlationId = UuidV7Schema.parse(input.correlationId);
    const expiresAt = UtcDateTimeSchema.parse(input.expiresAt);
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 20) {
      throw new Error("PLATFORM_RECOVERY_INVALID_ATTEMPT_POLICY");
    }

    const requestId = uuidV7();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; requested_at: Date }>(
        `INSERT INTO identity.password_recovery_requests (
          id, user_id, token_hash, channel, status, requested_by_actor_type,
          requested_by_actor_id, support_verified, attempt_count, max_attempts,
          requested_at, expires_at, correlation_id, version
        ) VALUES (
          $1, $2, $3, 'EMAIL', 'REQUESTED', 'SYSTEM',
          NULL, false, 0, $4, clock_timestamp(), $5::timestamptz, $6, 1
        ) RETURNING id::text, requested_at`,
        [requestId, userId, tokenHash, input.maxAttempts, expiresAt, correlationId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PLATFORM_RECOVERY_INSERT_RETURNED_NO_ROW");

      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: userId,
        session_id: null,
        tenant_id: null,
        event_code: PlatformSecurityEventCode.RECOVERY_REQUESTED,
        result: "SUCCEEDED",
        reason_code: null,
        correlation_id: correlationId,
        occurred_at: row.requested_at.toISOString(),
      }, client);

      await client.query("COMMIT");
      return { requestId: row.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  /**
   * Verify a token digest once; this is NOT authority to change credentials.
   * PostgreSQL serializes competing attempts with FOR UPDATE. All rejected
   * active attempts are recorded in identity.security_events in the same tx.
   * No raw token, password or refresh credential enters this persistence API.
   */
  async verifyRequestToken(input: VerifyPlatformPasswordRecoveryToken): Promise<boolean> {
    const requestId = UuidV7Schema.parse(input.requestId);
    const tokenHash = Sha256HexSchema.parse(input.tokenHash);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        user_id: string;
        token_hash: string;
        status: string;
        attempt_count: number;
        max_attempts: number;
        correlation_id: string;
        is_expired: boolean;
      }>(
        `SELECT user_id::text, token_hash, status, attempt_count, max_attempts,
                correlation_id::text, expires_at <= clock_timestamp() AS is_expired
           FROM identity.password_recovery_requests
          WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const row = found.rows[0];
      let verified = false;

      // All non-active states (including VERIFIED) and unknown IDs reject alike.
      if (row?.status === "REQUESTED") {
        if (!/^[a-f0-9]{64}$/.test(row.token_hash)) {
          throw new Error("PLATFORM_RECOVERY_STORED_HASH_INVALID");
        }
        const hashMatches = timingSafeEqual(
          Buffer.from(row.token_hash, "hex"), Buffer.from(tokenHash, "hex"),
        );
        const reason = row.is_expired ? "TOKEN_EXPIRED"
          : row.attempt_count >= row.max_attempts ? "ATTEMPT_LIMIT_REACHED"
          : hashMatches ? null : "TOKEN_INVALID";

        const updated = await client.query<{ event_at: Date }>(
          reason === null
            ? `UPDATE identity.password_recovery_requests
                  SET status = 'VERIFIED', verified_at = clock_timestamp(), version = version + 1
                WHERE id = $1 AND status = 'REQUESTED'
                RETURNING clock_timestamp() AS event_at`
            : row.is_expired
              ? `UPDATE identity.password_recovery_requests
                    SET status = 'EXPIRED', version = version + 1
                  WHERE id = $1 AND status = 'REQUESTED'
                  RETURNING clock_timestamp() AS event_at`
              : `UPDATE identity.password_recovery_requests
                    SET attempt_count = attempt_count + 1,
                        status = CASE WHEN attempt_count + 1 >= max_attempts
                                      THEN 'LOCKED' ELSE 'REQUESTED' END,
                        version = version + 1
                  WHERE id = $1 AND status = 'REQUESTED'
                  RETURNING clock_timestamp() AS event_at`,
          [requestId],
        );
        const transition = updated.rows[0];
        if (!transition) throw new Error("PLATFORM_RECOVERY_CONCURRENT_TRANSITION_REJECTED");
        verified = reason === null;

        if (reason !== null) {
          await new PostgresPlatformSecurityEventRepository(this.pool).append({
            user_id: row.user_id,
            session_id: null,
            tenant_id: null,
            event_code: PlatformSecurityEventCode.RECOVERY_REJECTED,
            result: "REJECTED",
            reason_code: reason,
            correlation_id: row.correlation_id,
            occurred_at: transition.event_at.toISOString(),
          }, client);
        }
      }

      await client.query("COMMIT");
      return verified;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * One transaction: consume one approved, still-valid recovery request,
   * retire the old PASSWORD credential, insert its replacement, revoke every
   * session and refresh token for this identity, and append security audit.
   *
   * No authentication or identity proof is performed here. The trusted caller
   * MUST independently authorize the approval before support_verified can be
   * set; this API is deliberately not wired to HTTP or renderer controls.
   */
  async completeAssistedRecovery(input: CompleteAssistedPlatformRecovery): Promise<{ credentialId: string }> {
    const requestId = UuidV7Schema.parse(input.requestId);
    const tokenHash = Sha256HexSchema.parse(input.tokenHash);
    if (typeof input.newVerifier !== "string" ||
      !/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(input.newVerifier) ||
      input.newVerifier.length > 256) {
      throw new Error("PLATFORM_RECOVERY_VERIFIER_FORMAT_INVALID");
    }
    const credentialId = uuidV7();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        user_id: string; token_hash: string; correlation_id: string;
        support_verified: boolean; is_expired: boolean;
      }>(
        `SELECT user_id::text, token_hash, correlation_id::text, support_verified,
                expires_at <= clock_timestamp() AS is_expired
           FROM identity.password_recovery_requests
          WHERE id = $1 AND status = 'VERIFIED' FOR UPDATE`, [requestId],
      );
      const recovery = result.rows[0];
      if (!recovery || !recovery.support_verified || recovery.is_expired ||
          !/^[a-f0-9]{64}$/.test(recovery.token_hash) ||
          !timingSafeEqual(Buffer.from(recovery.token_hash, "hex"), Buffer.from(tokenHash, "hex"))) {
        throw new Error("PLATFORM_RECOVERY_COMPLETION_NOT_AUTHORIZED");
      }

      const user = await client.query<{ id: string }>(
        `SELECT id::text FROM identity.users WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE`,
        [recovery.user_id],
      );
      if (user.rows.length !== 1) throw new Error("PLATFORM_RECOVERY_USER_INACTIVE");

      const retired = await client.query<{ id: string }>(
        `UPDATE identity.user_credentials
            SET status = 'RETIRED', rotated_at = clock_timestamp(), version = version + 1
          WHERE user_id = $1 AND credential_type = 'PASSWORD' AND status = 'ACTIVE'
          RETURNING id::text`, [recovery.user_id],
      );
      // Recovery cannot turn an unprovisioned identity into a password user.
      if (retired.rows.length !== 1) throw new Error("PLATFORM_RECOVERY_ACTIVE_CREDENTIAL_REQUIRED");

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO identity.user_credentials (
          id, user_id, credential_type, verifier, status, failed_attempt_count,
          created_at, version
        ) VALUES ($1, $2, 'PASSWORD', $3, 'ACTIVE', 0, clock_timestamp(), 1)
        RETURNING id::text`, [credentialId, recovery.user_id, input.newVerifier],
      );
      if (inserted.rows.length !== 1) throw new Error("PLATFORM_RECOVERY_CREDENTIAL_INSERT_FAILED");

      // Revoke refresh tokens for ALL sessions of the identity, including
      // already-consumed family members, before revoking the sessions.
      await client.query(
        `UPDATE identity.session_refresh_tokens
            SET revoked_at = clock_timestamp(), revocation_reason = 'PASSWORD_RECOVERY'
          WHERE revoked_at IS NULL AND session_id IN
                (SELECT id FROM identity.sessions WHERE user_id = $1)`,
        [recovery.user_id],
      );
      await client.query(
        `UPDATE identity.sessions
            SET revoked_at = clock_timestamp(), revoked_by_actor_type = 'SYSTEM',
                revoked_by_actor_id = NULL, revocation_reason = 'PASSWORD_RECOVERY',
                version = version + 1
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [recovery.user_id],
      );

      const consumed = await client.query<{ consumed_at: Date }>(
        `UPDATE identity.password_recovery_requests
            SET status = 'CONSUMED', consumed_at = clock_timestamp(), version = version + 1
          WHERE id = $1 AND status = 'VERIFIED'
          RETURNING consumed_at`, [requestId],
      );
      const transition = consumed.rows[0];
      if (!transition) throw new Error("PLATFORM_RECOVERY_CONSUMPTION_FAILED");

      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: recovery.user_id,
        session_id: null,
        tenant_id: null,
        event_code: PlatformSecurityEventCode.RECOVERY_COMPLETED,
        result: "SUCCEEDED",
        reason_code: null,
        correlation_id: recovery.correlation_id,
        occurred_at: transition.consumed_at.toISOString(),
      }, client);

      await client.query("COMMIT");
      return { credentialId: inserted.rows[0]!.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

}
