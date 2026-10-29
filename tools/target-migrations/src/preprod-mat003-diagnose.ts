/**
 * P0 MAT003 diagnostic for physically deployed Windows preproduction.
 *
 * Does not call applyRoleReadiness(). It reproduces the SQL/ACL/catalog
 * checks INSIDE A TRANSACTION THAT ALWAYS ROLLS BACK. Failure details
 * are limited to a stage name and PostgreSQL SQLSTATE (no message or
 * stack that could include secrets or file paths).
 *
 * The actual reviewed MAT003 runner must still be used for apply.
 */
import {existsSync} from "node:fs";
import {join} from "node:path";
import {postgresDatabase,executeRaw,queryRows} from "./database.js";
import {checkRoleReadiness,inspectRoleReadinessAcl,classifyRoleReadiness,type RoleReadinessConfig} from "./postgres-003-role-readiness.js";
import {validatePostgres002Catalog} from "./postgres-introspection.js";
import {POSTGRES_MIGRATION_LOCK_RESOURCE,readArtifact} from "./shared.js";

if(process.argv.length!==2)throw Error("PREPROD_MAT003_DIAGNOSE_NO_ARGUMENTS");
const root=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!root)throw Error("PREPROD_MAT003_WINDOWS_ONLY");
const dir=join(root,"CamachoPOS","preprod");
if(!existsSync(join(dir,"pgpass.conf"))||!existsSync(join(dir,"pg-server-ca.crt")))
  throw Error("PREPROD_MAT003_MANAGED_CREDENTIAL_FILES_MISSING");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_MAT003_GENERIC_PASSWORD_NOT_ALLOWED");
