import type { PoolClient } from "@pos-platform/database-postgres";

/**
 * QR-001 sensitive destination changes: only a company-scoped GENERAL_ADMIN
 * holding the separately provisioned PAYMENTS_PROVIDER_CONFIGURE grant.
 * Reporting/confirming transfers, OWNER, SUPERVISOR, CASHIER and GLOBAL roles
 * never imply recipient-bank-account administration.
 *
 * Invoke only inside the same SERIALIZABLE write transaction as the mutation,
 * with app.tenant_id/app.company_id and nonzero lock_timeout already set.
 * The trusted SAS lock function locks RBAC source tables; ordinary Central SQL
 * roles lack UPDATE privilege to lock grants directly with FOR SHARE.
 */
export async function assertMerchantAdminDuringWrite(
  client: PoolClient,
  session: {
    readonly sessionId: string;
    readonly userId: string;
    readonly tenantId: string;
    readonly tenantMembershipId: string;
  },
  companyId: string,
): Promise<void> {
  await client.query("SELECT \"authorization\".lock_sas_sources_for_read()");
  const result = await client.query(`SELECT 1
    FROM "authorization".user_role_assignments a
    JOIN "authorization".roles role ON role.id=a.role_id
      AND role.status='ACTIVE' AND role.scope_type='BUSINESS'
      AND role.code='GENERAL_ADMIN'
    JOIN "authorization".role_permission_grants grant_record ON grant_record.role_id=role.id
      AND grant_record.status='ACTIVE' AND grant_record.retired_at IS NULL
      AND grant_record.valid_from<=clock_timestamp()
      AND (grant_record.valid_until IS NULL OR grant_record.valid_until>clock_timestamp())
    JOIN "authorization".permissions permission_record ON permission_record.id=grant_record.permission_id
      AND permission_record.status='ACTIVE' AND permission_record.code='PAYMENTS_PROVIDER_CONFIGURE'
    JOIN tenancy.tenant_memberships m ON m.id=a.tenant_membership_id
      AND m.tenant_id=a.tenant_id AND m.user_id=$2
      AND m.status='ACTIVE' AND m.revoked_at IS NULL AND m.suspended_at IS NULL
    JOIN identity.sessions s ON s.id=$1 AND s.user_id=$2
      AND s.tenant_id=$3 AND s.tenant_membership_id=$4
      AND s.mfa_status='SATISFIED' AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp()
      AND s.last_reauthenticated_at>clock_timestamp()-interval '10 minutes'
    JOIN organization.companies c ON c.id=a.company_id
      AND c.tenant_id=a.tenant_id AND c.status='ACTIVE'
    WHERE a.tenant_id=$3 AND a.tenant_membership_id=$4
      AND a.company_id=$5 AND a.branch_id IS NULL
      AND a.status='ACTIVE' AND a.revoked_at IS NULL
      AND a.valid_from<=clock_timestamp()
      AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
    LIMIT 1 FOR SHARE OF a,m,s`,
    [session.sessionId,session.userId,session.tenantId,session.tenantMembershipId,companyId]);
  if(result.rowCount!==1) throw new Error("QR001_ADMIN_WRITE_REVOKED");
}
