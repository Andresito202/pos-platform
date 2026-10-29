/**
 * Guarded, one-time Windows preproduction PostgreSQL 004 device-trust install.
 * Requires canonical 003 receipt and pristine 001/002/003 ledger/cat; never
 * falls back to a default database or TLS settings. The canonical 004 runner
 * performs the actual four-role smoke BEFORE marking smoke_verified_at.
 *
 * A failed or partial run must be reconciled manually. Never retry blindly.
 */
import {existsSync,readFileSync} from "node:fs";
import {open} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {postgresDatabase,executeRaw,queryRows} from "./database.js";
import {POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR} from "./contract.js";
import {POSTGRES_004_DESCRIPTOR,DEVICE_TRUST_004_TABLES,DEVICE_TRUST_004_COLUMNS} from "./postgres-004-contract.js";
import {validatePostgres003Catalog} from "./postgres-003-introspection.js";
import {applyPostgres004} from "./postgres-004-runner.js";
import {runPostgres004Smoke} from "./postgres-004-smoke.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {readArtifact,sha256,POSTGRES_004_MIGRATION_ID} from "./shared.js";

if(process.argv.length!==3||process.argv[2]!=="--apply-postgres004")
  throw Error("PREPROD_004_EXPLICIT_APPROVAL_REQUIRED");
const local=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!local)throw Error("PREPROD_004_WINDOWS_ONLY");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_004_PGPASSWORD_FORBIDDEN");
const dir=join(local,"CamachoPOS","preprod");
const pgpass=join(dir,"pgpass.conf");
const ca=join(dir,"pg-server-ca.crt");
const priorReceipt=join(dir,"postgres-003-apply-20261029.json");
const outReceipt=join(dir,"postgres-004-apply-20261029.json");
for(const file of [pgpass,ca,priorReceipt])
  if(!existsSync(file))throw Error("PREPROD_004_REQUIRED_PROTECTED_INPUT_MISSING");
if(existsSync(outReceipt))throw Error("PREPROD_004_RECEIPT_EXISTS_NO_RETRY");
process.env.PGPASSFILE=pgpass;

const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_004_BRANCH_REJECTED");
if(git(["status","--porcelain=v1"])!=="")
  throw Error("PREPROD_004_DIRTY_TREE_STOP");
const commit=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(commit))throw Error("PREPROD_004_BAD_COMMIT");

const receipt003=JSON.parse(readFileSync(priorReceipt,"utf8")) as {
  receipt_payload?:{receipt_version?:number;migration_id?:string;execution_id?:string;artifact_sha256?:string;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}};
  receipt_sha256?:string
};
if(!receipt003.receipt_payload||
   receipt003.receipt_payload.receipt_version!==1||
   receipt003.receipt_payload.migration_id!==POSTGRES_003_DESCRIPTOR.migrationId||
   receipt003.receipt_payload.target?.environment_id!=="camacho-pos-windows-preprod"||
   receipt003.receipt_payload.target?.database_name!=="camacho_pos_preprod"||
   receipt003.receipt_payload.target?.postgres_version_num!=="160014"||
   receipt003.receipt_sha256!==sha256(canonicalJson(receipt003.receipt_payload)).toString("hex"))
  throw Error("PREPROD_004_PRIOR_RECEIPT_INVALID");

function roleUrl(role:"pos_migrator"|"pos_platform_admin"):string{
  const u=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  u.username=role;u.searchParams.set("sslmode","verify-full");
  u.searchParams.set("sslrootcert",ca);return u.toString();
}
const adminUrl=roleUrl("pos_platform_admin");
const migratorUrl=roleUrl("pos_migrator");
const hashes=await Promise.all(
  [POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR,POSTGRES_004_DESCRIPTOR]
    .map(async descriptor=>({
      migration_id:descriptor.migrationId,
      checksum:sha256(await readArtifact(descriptor.upArtifact)).toString("hex"),
    }))
);
if(receipt003.receipt_payload.artifact_sha256!==hashes[2]?.checksum)
  throw Error("PREPROD_004_003_ARTIFACT_HASH_MISMATCH");

