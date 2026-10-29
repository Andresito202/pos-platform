/**
 * Physical PostgreSQL 004 role-permission smoke (no data modification).
 *
 * Use dedicated authenticated connections for every runtime role. A success
 * requires actual SQL SELECT for platform roles and SQLSTATE 42501 for the two
 * business/worker roles. Compare effective write/DDL privileges against the
 * exact 004 device-trust contract, without fabricating enrollment evidence.
 */
import { postgresDatabase, queryRows } from "./database.js";
import { DEVICE_TRUST_004_TABLES } from "./postgres-004-contract.js";
import { MigrationInvariantError } from "./shared.js";

type Role = "pos_app"|"pos_worker"|"pos_platform_app"|"pos_platform_admin";
const roles:readonly Role[]=["pos_app","pos_worker","pos_platform_app","pos_platform_admin"];

function roleUrl(adminUrl:string,role:Role):string{
  const url=new URL(adminUrl);
  url.username=role;
  url.password="";
  return url.toString();
}
function invariant(value:unknown,message:string):asserts value{
  if(!value)throw new MigrationInvariantError(message);
}
function sqlstate(error:unknown):string|undefined{
  if(!error||typeof error!=="object")return undefined;
  const candidate=error as {code?:unknown;cause?:unknown};
  if(typeof candidate.code==="string")return candidate.code;
  if(candidate.cause!==undefined&&candidate.cause!==error)return sqlstate(candidate.cause);
  return undefined;
}
interface EffectivePrivileges{
  select_allowed:boolean;insert_allowed:boolean;update_allowed:boolean;
  delete_allowed:boolean;truncate_allowed:boolean;
  references_allowed:boolean;trigger_allowed:boolean;
}
function expected(role:Role):EffectivePrivileges{
  const platformApp=role==="pos_platform_app";
  const platformAdmin=role==="pos_platform_admin";
  return{
    select_allowed:platformApp||platformAdmin,
    insert_allowed:platformApp,update_allowed:platformApp,
    delete_allowed:false,truncate_allowed:false,
    references_allowed:false,trigger_allowed:false,
  };
}
export async function runPostgres004Smoke(adminUrl:string,expectedDatabase:string):Promise<number>{
  let assertions=0;
  for(const role of roles){
    const database=postgresDatabase(roleUrl(adminUrl,role),1);
    try{
      await database.connection().execute(async connection=>{
        const identity=(await queryRows<{database:string;session_user:string;current_user:string}>(
          connection,"SELECT current_database() database,session_user,current_user"))[0];
        invariant(identity?.database===expectedDatabase&&
          identity.session_user===role&&identity.current_user===role,
          `004 smoke session identity mismatch (${role})`);
        assertions+=1;
        for(const table of DEVICE_TRUST_004_TABLES){
          // Identifiers are constants from the reviewed 004 contract.
          const privileges=(await queryRows<EffectivePrivileges>(connection,
            `SELECT
              has_table_privilege(current_user,'${table}','SELECT') select_allowed,
              has_table_privilege(current_user,'${table}','INSERT') insert_allowed,
              has_table_privilege(current_user,'${table}','UPDATE') update_allowed,
              has_table_privilege(current_user,'${table}','DELETE') delete_allowed,
              has_table_privilege(current_user,'${table}','TRUNCATE') truncate_allowed,
              has_table_privilege(current_user,'${table}','REFERENCES') references_allowed,
              has_table_privilege(current_user,'${table}','TRIGGER') trigger_allowed`))[0];
          const contract=expected(role);
          for(const privilege of Object.keys(contract) as (keyof EffectivePrivileges)[]){
            invariant(privileges?.[privilege]===contract[privilege],
              `004 smoke unexpected effective ${privilege} for ${role} on ${table}`);
            assertions+=1;
          }
          if(contract.select_allowed){
            await queryRows(connection,`SELECT 1 FROM ${table} LIMIT 0`);
            assertions+=1;
          }else{
            let denied=false;
            try{await queryRows(connection,`SELECT 1 FROM ${table} LIMIT 0`);}
            catch(error){
              if(sqlstate(error)!=="42501")throw error;
              denied=true;
            }
            invariant(denied,`004 smoke unexpected SELECT access for ${role} on ${table}`);
            assertions+=1;
          }
        }
      });
    }finally{
      await database.destroy();
    }
  }
  return assertions;
}
