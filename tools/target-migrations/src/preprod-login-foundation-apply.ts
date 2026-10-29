/**
 * Guarded Windows preprod 006→007 foundation application for BUSINESS login.
 * Both migrations are canonical SQL, never rewritten or re-created here.
 *
 * IMPORTANT: irreversible DB change. Requires --apply-foundation-006-007.
 * A failure after 006 can leave 006 APPLIED and 007 ABSENT; never auto retry.
 * Verify with existing protected 005 receipt and a new, exclusive receipt.
 * This is SCHEMA/ACL verification, not physical MFA/login certification.
 */
import {existsSync,readFileSync} from "node:fs";
import {open} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Pool} from "pg";
import {POSTGRES_005_DESCRIPTOR} from "./postgres-005-contract.js";
import {POSTGRES_006_DESCRIPTOR,LICENSING_006_TABLES} from "./postgres-006-contract.js";
import {POSTGRES_007_DESCRIPTOR,PASSWORD_RECOVERY_007_TABLES} from "./postgres-007-contract.js";
import {applyPostgres006} from "./postgres-006-runner.js";
import {applyPostgres007} from "./postgres-007-runner.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {readArtifact,sha256} from "./shared.js";

if(process.argv.length!==3||process.argv[2]!=="--apply-foundation-006-007")
  throw Error("LOGIN_FOUNDATION_EXPLICIT_OPERATOR_APPROVAL_REQUIRED");
