import type {PoolClient} from "@pos-platform/database-postgres";

/**
 * The final authorization check for sensitive bank-recipient writes.
 * MUST run INSIDE the same SERIALIZABLE transaction and lock active grants,
 * session and tenant membership until the write commits/rolls back.
 * A prior read of the login role is never sufficient for account rotation.
 */
export async function assertMerchantAdminDuringWrite(
 client:PoolClient,session:{
   readonly sessionId:string;readonly userId:string;
   readonly tenantId:string;readonly tenantMembershipId:string;
 },companyId:string,
):Promise<void>{
 const r=await client.query(`SELECT 1 FROM "authorization".user_role_assignments a
 JOIN "authorization".roles role ON role.id=a.role_id
   AND role.status='ACTIVE' AND role.scope_type='BUSINESS'
   AND role.code IN ('OWNER','GENERAL_ADMIN')
 JOIN tenancy.tenant_memberships m ON m.id=a.tenant_membership_id
   AND m.tenant_id=a.tenant_id AND m.user_id=$2
   AND m.status='ACTIVE' AND m.revoked_at IS NULL AND m.suspended_at IS NULL
 JOIN identity.sessions s ON s.id=$1 AND s.user_id=$2 AND s.tenant_id=$3
   AND s.tenant_membership_id=$4 AND s.mfa_status='SATISFIED'
   AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
   AND s.last_reauthenticated_at>clock_timestamp()-interval '10 minutes'
 WHERE a.tenant_id=$3 AND a.tenant_membership_id=$4
   AND a.company_id=$5 AND a.branch_id IS NULL
   AND a.status='ACTIVE' AND a.revoked_at IS NULL
   AND a.valid_from<=clock_timestamp()
   AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
 LIMIT 1 FOR SHARE OF a,role,m,s`,
 [session.sessionId,session.userId,session.tenantId,session.tenantMembershipId,companyId]);
 if(r.rowCount!==1)throw Error("QR001_ADMIN_WRITE_REVOKED");
}
