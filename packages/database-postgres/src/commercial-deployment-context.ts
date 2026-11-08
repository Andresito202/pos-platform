import type {Pool} from "pg";
const issued=new WeakMap<object,Pool>();
const required=["008_platform_role_assignments","009_webauthn_challenges","010_webauthn_credential_material","011_session_assertion_sequences",
  "012_device_request_proof_replays","013_business_browser_sessions","014_commercial_refresh_binding","015_authorization_snapshot_sequences","016_native_business_authorization"] as const;
/** Deployment capability, never a user/session credential. Only a verified
 * database/role/checksum manifest can construct it; JSON and booleans cannot. */
export class PostgresCommercialDeploymentContext{
  private constructor(pool:Pool){issued.set(this,pool);Object.freeze(this);}
  static async verify(pool:Pool,input:{expectedDatabase:string;checksums:Readonly<Record<string,string>>}){
    if(!input.expectedDatabase||Object.keys(input.checksums).length!==required.length||
      !required.every(id=>/^[a-f0-9]{64}$/.test(input.checksums[id]??"")))throw Error("COMMERCIAL_EXACT_SCHEMA_MANIFEST_REQUIRED");
    const role=(await pool.query("SELECT current_database() AS db,current_user,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
    if(role?.db!==input.expectedDatabase||role.current_user!=="pos_platform_app"||role.rolsuper||role.rolbypassrls)throw Error("COMMERCIAL_DEPLOYMENT_ROLE_TARGET_REJECTED");
    const rows=(await pool.query("SELECT migration_id,encode(checksum,'hex') AS checksum,status FROM platform.target_migration_executions WHERE migration_id=ANY($1::text[])",[required])).rows;
    if(!required.every(id=>rows.some(r=>r.migration_id===id&&r.status==="APPLIED"&&r.checksum===input.checksums[id]))||
      rows.some(r=>r.status==="STARTED"||r.checksum!==input.checksums[r.migration_id]))throw Error("COMMERCIAL_DEPLOYMENT_SCHEMA_REJECTED");
    return new PostgresCommercialDeploymentContext(pool);
  }
}
export function assertCommercialDeployment(pool:Pool,context:unknown):asserts context is PostgresCommercialDeploymentContext{
  if(typeof context!=="object"||context===null||issued.get(context)!==pool)throw Error("COMMERCIAL_VERIFIED_DEPLOYMENT_CONTEXT_REQUIRED");
}
