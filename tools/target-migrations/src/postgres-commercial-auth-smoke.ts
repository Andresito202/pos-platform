/**
 * 008–016 BUSINESS schema ACL smoke on four REAL authenticated DB roles.
 *
 * No SQL writes, dummy credentials, synthetic grants or DB impersonation.
 * This checks the distinction between platform role assignment inspection
 * (008: platform_admin may SELECT) and Central-only private MFA/PKCE/SSA/SAS
 * tables (009–016: only pos_platform_app may SELECT).
 *
 * 014 is an additive refresh binding of an existing 001 table, so its
 * ownership, trigger and column checks remain with the canonical runner.
 */
import {postgresDatabase,queryRows} from "./database.js";
import {MigrationInvariantError} from "./shared.js";

type Role="pos_app"|"pos_worker"|"pos_platform_app"|"pos_platform_admin";
const roles:readonly Role[]=["pos_app","pos_worker","pos_platform_app","pos_platform_admin"];
const roleAssignments="authorization.platform_role_assignments";
const centralPrivateTables=[
  "identity.webauthn_challenges",
  "identity.webauthn_credential_material",
  "identity.session_assertion_sequences",
  "identity.device_request_proof_replays",
  "identity.browser_session_handoffs",
  "identity.browser_sessions",
  "authorization.snapshot_sequences",
  "identity.native_authorization_codes",
  "identity.native_authorization_requests",
] as const;
const relations=[roleAssignments,...centralPrivateTables] as const;
const grants=["SELECT","DELETE","TRUNCATE","REFERENCES","TRIGGER"] as const;
function check(ok:unknown,message:string):asserts ok{
  if(!ok)throw new MigrationInvariantError(message);
}
function sqlstate(error:unknown):string|undefined{
  if(!error||typeof error!=="object")return undefined;
  const e=error as {code?:unknown;cause?:unknown};
  if(typeof e.code==="string")return e.code;
  if(e.cause&&e.cause!==error)return sqlstate(e.cause);
  return undefined;
}
function roleUrl(adminUrl:string,role:Role):string{
  const u=new URL(adminUrl);u.username=role;u.password="";return u.toString();
}
function readAllowed(role:Role,table:string):boolean{
  return role==="pos_platform_app"||(table===roleAssignments&&role==="pos_platform_admin");
}
export async function runBusinessSchemaAclSmoke(adminUrl:string,expectedDatabase:string):Promise<number>{
  let assertions=0;
  for(const role of roles){
    const database=postgresDatabase(roleUrl(adminUrl,role),1);
    try{
      await database.connection().execute(async connection=>{
        const identity=(await queryRows<{
          database:string;session_user:string;current_user:string;ssl:boolean
        }>(connection,"SELECT current_database() database,session_user,current_user,"+
          "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
        check(identity?.database===expectedDatabase&&identity.session_user===role&&
          identity.current_user===role&&identity.ssl===true,
          "BUSINESS schema smoke role/target/TLS mismatch: "+role);
        assertions++;
        for(const table of relations){
          const privileges=(await queryRows<Record<string,boolean>>(connection,
            "SELECT "+grants.map(g=>
              "has_table_privilege(current_user,'"+table+"','"+g+"') AS \""+g+"\""
            ).join(",")))[0];
          for(const grant of grants){
            const expected=grant==="SELECT"&&readAllowed(role,table);
            check(privileges?.[grant]===expected,
              "BUSINESS "+grant+" grant mismatch: "+role+" "+table);
            assertions++;
          }
          // Actual backend SELECT proves this is not just an ACL metadata
          // assertion; SQLSTATE 42501 is required for forbidden callers.
          if(readAllowed(role,table)){
            await queryRows(connection,"SELECT 1 FROM "+table+" LIMIT 0");
          }else{
            let denied=false;
            try{await queryRows(connection,"SELECT 1 FROM "+table+" LIMIT 0");}
            catch(error){if(sqlstate(error)!=="42501")throw error;denied=true;}
            check(denied,"BUSINESS private table unexpectedly readable: "+role+" "+table);
          }
          assertions++;
        }
      });
    }finally{await database.destroy();}
  }
  // Four role identities + 10 tables × (five grant checks + one SQL probe).
  check(assertions===244,"BUSINESS private ACL smoke assertion count mismatch");
  return assertions;
}