process.env.PGPASSFILE=join(dir,"pgpass.conf");
const cfg:RoleReadinessConfig={
  provisioningUrl:process.env.POSTGRES_ROLE_READINESS_PROVISIONING_URL??"",
  verificationUrl:process.env.POSTGRES_ROLE_READINESS_VERIFICATION_URL??"",
  environmentId:process.env.POSTGRES_ROLE_READINESS_ENVIRONMENT_ID??"",
  expectedDatabase:process.env.POSTGRES_ROLE_READINESS_EXPECTED_DATABASE??"",
  repositoryCommit:process.env.ROLE_READINESS_REPOSITORY_COMMIT??"",
};
for(const [label,uri,role] of [
  ["PROVISIONING",cfg.provisioningUrl,"pos_migrator"],
  ["VERIFICATION",cfg.verificationUrl,"pos_platform_admin"],
] as const){
  let u:URL;
  try{u=new URL(uri)}catch{throw Error("PREPROD_MAT003_"+label+"_URL_MISSING")}
  if(!["postgres:","postgresql:"].includes(u.protocol)||u.username!==role||
     u.hostname!=="127.0.0.1"||u.port!=="55435"||
     u.pathname!=="/camacho_pos_preprod"||u.password!==""||
     u.searchParams.get("sslmode")!=="verify-full"||
     !u.searchParams.has("sslrootcert")||
     u.searchParams.get("sslrootcert")!==join(dir,"pg-server-ca.crt"))
    throw Error("PREPROD_MAT003_"+label+"_URL_TARGET_OR_TLS_MISMATCH");
}
if(cfg.expectedDatabase!=="camacho_pos_preprod")throw Error("PREPROD_MAT003_EXPECTED_DB_MISMATCH");
const gate=await checkRoleReadiness(cfg);
process.stdout.write("PRECHECK_RESULT: "+gate.result+"\n");
process.stdout.write("PRECHECK_STATE: "+gate.state+"\n");
if(gate.result!=="PASS"||gate.state!=="MISSING"){
  process.stdout.write("DIAGNOSTIC_STOP_NO_GRANTS_ATTEMPTED\n");
  process.exitCode=1;
}else{
  const db=postgresDatabase(cfg.provisioningUrl,1);
  let faultStage="INIT",faultCode="UNKNOWN",faultType="UNKNOWN";
  let completed=false;
  let rollbackConfirmed=false;
  let afterGrantState="NOT_CHECKED";
  try{
    await db.connection().execute(async(connection)=>{
      let began=false;
      try{
        faultStage="BEGIN";
        await executeRaw(connection,"BEGIN");
        began=true;
        faultStage="LOCK";
        const lock=(await queryRows<{acquired:boolean}>(connection,
          "SELECT pg_try_advisory_xact_lock(hashtextextended('"+
          POSTGRES_MIGRATION_LOCK_RESOURCE+"',0)) AS acquired"))[0];
        if(lock?.acquired!==true)throw Error("MAT003_GLOBAL_LOCK_UNAVAILABLE");
        faultStage="SET_LOCAL_ROLE";
        await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
        faultStage="VERIFY_IDENTITY";
        const identity=(await queryRows<{session_user:string;current_user:string;db:string;ssl:boolean}>(
          connection,"SELECT session_user,current_user,current_database() db,"+
          "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
        if(identity?.session_user!=="pos_migrator"||
          identity.current_user!=="pos_schema_owner"||
          identity.db!=="camacho_pos_preprod"||identity.ssl!==true)
          throw Error("MAT003_ROLE_DB_OR_TLS_INVARIANT_FAILED");
        faultStage="ACL_BEFORE";
        const before=await inspectRoleReadinessAcl(connection);
        if(classifyRoleReadiness(before)!=="MISSING")
          throw Error("MAT003_TRANSACTION_BEFORE_NOT_MISSING");
        faultStage="READ_CANONICAL_GRANT_ARTIFACT";
        const sql=await readArtifact("postgres/provisioning/mat-003-preflight-canonical-role-readiness.up.sql");
        faultStage="EXECUTE_CANONICAL_GRANTS";
        await executeRaw(connection,sql);
        faultStage="ACL_AFTER";
        const after=await inspectRoleReadinessAcl(connection);
        afterGrantState=classifyRoleReadiness(after);
        if(afterGrantState!=="READY")throw Error("MAT003_AFTER_GRANT_STATE_NOT_READY");
        faultStage="CATALOG_002_VALIDATE";
        await validatePostgres002Catalog(connection);
        completed=true;
      }catch(error){
        const code=(error as {code?:unknown})?.code;
        if(typeof code==="string"&&/^[0-9A-Z]{5}$/.test(code))faultCode=code;
        const name=(error as {name?:unknown})?.name;
        if(typeof name==="string"&&/^[a-zA-Z]{1,64}$/.test(name))faultType=name;
      }finally{
        if(began){
          try{
            await executeRaw(connection,"ROLLBACK");
            rollbackConfirmed=true;
          }catch{
            rollbackConfirmed=false;
          }
        }
      }
    });
  }finally{
    await db.destroy();
  }
  process.stdout.write("DIAGNOSTIC_STAGE: "+(completed?"ALL_STAGES_PASS":faultStage)+"\n");
  process.stdout.write("DIAGNOSTIC_SQLSTATE: "+faultCode+"\n");
  process.stdout.write("DIAGNOSTIC_ERROR_TYPE: "+faultType+"\n");
  process.stdout.write("INSIDE_TRANSACTION_ACL_AFTER: "+afterGrantState+"\n");
  process.stdout.write("TRANSACTION_ROLLBACK: "+(rollbackConfirmed?"CONFIRMED":"FAILED")+"\n");
  if(!rollbackConfirmed)process.exitCode=2;
  else{
    const verify=await checkRoleReadiness(cfg);
    process.stdout.write("POST_ROLLBACK_RESULT: "+verify.result+"\n");
    process.stdout.write("POST_ROLLBACK_STATE: "+verify.state+"\n");
    if(verify.result!=="PASS"||verify.state!=="MISSING")process.exitCode=3;
    else if(!completed)process.exitCode=1;
  }
}
