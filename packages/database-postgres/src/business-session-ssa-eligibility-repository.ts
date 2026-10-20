import type { Pool } from "pg";
import { UuidSchema } from "@pos-platform/contracts";

/**
 * INTERNAL READ-ONLY ELIGIBILITY, NOT AUTHENTICATION.
 * All input IDs MUST come from a trusted, separately verified user-session
 * resolver and cryptographically verified device possession, never raw client
 * UUIDs. This query cannot prove ownership of either credential.
 *
 * A production issuer also requires atomic durable sequence reservation
 * and revalidation before signing; this query alone does NOT authorize SSA.
 */
export interface BusinessSessionEligibilityInput {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly installationId: string;
}

export interface EligibleBusinessSessionCandidate {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantMembershipId: string;
  readonly companyId: string;
  readonly deviceId: string;
  readonly installationId: string;
  readonly sessionExpiresAt: string;
  readonly deviceCredentialExpiresAt: string;
}

/**
 * Migration 001 deliberately enforces identity.sessions.device_id IS NULL.
 * The verified commercial device belongs instead to migration 004 registry
 * and credential tables. This gate reads all relevant records in one statement;
 * it never changes sessions, permissions, MFA state or schema.
 */
export class PostgresBusinessSessionSsaEligibilityRepository {
  constructor(
    private readonly pool: Pool,
    private readonly maximumReauthenticationAgeMs: number,
  ) {
    if (!Number.isSafeInteger(maximumReauthenticationAgeMs) ||
        maximumReauthenticationAgeMs <= 0) {
      throw new Error("SSA_BUSINESS_REAUTH_POLICY_INVALID");
    }
  }

  async findCandidate(input: BusinessSessionEligibilityInput): Promise<EligibleBusinessSessionCandidate | null> {
    const sessionId = UuidSchema.parse(input.sessionId);
    const deviceId = UuidSchema.parse(input.deviceId);
    const installationId = UuidSchema.parse(input.installationId);
    const result = await this.pool.query<{
      session_id: string;
      user_id: string;
      tenant_id: string;
      tenant_membership_id: string;
      company_id: string;
      device_id: string;
      installation_id: string;
      session_expires_at: Date;
      credential_expires_at: Date;
    }>(
      [
        "SELECT s.id::text AS session_id, s.user_id::text AS user_id,",
        "       s.tenant_id::text AS tenant_id,",
        "       s.tenant_membership_id::text AS tenant_membership_id,",
        "       d.company_id::text AS company_id,",
        "       d.device_id::text AS device_id,",
        "       d.installation_id::text AS installation_id,",
        "       s.expires_at AS session_expires_at,",
        "       dc.expires_at AS credential_expires_at",
        "  FROM identity.sessions AS s",
        "  JOIN identity.users AS u ON u.id = s.user_id AND u.status = 'ACTIVE'",
        "  JOIN tenancy.tenant_memberships AS tm",
        "    ON tm.id = s.tenant_membership_id AND tm.tenant_id = s.tenant_id",
        "   AND tm.user_id = s.user_id AND tm.status = 'ACTIVE'",
        "   AND tm.activated_at IS NOT NULL",
        "  JOIN tenancy.tenants AS t",
        "    ON t.id = s.tenant_id AND t.status = 'ACTIVE'",
        "  JOIN identity.device_registry AS d",
        "    ON d.device_id = $2 AND d.installation_id = $3",
        "   AND d.tenant_id = s.tenant_id AND d.status = 'ACTIVE'",
        "  JOIN organization.companies AS company",
        "    ON company.id = d.company_id AND company.tenant_id = d.tenant_id",
        "   AND company.status = 'ACTIVE'",
        "  JOIN identity.device_credentials AS dc",
        "    ON dc.device_id = d.device_id",
        "   AND dc.installation_id = d.installation_id",
        "   AND dc.tenant_id = d.tenant_id AND dc.company_id = d.company_id",
        "   AND dc.device_key_id = d.device_key_id",
        "   AND dc.trust_key_id = d.trust_key_id",
        "   AND dc.key_purpose = 'DEVICE_TRUST'",
        "   AND dc.status = 'ACTIVE'",
        "   AND dc.issued_at <= clock_timestamp()",
        "   AND dc.expires_at > clock_timestamp()",
        " WHERE s.id = $1 AND s.tenant_id IS NOT NULL",
        "   AND s.tenant_membership_id IS NOT NULL",
        "   AND s.device_id IS NULL",
        "   AND s.revoked_at IS NULL",
        "   AND s.authenticated_at <= clock_timestamp()",
        "   AND s.expires_at > clock_timestamp()",
        "   AND s.mfa_status = 'SATISFIED'",
        "   AND s.last_reauthenticated_at IS NOT NULL",
        "   AND s.last_reauthenticated_at <= clock_timestamp()",
        "   AND s.last_reauthenticated_at >= clock_timestamp() -",
        "       ($4::bigint * interval '1 millisecond')",
        "   AND EXISTS (SELECT 1 FROM identity.mfa_factors AS mf",
        "                WHERE mf.user_id = s.user_id",
        "                  AND mf.status = 'ACTIVE'",
        "                  AND mf.verified_at IS NOT NULL",
        "                  AND mf.revoked_at IS NULL)",
        " ORDER BY dc.generation DESC",
        " LIMIT 1",
      ].join("\n"),
      [sessionId, deviceId, installationId, this.maximumReauthenticationAgeMs],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!(row.session_expires_at instanceof Date) ||
        !Number.isFinite(row.session_expires_at.getTime()) ||
        !(row.credential_expires_at instanceof Date) ||
        !Number.isFinite(row.credential_expires_at.getTime())) {
      throw new Error("SSA_BUSINESS_ELIGIBILITY_INVALID_TIMESTAMP");
    }
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      tenantMembershipId: row.tenant_membership_id,
      companyId: row.company_id,
      deviceId: row.device_id,
      installationId: row.installation_id,
      sessionExpiresAt: row.session_expires_at.toISOString(),
      deviceCredentialExpiresAt: row.credential_expires_at.toISOString(),
    };
  }
}
