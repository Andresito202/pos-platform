import type { Pool } from "pg";
import { UuidSchema } from "@pos-platform/contracts";

/**
 * A live, global MFA session candidate read from the existing identity store.
 *
 * This is deliberately NOT a PlatformAdministrationSession and does not prove
 * that the user is entitled to act as PLATFORM_ACCOUNT. The current schema has
 * no platform-account assignment/eligibility relation; callers must not promote
 * this candidate to platform authority until that authorization source exists.
 */
export type GlobalMfaSessionCandidate = {
  session_id: string;
  user_id: string;
  mfa_status: "SATISFIED";
  last_reauthenticated_at: string;
  expires_at: string;
};

export class PostgresPlatformAdministrationSessionRepository {
  constructor(private readonly pool: Pool) {}

  async findActiveGlobalMfaSession(
    sessionId: string,
    maxReauthenticationAgeMs: number,
    now = new Date(),
  ): Promise<GlobalMfaSessionCandidate | null> {
    const validSessionId = UuidSchema.parse(sessionId);
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error("PLATFORM_ADMINISTRATION_INVALID_CLOCK");
    if (!Number.isSafeInteger(maxReauthenticationAgeMs) || maxReauthenticationAgeMs <= 0) {
      throw new Error("PLATFORM_ADMINISTRATION_INVALID_REAUTHENTICATION_POLICY");
    }

    const result = await this.pool.query<{
      session_id: string;
      user_id: string;
      mfa_status: "SATISFIED";
      last_reauthenticated_at: Date;
      expires_at: Date;
    }>(
      `SELECT s.id::text AS session_id,
              s.user_id::text AS user_id,
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

    const reauthenticatedAtMs = row.last_reauthenticated_at.getTime();
    const expiresAtMs = row.expires_at.getTime();
    if (!Number.isFinite(reauthenticatedAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= nowMs || reauthenticatedAtMs > nowMs
      || nowMs - reauthenticatedAtMs > maxReauthenticationAgeMs) return null;

    return {
      session_id: row.session_id,
      user_id: row.user_id,
      mfa_status: row.mfa_status,
      last_reauthenticated_at: row.last_reauthenticated_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
    };
  }
}