process.stdout.write("PREPROD_004_TARGET: camacho_pos_preprod\n");
process.stdout.write("PREPROD_004_TLS_MODE: verify-full\n");
const db=postgresDatabase(migratorUrl,1);
let rollback=false;
try{
  await db.connection().execute(async connection=>{
    let started=false;
    try{
      await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");started=true;
      const session=(await queryRows<{database:string;version:string;session_user:string;current_user:string;readonly:string}>(
        connection,"SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user,current_setting('transaction_read_only') readonly"))[0];
      if(session?.database!=="camacho_pos_preprod"||session.version!=="160014"||
         session.session_user!=="pos_migrator"||session.current_user!=="pos_migrator"||
         session.readonly!=="on")throw Error("PREPROD_004_SESSION_INVALID");
      await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
      const ledger=await queryRows<{migration_id:string;status:string;checksum_hex:string;execution_id:string}>(
        connection,
        "SELECT migration_id,status,encode(checksum,'hex') checksum_hex,execution_id::text "+
        "FROM platform.target_migration_executions WHERE migration_id "+
        "IN ('001_central_foundation','002_external_integrations_foundation',"+
        "'003_fiscal_electronic_invoicing_foundation','004_device_trust') ORDER BY migration_id");
      for(const expected of hashes.slice(0,3)){
        const found=ledger.filter(item=>item.migration_id===expected.migration_id);
        if(found.length!==1||found[0]?.status!=="APPLIED"||
           found[0].checksum_hex!==expected.checksum)
          throw Error("PREPROD_004_PREDECESSOR_INVALID");
      }
      const row003=ledger.find(item=>item.migration_id===POSTGRES_003_DESCRIPTOR.migrationId);
      if(row003?.execution_id!==receipt003.receipt_payload?.execution_id)
        throw Error("PREPROD_004_003_RECEIPT_LEDGER_MISMATCH");
      if(ledger.some(item=>item.migration_id===POSTGRES_004_MIGRATION_ID))
        throw Error("PREPROD_004_HISTORY_PRESENT_NO_RETRY");
      await validatePostgres003Catalog(connection);
      const tables=await queryRows<{name:string;present:boolean}>(connection,
        "SELECT name,to_regclass(name) IS NOT NULL AS present FROM (VALUES "+
        DEVICE_TRUST_004_TABLES.map(name=>"('"+name+"')").join(",")+
        ") expected(name)");
      if(tables.length!==4||tables.some(item=>item.present))
        throw Error("PREPROD_004_PARTIAL_TABLES_FOUND");
      const rolePrerequisites=await queryRows<{name:string;has_usage:boolean}>(connection,
        "SELECT role_name name,has_schema_privilege(role_name,'identity','USAGE') has_usage FROM "+
        "(VALUES ('pos_platform_app'),('pos_platform_admin')) r(role_name)");
      if(rolePrerequisites.length!==2||rolePrerequisites.some(row=>!row.has_usage))
        throw Error("PREPROD_004_IDENTITY_SCHEMA_USAGE_MISSING");
    }finally{
      if(started)try{await executeRaw(connection,"ROLLBACK");rollback=true}catch{rollback=false}
    }
  });
}finally{await db.destroy();}
if(!rollback)throw Error("PREPROD_004_PREFLIGHT_ROLLBACK_NOT_CONFIRMED");
process.stdout.write("PREPROD_004_READ_ONLY_PREFLIGHT: PASS\n");
process.stdout.write("PREPROD_004_PREDECESSOR_RECEIPT_LEDGER: VERIFIED\n");
process.stdout.write("PREPROD_004_OFFICIAL_RUNNER: STARTED\n");

// No catch/retry. An error after DDL commit may leave STARTED and needs
// hands-on reconciliation; the runner never fabricates smoke_verified_at.
const applied=await applyPostgres004({
  adminUrl,migratorUrl,expectedDatabase:"camacho_pos_preprod",repositoryCommit:commit,
});
process.stdout.write("PREPROD_004_RUNNER_RESULT: "+applied.result+"\n");
process.stdout.write("PREPROD_004_NO_OP: "+applied.noOp+"\n");
if(applied.result!=="APPLIED"||applied.noOp||applied.reconciled)
  throw Error("PREPROD_004_UNEXPECTED_RUNNER_RESULT_NO_RETRY");
