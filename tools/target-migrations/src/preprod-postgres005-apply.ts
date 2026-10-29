/**
 * Guarded ONE-TIME Windows preproduction migration 005.
 *
 * Uses fixed localhost preprod and TLS verify-full; verifies previous
 * durable receipts and migration checksums, ensures 005 is absent, invokes
 * canonical runner exactly once and proves physical actor-bound RLS and
 * canonical ledger independently before persisting a new exclusive receipt.
 *
 * No automatic reapply/rollback/reconciliation on failure. A partial 005
 * must be diagnosed before any further write.
 */
import {existsSync,readFileSync} from "node:fs";
import {open} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {postgresDatabase,executeRaw,queryRows} from "./database.js";
import {POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR} from "./contract.js";
import {POSTGRES_004_DESCRIPTOR} from "./postgres-004-contract.js";
import {POSTGRES_005_DESCRIPTOR} from "./postgres-005-contract.js";
import {validatePostgres003Catalog} from "./postgres-003-introspection.js";
import {applyPostgres005} from "./postgres-005-runner.js";
import {runPostgres005Smoke} from "./postgres-005-smoke.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {sha256,readArtifact,POSTGRES_005_MIGRATION_ID} from "./shared.js";

if(process.argv.length!==3||process.argv[2]!=="--apply-postgres005")
  throw Error("PREPROD_005_EXPLICIT_FLAG_REQUIRED");
const local=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!local)throw Error("PREPROD_005_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_005_PASSWORD_ENV_FORBIDDEN");
const dir=join(local,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf");
const ca=join(dir,"pg-server-ca.crt");
const source003=join(dir,"postgres-003-apply-20261029.json");
const source004=join(dir,"postgres-004-apply-20261029.json");
const receiptOut=join(dir,"postgres-005-apply-20261029.json");
for(const file of [passfile,ca,source003,source004])
  if(!existsSync(file))throw Error("PREPROD_005_CUSTODIED_INPUT_MISSING");
if(existsSync(receiptOut))throw Error("PREPROD_005_RECEIPT_EXISTS_NO_RETRY");
process.env.PGPASSFILE=passfile;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_005_BRANCH_REJECTED");
if(git(["status","--porcelain=v1"])!=="")throw Error("PREPROD_005_WORKTREE_DIRTY");
const commit=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(commit))throw Error("PREPROD_005_INVALID_COMMIT");
const database="camacho_pos_preprod";
const environment="camacho-pos-windows-preprod";
const artifactDescriptors=[
  POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR,
  POSTGRES_004_DESCRIPTOR,POSTGRES_005_DESCRIPTOR,
];
const artifacts=await Promise.all(artifactDescriptors.map(async d=>({
  id:d.migrationId,hash:sha256(await readArtifact(d.upArtifact)).toString("hex"),
})));
const approved005ArtifactHash="4cc95c0fd293c75305c672d2b7b5e958d80a687fc5e0b736d5233272665f8387";
if(artifacts[4]?.hash!==approved005ArtifactHash)
  throw Error("PREPROD_005_APPROVED_SQL_ARTIFACT_CHANGED_STOP");
type Receipt={receipt_payload?:{
    receipt_version?:number;migration_id?:string;execution_id?:string;
    artifact_sha256?:string;role_acl_smoke_assertions?:number;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };receipt_sha256?:string};
const receipt003=JSON.parse(readFileSync(source003,"utf8")) as Receipt;
const receipt004=JSON.parse(readFileSync(source004,"utf8")) as Receipt;
for(const [receipt,index] of [[receipt003,2],[receipt004,3]] as const){
  const payload=receipt.receipt_payload;
  if(!payload||payload.receipt_version!==1||
     payload.migration_id!==artifacts[index]?.id||
     payload.artifact_sha256!==artifacts[index]?.hash||
     payload.target?.environment_id!==environment||
     payload.target?.database_name!==database||
     payload.target?.postgres_version_num!=="160014"||
     receipt.receipt_sha256!==sha256(canonicalJson(payload)).toString("hex"))
    throw Error("PREPROD_005_PREDECESSOR_RECEIPT_INVALID");
}
if(receipt004.receipt_payload?.role_acl_smoke_assertions!==132)
  throw Error("PREPROD_005_004_SMOKE_RECEIPT_INVALID");
function roleUrl(role:"pos_migrator"|"pos_platform_admin"):string{
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=role;url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",ca);return url.toString();
}
const adminUrl=roleUrl("pos_platform_admin");
const migratorUrl=roleUrl("pos_migrator");
process.stdout.write("PREPROD_005_TARGET: camacho_pos_preprod\n");
process.stdout.write("PREPROD_005_TLS_MODE: verify-full\n");

