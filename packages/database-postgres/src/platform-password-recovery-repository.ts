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

}
