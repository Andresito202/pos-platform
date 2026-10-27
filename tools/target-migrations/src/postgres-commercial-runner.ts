import {Pool,type PoolClient} from "pg";
import type {MigrationDescriptor} from "./contract.js";
import {POSTGRES_007_DESCRIPTOR} from "./postgres-007-contract.js";
import {POSTGRES_006_DESCRIPTOR} from "./postgres-006-contract.js";
import {POSTGRES_008_DESCRIPTOR} from "./postgres-008-platform-roles-contract.js";
import {POSTGRES_009_DESCRIPTOR} from "./postgres-009-webauthn-contract.js";
import {POSTGRES_010_DESCRIPTOR} from "./postgres-010-webauthn-material-contract.js";
import {POSTGRES_011_DESCRIPTOR} from "./postgres-011-ssa-sequence-contract.js";
import {POSTGRES_012_DESCRIPTOR} from "./postgres-012-device-proof-contract.js";
import {POSTGRES_013_DESCRIPTOR} from "./postgres-013-browser-sessions-contract.js";
import {MigrationInvariantError,POSTGRES_MIGRATION_LOCK_RESOURCE,RUNNER_VERSION,readArtifact,sha256,uuidV7} from "./shared.js";

const descriptor=(id:string,predecessor:string,tables:readonly string[],schema:string):MigrationDescriptor=>({migrationId:id,
  manifestVersion:1,dependencies:[predecessor],upArtifact:`postgres/${id}.up.sql`,downArtifact:`postgres/${id}.down.sql`,
  checksum:"DERIVED_FROM_UP_ARTIFACT",ownedSchemas:[schema],ownedTables:tables,ownedPolicies:"DERIVED_FROM_UP_ARTIFACT",
  ownedConstraints:"DERIVED_FROM_UP_ARTIFACT",ownedIndexes:"DERIVED_FROM_UP_ARTIFACT",requiredExtensions:[],expectedLedgerState:"APPLIED"});
export const POSTGRES_014_DESCRIPTOR=descriptor("014_commercial_refresh_binding",POSTGRES_013_DESCRIPTOR.migrationId,["identity.session_refresh_tokens"],"identity");
export const POSTGRES_015_DESCRIPTOR=descriptor("015_authorization_snapshot_sequences",POSTGRES_014_DESCRIPTOR.migrationId,["authorization.snapshot_sequences"],"authorization");
export const POSTGRES_016_DESCRIPTOR=descriptor("016_native_business_authorization",POSTGRES_015_DESCRIPTOR.migrationId,["identity.native_authorization_codes","identity.native_authorization_requests"],"identity");
export const COMMERCIAL_MIGRATIONS=Object.freeze([POSTGRES_008_DESCRIPTOR,POSTGRES_009_DESCRIPTOR,POSTGRES_010_DESCRIPTOR,
  POSTGRES_011_DESCRIPTOR,POSTGRES_012_DESCRIPTOR,POSTGRES_013_DESCRIPTOR,POSTGRES_014_DESCRIPTOR,POSTGRES_015_DESCRIPTOR,POSTGRES_016_DESCRIPTOR]);
export const POSTGRES_017_DESCRIPTOR={...descriptor("017_license_offer_pricing",POSTGRES_016_DESCRIPTOR.migrationId,["licensing.plans"],"licensing"),
  dependencies:[POSTGRES_016_DESCRIPTOR.migrationId,POSTGRES_006_DESCRIPTOR.migrationId]};
export const LICENSING_MIGRATIONS=Object.freeze([...COMMERCIAL_MIGRATIONS,POSTGRES_017_DESCRIPTOR]);
export async function commercialMigrationManifest(target:"AUTHENTICATION"|"LICENSING"="AUTHENTICATION"){
  return Object.fromEntries(await Promise.all((target==="LICENSING"?LICENSING_MIGRATIONS:COMMERCIAL_MIGRATIONS).map(async d=>[d.migrationId,sha256(await readArtifact(d.upArtifact)).toString("hex")])));
}
const check:(ok:unknown,message:string)=>asserts ok=(ok,message)=>{if(!ok)throw new MigrationInvariantError(message);};