// READ-ONLY gate before the official migration. No privileges widened.
let rolledBack=false;
const before=postgresDatabase(migratorUrl,1);
try{
  await before.connection().execute(async connection=>{
    let began=false;
    try{
      await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      began=true;
      const identity=(await queryRows<{database:string;version:string;session_user:string;current_user:string;
        readonly:string;ssl:boolean}>(connection,
        "SELECT current_database() database,current_setting('server_version_num') version,"+
        "session_user,current_user,current_setting('transaction_read_only') readonly,"+
        "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
      if(identity?.database!==database||identity.version!=="160014"||
         identity.session_user!=="pos_migrator"||identity.current_user!=="pos_migrator"||
         identity.readonly!=="on"||identity.ssl!==true)
        throw Error("PREPROD_005_INVALID_DATABASE_OR_TLS");
      await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
      const ledger=await queryRows<{migration_id:string;execution_id:string;status:string;checksum_hex:string}>(
        connection,
        "SELECT migration_id,execution_id::text execution_id,status,encode(checksum,'hex') checksum_hex "+
        "FROM platform.target_migration_executions WHERE migration_id IN "+
        "('001_central_foundation','002_external_integrations_foundation',"+
        "'003_fiscal_electronic_invoicing_foundation','004_device_trust',"+
        "'005_onboarding_bootstrap_hardening')");
      for(const artifact of artifacts.slice(0,4)){
        const rows=ledger.filter(item=>item.migration_id===artifact.id);
        if(rows.length!==1||rows[0]?.status!=="APPLIED"||
           rows[0].checksum_hex!==artifact.hash)
          throw Error("PREPROD_005_PREDECESSOR_INVALID");
      }
      if(ledger.find(row=>row.migration_id===POSTGRES_003_DESCRIPTOR.migrationId)?.execution_id
        !==receipt003.receipt_payload?.execution_id||
         ledger.find(row=>row.migration_id===POSTGRES_004_DESCRIPTOR.migrationId)?.execution_id
        !==receipt004.receipt_payload?.execution_id)
        throw Error("PREPROD_005_PREDECESSOR_EXECUTION_ID_MISMATCH");
      if(ledger.some(row=>row.migration_id===POSTGRES_005_MIGRATION_ID))
        throw Error("PREPROD_005_HISTORY_PRESENT_NO_RETRY");
      await validatePostgres003Catalog(connection);
      const baseline=(await queryRows<{column_present:boolean;index_present:boolean;owner_name:string}>(
        connection,"SELECT pg_get_userbyid(c.relowner) owner_name,"+
        "EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid "+
        "AND a.attname='commercial_reference' AND a.attnum>0 AND NOT a.attisdropped) column_present,"+
        "to_regclass('tenancy.onboarding_operations_commercial_reference_uq') IS NOT NULL index_present "+
        "FROM pg_class c WHERE c.oid='tenancy.onboarding_operations'::regclass"))[0];
      if(baseline?.owner_name!=="pos_schema_owner"||
         baseline.column_present||baseline.index_present)
        throw Error("PREPROD_005_CATALOG_PREEXISTING_OR_INVALID");
      const policies=await queryRows<{name:string}>(
        connection,
        "SELECT polname name FROM pg_policy WHERE polrelid='tenancy.onboarding_operations'::regclass");
      if(policies.some(p=>[
        "onboarding_operations_actor_select","onboarding_operations_bootstrap_insert",
        "onboarding_operations_actor_update",
      ].includes(p.name)))throw Error("PREPROD_005_PREEXISTING_POLICY");
    }finally{
      if(began){
        try{await executeRaw(connection,"ROLLBACK");rolledBack=true}
        catch{rolledBack=false}
      }
    }
  });
}finally{await before.destroy()}
if(!rolledBack)throw Error("PREPROD_005_READ_ONLY_ROLLBACK_FAILED");
process.stdout.write("PREPROD_005_READ_ONLY_PREFLIGHT: PASS\n");
process.stdout.write("PREPROD_005_RECEIPTS_003_004: VERIFIED\n");

process.stdout.write("PREPROD_005_OFFICIAL_RUNNER: STARTED\n");
const applied=await applyPostgres005({adminUrl,expectedDatabase:database,repositoryCommit:commit});
process.stdout.write("PREPROD_005_RUNNER_RESULT: "+applied.result+"\n");
process.stdout.write("PREPROD_005_NO_OP: "+applied.noOp+"\n");
if(applied.result!=="APPLIED"||applied.noOp||applied.checksumHex!==artifacts[4]?.hash)
  throw Error("PREPROD_005_RUNNER_UNEXPECTED_STATE_NO_RETRY");

// Fresh privileged owner read; pos_platform_admin intentionally cannot read
// the audit columns beyond MAT003 column-scoped SELECT.
const verification=postgresDatabase(migratorUrl,1);
try{
  await verification.connection().execute(async connection=>{
    await executeRaw(connection,"SET ROLE pos_schema_owner");
    try{
      const ledger=await queryRows<{execution_id:string;status:string;checksum_hex:string;
        body_committed:boolean;smoke_verified:boolean;applied:boolean;runner_version:string}>(
        connection,
        "SELECT execution_id::text execution_id,status,encode(checksum,'hex') checksum_hex,"+
        "body_committed_at IS NOT NULL body_committed,"+
        "smoke_verified_at IS NOT NULL smoke_verified,applied_at IS NOT NULL applied,runner_version "+
        "FROM platform.target_migration_executions WHERE migration_id='005_onboarding_bootstrap_hardening'");
      if(ledger.length!==1||ledger[0]?.execution_id!==applied.executionId||
         ledger[0].status!=="APPLIED"||ledger[0].checksum_hex!==applied.checksumHex||
         !ledger[0].body_committed||!ledger[0].smoke_verified||!ledger[0].applied||
         !ledger[0].runner_version.includes(";migration=005;repo="+commit))
        throw Error("PREPROD_005_LEDGER_MISMATCH_NO_RETRY");
      const catalog=(await queryRows<{owner_name:string;enabled:boolean;forced:boolean;
        column_present:boolean;index_unique:boolean;index_partial:boolean}>(
        connection,
        "SELECT pg_get_userbyid(t.relowner) owner_name,t.relrowsecurity enabled,t.relforcerowsecurity forced,"+
        "EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=t.oid "+
        "AND a.attname='commercial_reference' AND a.attnum>0 AND NOT a.attisdropped) column_present,"+
        "COALESCE((SELECT i.indisunique FROM pg_index i WHERE i.indexrelid="+
        "to_regclass('tenancy.onboarding_operations_commercial_reference_uq')),false) index_unique,"+
        "COALESCE((SELECT i.indpred IS NOT NULL FROM pg_index i WHERE i.indexrelid="+
        "to_regclass('tenancy.onboarding_operations_commercial_reference_uq')),false) index_partial "+
        "FROM pg_class t WHERE t.oid='tenancy.onboarding_operations'::regclass"))[0];
      if(catalog?.owner_name!=="pos_schema_owner"||!catalog.enabled||!catalog.forced||
         !catalog.column_present||!catalog.index_unique||!catalog.index_partial)
        throw Error("PREPROD_005_RLS_OR_INDEX_CATALOG_MISMATCH");
      const policies=await queryRows<{name:string;command:string}>(
        connection,
        "SELECT polname name,polcmd command FROM pg_policy "+
        "WHERE polrelid='tenancy.onboarding_operations'::regclass");
      for(const [name,command] of [
        ["onboarding_operations_actor_select","r"],
        ["onboarding_operations_bootstrap_insert","a"],
        ["onboarding_operations_actor_update","w"],
      ]){
        if(!policies.some(p=>p.name===name&&p.command===command))
          throw Error("PREPROD_005_POLICY_MISSING_OR_INVALID");
      }
    }finally{await executeRaw(connection,"RESET ROLE")}
  });
}finally{await verification.destroy()}
process.stdout.write("PREPROD_005_LEDGER_AND_RLS_CATALOG: VERIFIED\n");
const assertions=await runPostgres005Smoke(adminUrl,database);
if(assertions!==17)throw Error("PREPROD_005_INDEPENDENT_RLS_SMOKE_FAILED");
process.stdout.write("PREPROD_005_ACTOR_RLS_SMOKE_ASSERTIONS: "+assertions+"\n");

const payload={
  receipt_version:1,migration_id:POSTGRES_005_MIGRATION_ID,
  execution_id:applied.executionId,repository_commit:commit,artifact_sha256:applied.checksumHex,
  target:{environment_id:environment,database_name:database,postgres_version_num:"160014"},
  actor_rls_smoke_assertions:assertions,
};
const checksum=sha256(canonicalJson(payload)).toString("hex");
const handle=await open(receiptOut,"wx");
try{
  await handle.writeFile(JSON.stringify({receipt_payload:payload,receipt_sha256:checksum},null,2)+"\n","utf8");
  await handle.sync();
}finally{await handle.close()}
const reread=JSON.parse(readFileSync(receiptOut,"utf8")) as {
  receipt_payload:typeof payload;receipt_sha256:string
};
if(reread.receipt_sha256!==checksum||
   sha256(canonicalJson(reread.receipt_payload)).toString("hex")!==checksum)
  throw Error("PREPROD_005_RECEIPT_INTEGRITY_FAILURE_NO_RETRY");
process.stdout.write("PREPROD_005_RECEIPT_INTEGRITY: PASS\n");
process.stdout.write("PREPROD_005_CANONICAL_MIGRATION: PASS\n");
process.stdout.write("COMMERCIAL_LOGIN_NOT_CERTIFIED\n");
