import type { Pool } from "pg";
import { PermissionCodeSchema, UuidSchema } from "@pos-platform/contracts";

/** A live, global MFA session candidate. This alone does not prove platform authority. */
export type GlobalMfaSessionCandidate = {
  session_id: string;
  user_id: string;
  mfa_status: "SATISFIED";
  last_reauthenticated_at: string;
  expires_at: string;
};

/** A live global MFA session whose user also has an effective PLATFORM role assignment. */
export type ActivePlatformAdministrationSessionCandidate = GlobalMfaSessionCandidate;

export type ActivePlatformPermissionSessionCandidate = ActivePlatformAdministrationSessionCandidate & {
  permission_code: string;
};

export class PostgresPlatformAdministrationSessionRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Identity/session check only. Deliberately does not assert platform authority.
   * Retained for callers that need to distinguish authentication from authorization.
   */
  async findActiveGlobalMfaSession(
    sessionId: string,
    maxReauthenticationAgeMs: number,
    now = new Date(),
  ): Promise<GlobalMfaSessionCandidate | null> {
    return this.findActiveSession(sessionId, maxReauthenticationAgeMs, now, false);
  }

  /**
   * Resolves the session-to-platform-authority boundary using the existing
   * platform_role_assignments and roles tables. This still does not authorize
   * any particular D-1 operation; that requires resolving its permission.
   */
  async findActivePlatformAdministrationSession(
    sessionId: string,
    maxReauthenticationAgeMs: number,
    now = new Date(),
  ): Promise<ActivePlatformAdministrationSessionCandidate | null> {
    return this.findActiveSession(sessionId, maxReauthenticationAgeMs, now, true);
  }

  /**
   * Resolves one permission against the current global session, effective platform role,
   * active role-permission grant, and active permission catalog entry.
   */
  async findActivePlatformPermissionForSession(
    sessionId: string,
    permissionCode: string,
    maxReauthenticationAgeMs: number,
    now = new Date(),
  ): Promise<ActivePlatformPermissionSessionCandidate | null> {
    const validSessionId = UuidSchema.parse(sessionId);
    const validPermissionCode = PermissionCodeSchema.parse(permissionCode);
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
      permission_code: string;
    }>(
      `SELECT s.id::text AS session_id, s.user_id::text AS user_id, s.mfa_status,
              s.last_reauthenticated_at, s.expires_at, p.code AS permission_code
         FROM identity.sessions AS s
         JOIN identity.users AS u ON u.id = s.user_id AND u.status = 'ACTIVE'
         JOIN "authorization".platform_role_assignments AS pra
           ON pra.user_id = s.user_id AND pra.role_scope_type = 'PLATFORM'
          AND pra.status = 'ACTIVE' AND pra.valid_from <= clock_timestamp()
          AND (pra.valid_until IS NULL OR pra.valid_until > clock_timestamp())
         JOIN "authorization".roles AS r
           ON r.id = pra.role_id AND r.scope_type = 'PLATFORM' AND r.status = 'ACTIVE'
         JOIN "authorization".role_permission_grants AS g
           ON g.role_id = r.id AND g.status = 'ACTIVE'
          AND g.valid_from <= clock_timestamp()
          AND (g.valid_until IS NULL OR g.valid_until > clock_timestamp())
         JOIN "authorization".permissions AS p
           ON p.id = g.permission_id AND p.status = 'ACTIVE' AND p.code = $2
        WHERE s.id = $1 AND s.tenant_id IS NULL AND s.tenant_membership_id IS NULL
          AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
          AND s.mfa_status = 'SATISFIED' AND s.last_reauthenticated_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM identity.mfa_factors AS mf
            WHERE mf.user_id = s.user_id AND mf.status = 'ACTIVE'
              AND mf.verified_at IS NOT NULL AND mf.revoked_at IS NULL)
        LIMIT 1`,
      [validSessionId, validPermissionCode],
    );

    const row = result.rows[0];
    if (!row) return null;
    const reauthenticatedAtMs = row.last_reauthenticated_at.getTime();
    const expiresAtMs = row.expires_at.getTime();
    if (!Number.isFinite(reauthenticatedAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= nowMs || reauthenticatedAtMs > nowMs
      || nowMs - reauthenticatedAtMs > maxReauthenticationAgeMs) return null;

    return {
      session_id: row.session_id, user_id: row.user_id, mfa_status: row.mfa_status,
      last_reauthenticated_at: row.last_reauthenticated_at.toISOString(),
      expires_at: row.expires_at.toISOString(), permission_code: row.permission_code,
    };
  }

  private async findActiveSession(
    sessionId: string,
    maxReauthenticationAgeMs: number,
    now: Date,
    requirePlatformRole: boolean,
  ): Promise<GlobalMfaSessionCandidate | null> {
    const validSessionId = UuidSchema.parse(sessionId);
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error("PLATFORM_ADMINISTRATION_INVALID_CLOCK");
    if (!Number.isSafeInteger(maxReauthenticationAgeMs) || maxReauthenticationAgeMs <= 0) {
      throw new Error("PLATFORM_ADMINISTRATION_INVALID_REAUTHENTICATION_POLICY");
    }

    const platformRolePredicate = requirePlatformRole
      ? `AND EXISTS (
            SELECT 1
              FROM "authorization".platform_role_assignments AS pra
              JOIN "authorization".roles AS pr
                ON pr.id = pra.role_id
               AND pr.scope_type = 'PLATFORM'
               AND pr.status = 'ACTIVE'
             WHERE pra.user_id = s.user_id
               AND pra.role_scope_type = 'PLATFORM'
               AND pra.status = 'ACTIVE'
               AND pra.valid_from <= clock_timestamp()
               AND (pra.valid_until IS NULL OR pra.valid_until > clock_timestamp())
          )`
      : "";

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
          ${platformRolePredicate}
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
