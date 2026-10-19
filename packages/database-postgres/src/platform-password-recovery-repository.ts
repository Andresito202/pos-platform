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
}
