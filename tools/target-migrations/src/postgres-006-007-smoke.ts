/**
 * Physical read-only role smoke for the canonical 006 licensing foundation
 * and 007 password-recovery boundary. Does not create plans, licenses,
 * password tokens, credentials, or identities. All tests run under distinct
 * authenticated database roles, not SET ROLE impersonation.
 *
 * 006: four tables × four roles; 007: one table × four roles.
 * A role identity check + seven privilege checks + a real SELECT probe per
 * table must all succeed. Negative SELECT is verified via PostgreSQL 42501.
 */
import {postgresDatabase,queryRows} from "./database.js";
import {LICENSING_006_TABLES} from "./postgres-006-contract.js";
import {PASSWORD_RECOVERY_007_TABLES} from "./postgres-007-contract.js";
import {MigrationInvariantError} from "./shared.js";

type LoginRole="pos_app"|"pos_worker"|"pos_platform_app"|"pos_platform_admin";
const roles:readonly LoginRole[]=["pos_app","pos_worker","pos_platform_app","pos_platform_admin"];
type Grant="SELECT"|"INSERT"|"UPDATE"|"DELETE"|"TRUNCATE"|"REFERENCES"|"TRIGGER";
const grants:readonly Grant[]=["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"];
function invariant(condition:unknown,message:string):asserts condition{
  if(!condition)throw new MigrationInvariantError(message);
}
function roleUrl(adminUrl:string,role:LoginRole):string{
  const value=new URL(adminUrl);value.username=role;value.password="";return value.toString();
}
function pgState(error:unknown):string|undefined{
  if(!error||typeof error!=="object")return undefined;
  const e=error as {code?:unknown;cause?:unknown};
  if(typeof e.code==="string")return e.code;
  if(e.cause&&e.cause!==error)return pgState(e.cause);
  return undefined;
}
function allowed(migration:"006"|"007",role:LoginRole,grant:Grant):boolean{
  if(grant==="DELETE"||grant==="TRUNCATE"||grant==="REFERENCES"||grant==="TRIGGER")
    return false;
  if(migration==="006"){
    if(grant==="SELECT")return true;
    return role==="pos_platform_app";
  }
  return role==="pos_platform_app"||role==="pos_platform_admin";
}
async function smoke(migration:"006"|"007",adminUrl:string,expectedDatabase:string):Promise<number>{
  const tables=migration==="006"?LICENSING_006_TABLES:PASSWORD_RECOVERY_007_TABLES;
  let assertions=0;
  for(const role of roles){
    const db=postgresDatabase(roleUrl(adminUrl,role),1);
    try{
      await db.connection().execute(async connection=>{
        const identity=(await queryRows<{
          database:string;session_user:string;current_user:string;ssl:boolean
        }>(connection,"SELECT current_database() database,session_user,current_user,"+
          "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
        invariant(identity?.database===expectedDatabase&&
          identity.session_user===role&&identity.current_user===role&&identity.ssl===true,
          migration+" physical role/TLS/target mismatch: "+role);
        assertions++;
        for(const table of tables){
          // Table names and grant names are compile-time constants from the
          // canonical reviewed migration contract, not caller-provided SQL.
          const privileges=(await queryRows<Record<string,boolean>>(connection,
            "SELECT "+grants.map(g=>
              "has_table_privilege(current_user,'"+table+"','"+g+"') AS \""+g+"\""
            ).join(",")))[0];
          for(const grant of grants){
            invariant(privileges?.[grant]===allowed(migration,role,grant),
              migration+" effective "+grant+" ACL differs for "+role+" on "+table);
            assertions++;
          }
          if(allowed(migration,role,"SELECT")){
            await queryRows(connection,"SELECT 1 FROM "+table+" LIMIT 0");
          }else{
            let denied=false;
            try{await queryRows(connection,"SELECT 1 FROM "+table+" LIMIT 0");}
            catch(error){
              if(pgState(error)!=="42501")throw error;
              denied=true;
            }
            invariant(denied,migration+" expected SELECT denial for "+role+" on "+table);
          }
          assertions++;
        }
      });
    }finally{await db.destroy();}
  }
  const expected=roles.length*(1+tables.length*(grants.length+1));
  invariant(assertions===expected,migration+" role-smoke assertion count invalid");
  return assertions;
}
export function runPostgres006Smoke(adminUrl:string,expectedDatabase:string):Promise<number>{
  return smoke("006",adminUrl,expectedDatabase);
}
export function runPostgres007Smoke(adminUrl:string,expectedDatabase:string):Promise<number>{
  return smoke("007",adminUrl,expectedDatabase);
}
