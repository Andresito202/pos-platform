import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { Sha256HexSchema, UtcDateTimeSchema, UuidSchema, UuidV7Schema, uuidV7 } from "@pos-platform/contracts";
import { PlatformSecurityEventCode, isSupportedPlatformPasswordVerifier } from "@pos-platform/contracts";
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

/**
 * Internal approval request. This is NOT proof that WebAuthn has run.
 * The caller must authenticate the session with the future trusted MFA flow;
 * no HTTP/renderer route may accept session IDs as proof of identity.
 *
 * PLATFORM_RECOVERY_APPROVE is a dedicated unprovisioned platform permission:
 * absent an explicit D-1 grant the SQL query fails closed.
 */
export interface ApproveAssistedPlatformRecovery {
  readonly requestId: string;
  readonly approverSessionId: string;
  readonly maxReauthenticationAgeMs: number;
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
   * R5 authority gate: unlike a raw support_verified write, this verifies a
   * distinct active platform actor, authenticated GLOBAL session, MFA factor,
   * recent reauthentication, and an explicit recovery-approval permission.
   * Approval flag + append-only provenance are committed atomically.
   *
   * Fail closed until the future trusted WebAuthn service issues these sessions
   * and an authorized D-1 process provisions the permission. No public route.
   */
  async approveAssistedRecovery(input: ApproveAssistedPlatformRecovery): Promise<{ approverUserId: string }> {
    const requestId = UuidV7Schema.parse(input.requestId);
    const approverSessionId = UuidSchema.parse(input.approverSessionId);
    if (!Number.isSafeInteger(input.maxReauthenticationAgeMs) || input.maxReauthenticationAgeMs <= 0) {
      throw new Error("PLATFORM_RECOVERY_REAUTHENTICATION_POLICY_INVALID");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const requests = await client.query<{ user_id: string; correlation_id: string }>(
        `SELECT user_id::text, correlation_id::text
           FROM identity.password_recovery_requests
          WHERE id = $1 AND status = 'VERIFIED'
            AND support_verified = false AND expires_at > clock_timestamp()
          FOR UPDATE`, [requestId],
      );
      const recovery = requests.rows[0];
      if (!recovery) throw new Error("PLATFORM_RECOVERY_APPROVAL_REQUEST_INELIGIBLE");

      const sessions = await client.query<{ approver_user_id: string }>(
        `SELECT s.user_id::text AS approver_user_id
           FROM identity.sessions AS s
           JOIN identity.users AS approver ON approver.id = s.user_id AND approver.status = 'ACTIVE'
           JOIN "authorization".platform_role_assignments AS assignment
             ON assignment.user_id = s.user_id AND assignment.role_scope_type = 'PLATFORM'
            AND assignment.status = 'ACTIVE' AND assignment.valid_from <= clock_timestamp()
            AND (assignment.valid_until IS NULL OR assignment.valid_until > clock_timestamp())
           JOIN "authorization".roles AS role
             ON role.id = assignment.role_id AND role.scope_type = 'PLATFORM' AND role.status = 'ACTIVE'
           JOIN "authorization".role_permission_grants AS grant_entry
             ON grant_entry.role_id = role.id AND grant_entry.status = 'ACTIVE'
            AND grant_entry.valid_from <= clock_timestamp()
            AND (grant_entry.valid_until IS NULL OR grant_entry.valid_until > clock_timestamp())
           JOIN "authorization".permissions AS permission
             ON permission.id = grant_entry.permission_id
            AND permission.status = 'ACTIVE' AND permission.code = 'PLATFORM_RECOVERY_APPROVE'
          WHERE s.id = $1 AND s.user_id <> $2
            AND s.tenant_id IS NULL AND s.tenant_membership_id IS NULL
            AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
            AND s.mfa_status = 'SATISFIED'
            AND s.last_reauthenticated_at IS NOT NULL
            AND s.last_reauthenticated_at <= clock_timestamp()
            AND s.last_reauthenticated_at >= clock_timestamp() - ($3::bigint * INTERVAL '1 millisecond')
            AND EXISTS (
              SELECT 1 FROM identity.mfa_factors AS factor
               WHERE factor.user_id = s.user_id AND factor.status = 'ACTIVE'
                 AND factor.verified_at IS NOT NULL AND factor.revoked_at IS NULL
            )
          FOR UPDATE OF s`,
        [approverSessionId, recovery.user_id, input.maxReauthenticationAgeMs],
      );
      const authority = sessions.rows[0];
      if (!authority) throw new Error("PLATFORM_RECOVERY_APPROVER_NOT_AUTHORIZED");

      const updated = await client.query<{ approved_at: Date }>(
        `UPDATE identity.password_recovery_requests
            SET support_verified = true, version = version + 1
          WHERE id = $1 AND status = 'VERIFIED'
            AND support_verified = false AND expires_at > clock_timestamp()
          RETURNING clock_timestamp() AS approved_at`,
        [requestId],
      );
      const approved = updated.rows[0];
      if (!approved) throw new Error("PLATFORM_RECOVERY_APPROVAL_CONCURRENT_TRANSITION");

      await new PostgresPlatformSecurityEventRepository(this.pool).append({
        user_id: recovery.user_id,
        session_id: approverSessionId,
        tenant_id: null,
        event_code: PlatformSecurityEventCode.RECOVERY_APPROVED,
        result: "SUCCEEDED",
        reason_code: null,
        correlation_id: recovery.correlation_id,
        occurred_at: approved.approved_at.toISOString(),
      }, client);

      await client.query("COMMIT");
      return { approverUserId: authority.approver_user_id };
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
    if (!isSupportedPlatformPasswordVerifier(input.newVerifier)) {
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