async function smoke(c:PoolClient,d:MigrationDescriptor){
  for(const table of d.ownedTables){
    const result=await c.query("SELECT r.rolname AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=to_regclass($1)",[table]);
    // 014 extends the existing Identity-central table, whose 001 contract uses
    // role grants rather than tenant RLS. It must not change that boundary.
    check(result.rows[0]?.owner==="pos_schema_owner"&&(d===POSTGRES_014_DESCRIPTOR||result.rows[0].rls&&result.rows[0].forced),`Commercial migration ownership/RLS mismatch: ${table}`);
  }
  if(d===POSTGRES_014_DESCRIPTOR){
    const columns=await c.query("SELECT attname FROM pg_attribute WHERE attrelid='identity.session_refresh_tokens'::regclass AND attnum>0 AND NOT attisdropped");
    check(["client_id","credential_id","family_expires_at","password_credential_version"].every(n=>columns.rows.some(r=>r.attname===n)),"Refresh binding columns missing");
    check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid='identity.session_refresh_tokens'::regclass AND tgname='commercial_refresh_binding_guard' AND tgenabled='O'")).rowCount===1,"Refresh binding guard missing");
  }
  if(d===POSTGRES_017_DESCRIPTOR){
    const columns=(await c.query("SELECT attname FROM pg_attribute WHERE attrelid='licensing.plans'::regclass AND attnum>0 AND NOT attisdropped")).rows;
    check(["offer_profile","included_registers","additional_register_price_minor","support_price_minor","support_charge","offer_policy_reference"].every(name=>columns.some(r=>r.attname===name)),"License offer columns missing");
    check((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid='licensing.plans'::regclass AND tgname='licensing_offer_version_guard' AND tgenabled='O'")).rowCount===1,"License offer history guard missing");
  }
  if(d===POSTGRES_015_DESCRIPTOR){
    const fn=(await c.query("SELECT p.prosecdef,p.prosrc,p.proconfig,r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure('authorization.lock_sas_sources_for_read()')")).rows[0];
    const artifact=await readArtifact(d.upArtifact);
    check(fn?.prosecdef&&fn.rolname==="pos_schema_owner"&&fn.proconfig?.join()==="search_path=pg_catalog"&&
      artifact.split("$function$").at(-2)?.trim()===fn.prosrc.trim(),"SAS lock function drift");
    for(const table of ["roles","permissions","role_permission_grants"])
      check(!(await c.query("SELECT has_any_column_privilege('pos_platform_app',$1,'UPDATE') AS granted",[`authorization.${table}`])).rows[0].granted,"SAS reader must not gain UPDATE RBAC");
    for(const role of ["pos_app","pos_worker","pos_platform_admin"])
      check(!(await c.query("SELECT has_function_privilege($1,'authorization.lock_sas_sources_for_read()','EXECUTE') AS granted",[role])).rows[0].granted,"SAS function exposed outside Central");
  }
}

/** Same canonical migration lock, checksum ledger and transactional DDL. Only
 * registered successors of 007; never applies a proposals/ artifact or guesses
 * a predecessor. Operator URL, target, SHA and time limits are mandatory. */
export async function applyCommercialMigrations(input:{migratorUrl:string;expectedDatabase:string;repositoryCommit:string;lockTimeoutMs:number;statementTimeoutMs:number;target?:"AUTHENTICATION"|"LICENSING"}){
  check(input.target===undefined||input.target==="AUTHENTICATION"||input.target==="LICENSING","Unknown commercial migration target");
  check(/^[0-9a-f]{40}$/.test(input.repositoryCommit)&&input.expectedDatabase.length>0,"Exact migration target/SHA required");
  check([input.lockTimeoutMs,input.statementTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0)&&input.statementTimeoutMs>input.lockTimeoutMs,"Explicit migration timeouts required");
  check(new URL(input.migratorUrl).username==="pos_migrator","Commercial runner requires pos_migrator URL");
  const pool=new Pool({connectionString:input.migratorUrl,max:1}),c=await pool.connect(),results=[];
  try{
    const target=(await c.query("SELECT current_database() AS db,session_user,current_setting('server_version_num') AS version")).rows[0];
    check(target.db===input.expectedDatabase&&target.session_user==="pos_migrator"&&target.version==="160014","Commercial migration target mismatch");
    await c.query("SET ROLE pos_schema_owner");
    await c.query("SELECT set_config('lock_timeout',$1,false),set_config('statement_timeout',$2,false)",[`${input.lockTimeoutMs}ms`,`${input.statementTimeoutMs}ms`]);
    await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[POSTGRES_MIGRATION_LOCK_RESOURCE]);
    try{
      if(input.target==="LICENSING"){
        const foundation=(await c.query("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",[POSTGRES_006_DESCRIPTOR.migrationId])).rows[0];
        check(foundation&&Buffer.from(foundation.checksum).equals(sha256(await readArtifact(POSTGRES_006_DESCRIPTOR.upArtifact))),"Licensing 006 predecessor mismatch");
      }
      let predecessor=POSTGRES_007_DESCRIPTOR;
      for(const d of input.target==="LICENSING"?LICENSING_MIGRATIONS:COMMERCIAL_MIGRATIONS){
        const checksum=sha256(await readArtifact(d.upArtifact)),prior=sha256(await readArtifact(predecessor.upArtifact));
        const history=(await c.query("SELECT execution_id,checksum,status FROM platform.target_migration_executions WHERE migration_id=$1 ORDER BY started_at",[d.migrationId])).rows;
        check(history.every(r=>Buffer.from(r.checksum).equals(checksum)),`Commercial migration checksum mismatch: ${d.migrationId}`);
        const dependency=(await c.query("SELECT checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED' ORDER BY applied_at DESC LIMIT 1",[predecessor.migrationId])).rows[0];
        check(dependency&&Buffer.from(dependency.checksum).equals(prior),`Commercial migration predecessor mismatch: ${d.migrationId}`);
        const applied=history.find(r=>r.status==="APPLIED");
        if(applied){await smoke(c,d);results.push({migrationId:d.migrationId,status:"ALREADY_APPLIED",executionId:applied.execution_id});predecessor=d;continue;}
        check(!history.some(r=>r.status==="STARTED"),"STARTED migration requires reconciliation");
        const id=uuidV7();
        await c.query("INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,runner_version) VALUES($1,$2,'POSTGRESQL',1,$3,'STARTED',clock_timestamp(),$4)",[id,d.migrationId,checksum,`${RUNNER_VERSION};repo=${input.repositoryCommit}`]);
        try{
          await c.query("BEGIN");await c.query(await readArtifact(d.upArtifact));await smoke(c,d);
          await c.query("UPDATE platform.target_migration_executions SET status='APPLIED',body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp(),applied_at=clock_timestamp(),finished_at=clock_timestamp() WHERE execution_id=$1",[id]);
          await c.query("COMMIT");results.push({migrationId:d.migrationId,status:"APPLIED",executionId:id});
        }catch(error){await c.query("ROLLBACK");await c.query("UPDATE platform.target_migration_executions SET status='FAILED',error_code='COMMERCIAL_BODY_ROLLED_BACK',finished_at=clock_timestamp() WHERE execution_id=$1 AND status='STARTED'",[id]);throw error;}
        predecessor=d;
      }
      return results;
    }finally{await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[POSTGRES_MIGRATION_LOCK_RESOURCE]);}
  }finally{c.release();await pool.end();}
}