if(process.platform!=="win32"||!process.env.LOCALAPPDATA)
  throw Error("LOGIN_FOUNDATION_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)
  throw Error("LOGIN_FOUNDATION_PASSWORD_ENV_REJECTED");
const dir=join(process.env.LOCALAPPDATA,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf");
const cert=join(dir,"pg-server-ca.crt");
const previous=join(dir,"postgres-005-apply-20261029.json");
const output=join(dir,"postgres-login-foundation-006-007.json");
for(const file of [passfile,cert,previous])
  if(!existsSync(file))throw Error("LOGIN_FOUNDATION_PROTECTED_INPUT_MISSING");
if(existsSync(output))throw Error("LOGIN_FOUNDATION_RECEIPT_ALREADY_EXISTS_STOP");
process.env.PGPASSFILE=passfile;
const root=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("LOGIN_FOUNDATION_BRANCH_REJECTED");
if(git(["status","--porcelain=v1"])!=="")throw Error("LOGIN_FOUNDATION_DIRTY_TREE");
const commit=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(commit))throw Error("LOGIN_FOUNDATION_INVALID_GIT_SHA");

const dbName="camacho_pos_preprod",environment="camacho-pos-windows-preprod";
const d005=sha256(await readArtifact(POSTGRES_005_DESCRIPTOR.upArtifact)).toString("hex");
const d006=sha256(await readArtifact(POSTGRES_006_DESCRIPTOR.upArtifact)).toString("hex");
const d007=sha256(await readArtifact(POSTGRES_007_DESCRIPTOR.upArtifact)).toString("hex");
if(d005!=="4cc95c0fd293c75305c672d2b7b5e958d80a687fc5e0b736d5233272665f8387")
  throw Error("LOGIN_FOUNDATION_APPROVED_005_ARTIFACT_CHANGED");
const receipt005=JSON.parse(readFileSync(previous,"utf8")) as {
  receipt_payload?:{
    migration_id?:string;receipt_version?:number;execution_id?:string;
    artifact_sha256?:string;actor_rls_smoke_assertions?:number;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };
  receipt_sha256?:string;
};
const p=receipt005.receipt_payload;
if(!p||p.receipt_version!==1||p.migration_id!==POSTGRES_005_DESCRIPTOR.migrationId||
   p.artifact_sha256!==d005||p.actor_rls_smoke_assertions!==17||
   p.target?.environment_id!==environment||p.target.database_name!==dbName||
   p.target.postgres_version_num!=="160014"||
   receipt005.receipt_sha256!==sha256(canonicalJson(p)).toString("hex"))
  throw Error("LOGIN_FOUNDATION_005_RECEIPT_INVALID");
function roleUrl(role:"pos_migrator"|"pos_platform_admin"):string{
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=role;
  url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",cert);
  return url.toString();
}
const adminUrl=roleUrl("pos_platform_admin");
const migratorUrl=roleUrl("pos_migrator");
type Row={migration_id:string;execution_id:string;status:string;checksum_hex:string;
  body_committed:boolean;smoke_verified:boolean;applied:boolean};
async function readLedger(client:import("pg").PoolClient,ids:readonly string[]):Promise<Row[]>{
  return (await client.query<Row>(
    "SELECT migration_id,execution_id::text execution_id,status,"+
    "encode(checksum,'hex') checksum_hex,body_committed_at IS NOT NULL body_committed,"+
    "smoke_verified_at IS NOT NULL smoke_verified,applied_at IS NOT NULL applied "+
    "FROM platform.target_migration_executions WHERE migration_id=ANY($1::text[])",[ids])).rows;
}
async function inspect(stage:"BEFORE"|"AFTER",
  execution006?:string,execution007?:string):Promise<void>{
  const pool=new Pool({connectionString:migratorUrl,max:1});
  const client=await pool.connect();
  let begun=false,rolledBack=false;
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun=true;
    const identity=(await client.query<{db:string;login_role:string;session_user:string;ssl:boolean;ro:string}>(
      "SELECT current_database() db,current_user AS login_role,session_user,"+
      "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl,"+
      "current_setting('transaction_read_only') ro")).rows[0];
    if(identity?.db!==dbName||identity.login_role!=="pos_migrator"||
       identity.session_user!=="pos_migrator"||identity.ssl!==true||identity.ro!=="on")
      throw Error("LOGIN_FOUNDATION_IDENTITY_TLS_INVALID");
    await client.query("SET LOCAL ROLE pos_schema_owner");
    const records=await readLedger(client,[
      POSTGRES_005_DESCRIPTOR.migrationId,POSTGRES_006_DESCRIPTOR.migrationId,
      POSTGRES_007_DESCRIPTOR.migrationId,
    ]);
    const only=(id:string)=>records.filter(row=>row.migration_id===id);
    const row005=only(POSTGRES_005_DESCRIPTOR.migrationId);
    if(row005.length!==1||row005[0]?.status!=="APPLIED"||
       row005[0].checksum_hex!==d005||row005[0].execution_id!==p.execution_id)
      throw Error("LOGIN_FOUNDATION_PREDECESSOR_005_MISMATCH");
    if(stage==="BEFORE"){
      if(only(POSTGRES_006_DESCRIPTOR.migrationId).length!==0||
         only(POSTGRES_007_DESCRIPTOR.migrationId).length!==0)
        throw Error("LOGIN_FOUNDATION_EXISTING_HISTORY_MANUAL_RECONCILIATION");
      const baseline=(await client.query<{six:boolean;seven:boolean}>(
        "SELECT to_regclass('licensing.plans') IS NOT NULL six,"+
        "to_regclass('identity.password_recovery_requests') IS NOT NULL seven")).rows[0];
      if(baseline?.six||baseline?.seven)
        throw Error("LOGIN_FOUNDATION_EXISTING_SCHEMA_MANUAL_RECONCILIATION");
    }else{
      for(const [id,hash,execution] of [
        [POSTGRES_006_DESCRIPTOR.migrationId,d006,execution006],
        [POSTGRES_007_DESCRIPTOR.migrationId,d007,execution007],
      ]){
        const rows=only(id!);
        if(rows.length!==1||rows[0]?.status!=="APPLIED"||
           rows[0].checksum_hex!==hash||rows[0].execution_id!==execution||
           !rows[0].body_committed||!rows[0].smoke_verified||!rows[0].applied)
          throw Error("LOGIN_FOUNDATION_LEDGER_POSTCHECK_INVALID");
      }
      const tables=[...LICENSING_006_TABLES,...PASSWORD_RECOVERY_007_TABLES];
      const catalog=(await client.query<{name:string;owner:string;rls:boolean;forced:boolean}>(
        "SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,"+
        "c.relrowsecurity rls,c.relforcerowsecurity forced "+
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
        "WHERE n.nspname||'.'||c.relname=ANY($1::text[]) AND c.relkind='r'",
        [tables])).rows;
      if(catalog.length!==tables.length||
         catalog.some(row=>row.owner!=="pos_schema_owner"||!row.rls||!row.forced))
        throw Error("LOGIN_FOUNDATION_TABLE_OWNER_OR_RLS_INVALID");
      const acl=(await client.query<{denied_app:boolean;denied_worker:boolean;
        allowed_platform:boolean}>(
        "SELECT NOT has_table_privilege('pos_app','identity.password_recovery_requests','SELECT') denied_app,"+
        "NOT has_table_privilege('pos_worker','identity.password_recovery_requests','SELECT') denied_worker,"+
        "has_table_privilege('pos_platform_app','identity.password_recovery_requests','INSERT') allowed_platform")).rows[0];
      if(!acl?.denied_app||!acl.denied_worker||!acl.allowed_platform)
        throw Error("LOGIN_FOUNDATION_PASSWORD_RECOVERY_ROLE_ACL_INVALID");
    }
  }finally{
    if(begun){
      try{await client.query("ROLLBACK");rolledBack=true}
      catch{rolledBack=false}
    }
    client.release();await pool.end();
  }
  if(!rolledBack)throw Error("LOGIN_FOUNDATION_ROLLBACK_NOT_CONFIRMED");
}
process.stdout.write("LOGIN_FOUNDATION_TARGET: camacho_pos_preprod\n");
process.stdout.write("LOGIN_FOUNDATION_TLS: verify-full\n");
await inspect("BEFORE");
process.stdout.write("LOGIN_FOUNDATION_READ_ONLY_GATE: PASS\n");
process.stdout.write("LOGIN_FOUNDATION_CANONICAL_006: STARTED\n");
const applied006=await applyPostgres006({adminUrl,expectedDatabase:dbName,repositoryCommit:commit});
process.stdout.write("LOGIN_FOUNDATION_006_RESULT: "+applied006.result+"\n");
if(applied006.result!=="APPLIED"||applied006.noOp||applied006.checksumHex!==d006)
  throw Error("LOGIN_FOUNDATION_006_NO_RETRY_RECONCILE_MANUALLY");
