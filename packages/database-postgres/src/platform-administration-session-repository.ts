import type { Pool } from "pg";
import {
  assertPlatformAdministrationSessionUsable,
  UuidSchema,
  type PlatformAdministrationSession,
} from "@pos-platform/contracts";

/**
 * Reads an already-issued central PlatformAccount session.
 *
 * This repository cannot authenticate credentials, satisfy MFA, issue sessions
 * or authorize D-1 operations. It fails closed unless the persisted session and
 * account are still active, global, MFA-satisfied and backed by an active
 * verified MFA factor.
 */
export class PostgresPlatformAdministrationSessionRepository {
  constructor(private readonly pool: Pool) {}

  async findUsableSession(
    sessionId: string,
    maxReauthenticationAgeMs: number,
    now = new Date(),
  ): Promise<PlatformAdministrationSession | null> {
    const validSessionId = UuidSchema.parse(sessionId);
    const result = await this.pool.query<{
      session_id: string;
      platform_account_id: string;
      tenant_id: null;
      tenant_membership_id: null;
      mfa_status: "SATISFIED";
      last_reauthenticated_at: Date;
      expires_at: Date;
    }>(
      `SELECT s.id::text AS session_id,
              s.user_id::text AS platform_account_id,
              NULL::uuid AS tenant_id,
              NULL::uuid AS tenant_membership_id,
              s.mfa_status,
              s.last_reauthenticated_at,
              s.expires_at
         FROM identity.sessions AS s
         JOIN identity.users AS u ON u.id = s.user_id
        WHERE s.id = $1
          AND s.tenant_id IS NULL
          AND s.tenant_membership_id IS NULL
          AND s.revoked_at IS NULL
          AND s.expires_at > clock_timestamp()
          AND s.mfa_status = 'SATISFIED'
          AND s.last_reauthenticated_at IS NOT NULL
          AND u.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
              FROM identity.mfa_factors AS mf
             WHERE mf.user_id = s.user_id
               AND mf.status = 'ACTIVE'
               AND mf.verified_at IS NOT NULL
               AND mf.revoked_at IS NULL
          )
        LIMIT 1`,
      [validSessionId],
    );

    const row = result.rows[0];
    if (!row) return null;

    try {
      return assertPlatformAdministrationSessionUsable({
        session_id: row.session_id,
        platform_account_id: row.platform_account_id,
        actor_type: "PLATFORM_ACCOUNT",
        tenant_id: row.tenant_id,
        tenant_membership_id: row.tenant_membership_id,
        mfa_status: row.mfa_status,
        last_reauthenticated_at: row.last_reauthenticated_at.toISOString(),
        expires_at: row.expires_at.toISOString(),
      }, now, maxReauthenticationAgeMs);
    } catch (error) {
      if (error instanceof Error && [
        "PLATFORM_ADMINISTRATION_SESSION_EXPIRED",
        "PLATFORM_ADMINISTRATION_REAUTHENTICATION_IN_FUTURE",
        "PLATFORM_ADMINISTRATION_REAUTHENTICATION_STALE",
      ].includes(error.message)) return null;
      throw error;
    }
  }
}