if(applied.checksumHex!==hashes[3]?.checksum)
  throw Error("PREPROD_004_ARTIFACT_HASH_DIVERGENCE_NO_RETRY");

const fresh=postgresDatabase(adminUrl,1);
try{
  const ledger=await queryRows<{execution_id:string;status:string;checksum_hex:string;smoke_verified:boolean;committed:boolean}>(
    fresh,
    "SELECT execution_id::text,status,encode(checksum,'hex') checksum_hex,"+
    "smoke_verified_at IS NOT NULL smoke_verified,body_committed_at IS NOT NULL committed "+
    "FROM platform.target_migration_executions WHERE migration_id='004_device_trust'");
  if(ledger.length!==1||ledger[0]?.execution_id!==applied.executionId||
     ledger[0].status!=="APPLIED"||ledger[0].checksum_hex!==applied.checksumHex||
     !ledger[0].smoke_verified||!ledger[0].committed)
    throw Error("PREPROD_004_FRESH_LEDGER_MISMATCH_NO_RETRY");
  const catalog=await queryRows<{table_name:string;column_name:string;owner_name:string}>(
    fresh,
    "SELECT n.nspname||'.'||c.relname table_name,a.attname column_name,"+
    "pg_get_userbyid(c.relowner) owner_name "+
    "FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid "+
    "JOIN pg_attribute a ON a.attrelid=c.oid "+
    "WHERE n.nspname='identity' AND c.relname IN "+
    "('device_registry','device_credentials','device_enrollment_activations','device_authentication_events') "+
    "AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped");
  for(const [table,columns] of Object.entries(DEVICE_TRUST_004_COLUMNS)){
    const found=catalog.filter(item=>item.table_name===table);
    if(found.length!==columns.length||
       found.some(item=>item.owner_name!=="pos_schema_owner")||
       !columns.every(column=>found.some(item=>item.column_name===column)))
      throw Error("PREPROD_004_CATALOG_OWNER_OR_COLUMNS_MISMATCH_NO_RETRY");
  }
}finally{await fresh.destroy();}
process.stdout.write("PREPROD_004_LEDGER: APPLIED_WITH_REAL_SMOKE\n");
process.stdout.write("PREPROD_004_TABLE_OWNERS_AND_COLUMNS: VALID\n");
const assertions=await runPostgres004Smoke(adminUrl,"camacho_pos_preprod");
if(assertions!==132)throw Error("PREPROD_004_INDEPENDENT_SMOKE_FAILED_NO_RETRY");
process.stdout.write("PREPROD_004_ROLE_ACL_SMOKE_ASSERTIONS: "+assertions+"\n");

const payload={
  receipt_version:1,migration_id:POSTGRES_004_MIGRATION_ID,
  execution_id:applied.executionId,repository_commit:commit,
  artifact_sha256:applied.checksumHex,
  target:{environment_id:"camacho-pos-windows-preprod",database_name:"camacho_pos_preprod",postgres_version_num:"160014"},
  role_acl_smoke_assertions:assertions,
};
const digest=sha256(canonicalJson(payload)).toString("hex");
const handle=await open(outReceipt,"wx");
try{
  await handle.writeFile(JSON.stringify({receipt_payload:payload,receipt_sha256:digest},null,2)+"\n","utf8");
  await handle.sync();
}finally{await handle.close();}
if(!existsSync(outReceipt))throw Error("PREPROD_004_RECEIPT_NOT_DURABLE_NO_RETRY");
const saved=JSON.parse(readFileSync(outReceipt,"utf8")) as {receipt_payload:typeof payload;receipt_sha256:string};
if(saved.receipt_sha256!==digest||
   sha256(canonicalJson(saved.receipt_payload)).toString("hex")!==digest)
  throw Error("PREPROD_004_RECEIPT_INTEGRITY_FAILED_NO_RETRY");
process.stdout.write("PREPROD_004_RECEIPT_INTEGRITY: PASS\n");
process.stdout.write("PREPROD_004_CANONICAL_MIGRATION: PASS\n");
process.stdout.write("DEVICE_CEREMONY_AND_HUMAN_LOGIN_NOT_CERTIFIED\n");
