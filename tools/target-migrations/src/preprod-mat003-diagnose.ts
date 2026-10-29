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
import {existsSync,readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
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
// Build both URLs from the verified, dedicated local preproduction target.
// Do not depend on caller shell state: old or malformed env URLs previously
// caused false-negative guards, despite working official CHECK connections.
const cert=join(dir,"pg-server-ca.crt");
function roleUrl(role:"pos_migrator"|"pos_platform_admin"):string{
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=role;
  url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",cert);
  return url.toString();
}
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const branch=execFileSync("git",["branch","--show-current"],{cwd:repository,encoding:"utf8"}).trim();
if(branch!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_MAT003_EXPECTED_BRANCH_REQUIRED");
const sha=execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim();
if(!/^[0-9a-f]{40}$/.test(sha))throw Error("PREPROD_MAT003_INVALID_COMMIT_SHA");
const cfg:RoleReadinessConfig={
  provisioningUrl:roleUrl("pos_migrator"),
  verificationUrl:roleUrl("pos_platform_admin"),
  environmentId:"camacho-pos-windows-preprod",
  expectedDatabase:"camacho_pos_preprod",
  repositoryCommit:sha,
};
process.stdout.write("CONFIG_SOURCE: MANAGED_LOCAL_PREPRODUCTION\n");
for(const [label,uri,role] of [
  ["PROVISIONING",cfg.provisioningUrl,"pos_migrator"],
  ["VERIFICATION",cfg.verificationUrl,"pos_platform_admin"],
] as const){
  let u:URL;
  try{u=new URL(uri)}catch{throw Error("PREPROD_MAT003_"+label+"_URL_MISSING")}
  // Windows path encodings (backslashes, drive-letter case, URI escaping)
  // are not reliable for exact string equality. Verify the trusted CA bytes
  // instead of requiring a literal text representation of its filesystem path.
  const rootCert=u.searchParams.get("sslrootcert");
  let verifiedPinnedCa=false;
  if(rootCert){
    try{
      const expected=createHash("sha256").update(readFileSync(join(dir,"pg-server-ca.crt"))).digest("hex");
      const observed=createHash("sha256").update(readFileSync(rootCert)).digest("hex");
      verifiedPinnedCa=observed===expected;
    }catch{
      verifiedPinnedCa=false;
    }
  }
  const fields={
    PROTOCOL:["postgres:","postgresql:"].includes(u.protocol),
    USERNAME:u.username===role,
    HOST:u.hostname==="127.0.0.1",
    PORT:u.port==="55435",
    DATABASE:u.pathname==="/camacho_pos_preprod",
    NO_EMBEDDED_PASSWORD:u.password==="",
    SSL_VERIFY_FULL:u.searchParams.get("sslmode")==="verify-full",
    SERVER_CA_MATCH:verifiedPinnedCa,
  };
  const failed=Object.entries(fields).filter(([,ok])=>!ok).map(([field])=>field);
  if(failed.length){
    for(const field of failed)process.stdout.write("URL_GUARD_"+label+"_"+field+": FAIL\n");
    throw Error("PREPROD_MAT003_"+label+"_URL_TARGET_OR_TLS_MISMATCH");
  }
  process.stdout.write("URL_GUARD_"+label+": PASS\n");
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
        // Check TLS while still in the authenticated LOGIN role:
        // pg_stat_ssl can mask statistics when switching current_user
        // to a NOLOGIN schema-owner that does not own the session.
        faultStage="VERIFY_SESSION_TLS_BEFORE_ROLE_SWITCH";
        const session=(await queryRows<{session_user:string;current_user:string;db:string;ssl:boolean}>(
          connection,"SELECT session_user,current_user,current_database() db,"+
          "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
        if(session?.session_user!=="pos_migrator"||
           session.current_user!=="pos_migrator"||
           session.db!=="camacho_pos_preprod"||session.ssl!==true)
          throw Error("MAT003_SESSION_OR_TLS_INVARIANT_FAILED");
        faultStage="SET_LOCAL_ROLE";
        await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
        faultStage="VERIFY_IDENTITY_AFTER_ROLE_SWITCH";
        const identity=(await queryRows<{session_user:string;current_user:string;db:string}>(
          connection,"SELECT session_user,current_user,current_database() db"))[0];
        if(identity?.session_user!=="pos_migrator"||
          identity.current_user!=="pos_schema_owner"||
          identity.db!=="camacho_pos_preprod")
          throw Error("MAT003_ROLE_OR_DB_INVARIANT_FAILED");
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