process.stdout.write("LOGIN_FOUNDATION_CANONICAL_007: STARTED\n");
const applied007=await applyPostgres007({adminUrl,expectedDatabase:dbName,repositoryCommit:commit});
process.stdout.write("LOGIN_FOUNDATION_007_RESULT: "+applied007.result+"\n");
if(applied007.result!=="APPLIED"||applied007.noOp||applied007.checksumHex!==d007)
  throw Error("LOGIN_FOUNDATION_007_NO_RETRY_RECONCILE_MANUALLY");
await inspect("AFTER",applied006.executionId,applied007.executionId);
process.stdout.write("LOGIN_FOUNDATION_LEDGER_CATALOG_ACL: PASS\n");
const payload={
  receipt_version:1,
  migrations:[
    {migration_id:POSTGRES_006_DESCRIPTOR.migrationId,execution_id:applied006.executionId,artifact_sha256:d006},
    {migration_id:POSTGRES_007_DESCRIPTOR.migrationId,execution_id:applied007.executionId,artifact_sha256:d007},
  ],
  predecessor_005_execution_id:p.execution_id,
  repository_commit:commit,
  target:{environment_id:environment,database_name:dbName,postgres_version_num:"160014"},
  verified:"LEDGER_OWNER_FORCED_RLS_AND_ROLE_ACL",
};
const digest=sha256(canonicalJson(payload)).toString("hex");
const file=await open(output,"wx");
try{await file.writeFile(JSON.stringify({receipt_payload:payload,receipt_sha256:digest},null,2)+"\n","utf8");
  await file.sync();
}finally{await file.close()}
const saved=JSON.parse(readFileSync(output,"utf8")) as {receipt_payload:typeof payload;receipt_sha256:string};
if(saved.receipt_sha256!==digest||sha256(canonicalJson(saved.receipt_payload)).toString("hex")!==digest)
  throw Error("LOGIN_FOUNDATION_RECEIPT_INTEGRITY_FAILED_NO_RETRY");
process.stdout.write("LOGIN_FOUNDATION_RECEIPT: VERIFIED\n");
process.stdout.write("LOGIN_FOUNDATION_006_007: APPLIED_VERIFIED\n");
process.stdout.write("HUMAN_LOGIN_AND_BUSINESS_008_016_NOT_CERTIFIED\n");
