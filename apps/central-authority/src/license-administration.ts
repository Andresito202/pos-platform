import {CentralAdministrationOperation} from "@pos-platform/contracts";
import {PostgresPlatformAdministrationSessionRepository,type PoolClient} from "@pos-platform/database-postgres";
/** Reuses Identity/D1 authority. Caller owns transaction/timeouts/RBAC lock. */
export async function requireLicenseAdministrator(c:PoolClient,sessionId:string,reauthenticationMs:number,operation:"LICENSE_ISSUE"|"LICENSE_REVOKE"=CentralAdministrationOperation.LICENSE_ISSUE){
  await c.query("SELECT set_config('app.tenant_id','',true)");
  await c.query('SELECT "authorization".lock_platform_sources_for_read()');
  await c.query("SELECT id FROM identity.sessions WHERE id=$1 FOR SHARE",[sessionId]);
  const actor=await new PostgresPlatformAdministrationSessionRepository(c).findActivePlatformPermissionForSession(sessionId,operation,reauthenticationMs);
  if(!actor)throw Error("LICENSING_GLOBAL_LICENSE_ISSUE_REQUIRED");
  if((await c.query(`SELECT 1 FROM identity.browser_session_handoffs h JOIN identity.users u ON u.id=h.user_id AND u.status='ACTIVE'
    JOIN identity.user_credentials pwd ON pwd.id=h.password_credential_id AND pwd.user_id=u.id AND pwd.status='ACTIVE'
      AND pwd.credential_type='PASSWORD' AND pwd.version=h.password_credential_version AND pwd.revoked_at IS NULL
      AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
    JOIN identity.mfa_factors f ON f.id=h.factor_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.verified_at IS NOT NULL AND f.revoked_at IS NULL
    WHERE h.session_id=$1 AND h.tenant_id IS NULL AND h.membership_id IS NULL FOR SHARE OF u,pwd,f`,[sessionId])).rowCount!==1)
    throw Error("LICENSING_CURRENT_GLOBAL_CREDENTIAL_REQUIRED");
  return actor;
}
