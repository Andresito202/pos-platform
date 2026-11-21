import { UuidSchema } from "@pos-platform/contracts";
import type { PoolClient } from "@pos-platform/database-postgres";

/**
 * Invocar dentro de una transacción PostgreSQL.
 * sessionId debe proceder de una sesión BUSINESS autenticada
 * por el servidor; nunca de un campo declarado por el cliente.
 */
export async function requireCashRegisterBusinessAdministrator(
  client: PoolClient,
  sessionId: string,
  companyId: string,
  branchId: string,
): Promise<{ tenantId: string; userId: string }> {
  UuidSchema.parse(sessionId);
  UuidSchema.parse(companyId);
  UuidSchema.parse(branchId);

  const session = await client.query(
    `SELECT s.tenant_id, s.user_id
       FROM identity.sessions s
       JOIN identity.users u
         ON u.id=s.user_id AND u.status='ACTIVE'
      WHERE s.id=$1
        AND s.tenant_id IS NOT NULL
        AND s.tenant_membership_id IS NOT NULL
        AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp()
        AND s.mfa_status='SATISFIED'
        AND s.last_reauthenticated_at IS NOT NULL
        AND s.last_reauthenticated_at <= clock_timestamp()
        AND s.last_reauthenticated_at >=
            clock_timestamp()-interval '5 minutes'
      FOR SHARE OF s,u`,
    [sessionId],
  );

  const identity = session.rows[0];

  if (!identity) {
    throw Error("CASH_REGISTER_BUSINESS_SESSION_REQUIRED");
  }

  const tenantId = String(identity.tenant_id);
  const userId = String(identity.user_id);

  await client.query(
    "SELECT set_config('app.tenant_id',$1,true)",
    [tenantId],
  );

  // Caller must set nonzero lock/statement timeouts for the transaction.
  // This existing protocol protects roles, grants and assignments through
  // the effect's commit, without granting the runtime catalog write access.
  await client.query('SELECT "authorization".lock_sas_sources_for_read()');

  const authorized = await client.query(
    `SELECT 1
       FROM identity.sessions s
       JOIN tenancy.tenant_memberships m
         ON m.id=s.tenant_membership_id
        AND m.tenant_id=s.tenant_id
        AND m.user_id=s.user_id
        AND m.status='ACTIVE'
       JOIN "authorization".user_role_assignments a
         ON a.tenant_membership_id=m.id
        AND a.tenant_id=m.tenant_id
        AND a.company_id=$2
        AND (a.branch_id IS NULL OR a.branch_id=$3)
        AND a.status='ACTIVE'
        AND a.valid_from<=clock_timestamp()
        AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
       JOIN "authorization".roles r
         ON r.id=a.role_id
        AND r.scope_type='BUSINESS'
        AND r.code IN ('OWNER','GENERAL_ADMIN')
        AND r.status='ACTIVE'
       JOIN "authorization".role_permission_grants g
         ON g.role_id=r.id
        AND g.status='ACTIVE'
        AND g.valid_from<=clock_timestamp()
        AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
       JOIN "authorization".permissions p
         ON p.id=g.permission_id
        AND p.code='CASH_REGISTER_MANAGE'
        AND p.status='ACTIVE'
       JOIN organization.branches b
         ON b.tenant_id=s.tenant_id
        AND b.company_id=$2
        AND b.id=$3
        AND b.status='ACTIVE'
       JOIN organization.companies co
         ON co.tenant_id=s.tenant_id AND co.id=b.company_id
        AND co.status='ACTIVE'
       JOIN tenancy.tenants t
         ON t.id=s.tenant_id AND t.status='ACTIVE'
      WHERE s.id=$1
        AND s.tenant_id=$4
        AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp()
        AND s.mfa_status='SATISFIED'
        AND s.last_reauthenticated_at <= clock_timestamp()
        AND s.last_reauthenticated_at >=
            clock_timestamp()-interval '5 minutes'
      LIMIT 1
      FOR SHARE OF m,a,b,co,t`,
    [sessionId, companyId, branchId, tenantId],
  );

  if (authorized.rowCount !== 1) {
    throw Error("CASH_REGISTER_BUSINESS_PERMISSION_DENIED");
  }

  return { tenantId, userId };
}
