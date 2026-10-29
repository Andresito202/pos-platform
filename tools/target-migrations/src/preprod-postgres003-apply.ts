/**
 * Controlled one-shot Windows preprod 003 fiscal migration.
 *
 * Does not bypass MAT003. Requires an intact prior MAT003 receipt and a
 * fresh PASS preflight. Calls the canonical 003 runner once, with smoke
 * enabled and an exclusive, durable receipt output. Never retries after
 * a partial or ambiguous result; requires operator reconciliation.
 */
import {existsSync,readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {postgresDatabase,queryRows} from "./database.js";
import {runMat003Preflight} from "./postgres-003-preflight.js";
import {applyPostgres003} from "./postgres-003-runner.js";
import {canonicalJson,validateRoleReadinessReceipt} from "./postgres-003-role-readiness.js";
import {POSTGRES_003_MIGRATION_ID,sha256} from "./shared.js";

if(process.argv.length!==3||process.argv[2]!=="--apply-postgres003")
  throw Error("PREPROD_003_EXPLICIT_APPLY_FLAG_REQUIRED");
const root=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!root)throw Error("PREPROD_003_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_003_PASSWORD_ENV_FORBIDDEN");
const dir=join(root,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf");
const ca=join(dir,"pg-server-ca.crt");
const readinessReceipt=join(dir,"mat003-role-readiness-20261029.json");
const migrationReceipt=join(dir,"postgres-003-apply-20261029.json");
for(const [name,path] of [
  ["PGPASS",passfile],
  ["TRUSTED_CA",ca],
  ["MAT003_RECEIPT",readinessReceipt],
] as const)if(!existsSync(path))throw Error("PREPROD_003_REQUIRED_"+name+"_MISSING");
if(existsSync(migrationReceipt))throw Error("PREPROD_003_RECEIPT_EXISTS_MANUAL_REVIEW");
process.env.PGPASSFILE=passfile;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_003_UNEXPECTED_BRANCH");
if(git(["status","--porcelain=v1"])!=="")
  throw Error("PREPROD_003_UNCOMMITTED_CHANGES_STOP");
const commit=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(commit))throw Error("PREPROD_003_INVALID_REPOSITORY_COMMIT");
const environmentId="camacho-pos-windows-preprod";
const databaseName="camacho_pos_preprod";
const ready=validateRoleReadinessReceipt(JSON.parse(readFileSync(readinessReceipt,"utf8")));
if(ready.receipt_payload.target.environment_id!==environmentId||
   ready.receipt_payload.target.database_name!==databaseName||
   ready.receipt_payload.target.postgres_version_num!=="160014"||
   ready.receipt_payload.state_after!=="READY"||
   ready.receipt_payload.result!=="SUCCESS")
  throw Error("PREPROD_003_MAT003_RECEIPT_TARGET_OR_STATE_INVALID");

function roleUrl(role:"pos_platform_admin"|"pos_migrator"):string{
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=role;
  url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",ca);
  return url.toString();
}
const adminUrl=roleUrl("pos_platform_admin");
const migratorUrl=roleUrl("pos_migrator");
process.stdout.write("PREPROD_003_TARGET: camacho_pos_preprod\n");
process.stdout.write("PREPROD_003_TLS_MODE: verify-full\n");
process.stdout.write("PREPROD_003_MAT003_RECEIPT: VERIFIED\n");
const preflight=await runMat003Preflight(adminUrl);
process.stdout.write("PREPROD_003_PREFLIGHT_RESULT: "+preflight.result+"\n");
process.stdout.write("PREPROD_003_PREFLIGHT_FAILURE_CODE: "+(preflight.failure_code??"NONE")+"\n");
if(preflight.result!=="PASS"||
   preflight.database_state?.database!==databaseName||
   preflight.database_state.predecessor_001!=="APPLIED"||
   preflight.database_state.predecessor_002!=="APPLIED"||
   preflight.database_state.catalogs_001_002!=="VALID"||
   preflight.database_state.fiscal_schema!=="ABSENT"||
   preflight.database_state.migration_003_ledger_entries!==0||
   preflight.checks.length!==6||
   preflight.checks.some(check=>check.status!=="PASS"||check.count!==0||check.evidence_truncated))
  throw Error("PREPROD_003_PREFLIGHT_UNSAFE_STOP");

process.stdout.write("PREPROD_003_OFFICIAL_RUNNER: STARTED\n");
const applied=await applyPostgres003({
  adminUrl,migratorUrl,
  expectedDatabase:databaseName,
  environmentId,
  repositoryCommit:commit,
  receiptOutputPath:migrationReceipt,
  // skipSmoke intentionally omitted; 4-role physical smoke must run.
});
process.stdout.write("PREPROD_003_RUNNER_RESULT: "+applied.result+"\n");
process.stdout.write("PREPROD_003_NO_OP: "+applied.noOp+"\n");
process.stdout.write("PREPROD_003_RECONCILED: "+applied.reconciled+"\n");
if(applied.result!=="APPLIED_WITH_RECEIPT"||applied.noOp||applied.reconciled)
  throw Error("PREPROD_003_RUNNER_NEEDS_MANUAL_RECONCILIATION_NO_RETRY");
if(!existsSync(migrationReceipt))throw Error("PREPROD_003_DURABLE_RECEIPT_MISSING_NO_RETRY");
const stored=JSON.parse(readFileSync(migrationReceipt,"utf8")) as {
  receipt_payload?:{
    receipt_version?:number;migration_id?:string;execution_id?:string;repository_commit?:string;
    artifact_sha256?:string;target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };
  receipt_sha256?:string;
};
const payload=stored.receipt_payload;
if(!payload||
   stored.receipt_sha256!==sha256(canonicalJson(payload)).toString("hex")||
   stored.receipt_sha256!==applied.receiptSha256||
   payload.receipt_version!==1||
   payload.migration_id!==POSTGRES_003_MIGRATION_ID||
   payload.execution_id!==applied.executionId||
   payload.repository_commit!==commit||
   payload.artifact_sha256!==applied.checksumHex||
   payload.target?.environment_id!==environmentId||
   payload.target.database_name!==databaseName||
   payload.target.postgres_version_num!=="160014")
  throw Error("PREPROD_003_RECEIPT_INTEGRITY_FAILED_NO_RETRY");
process.stdout.write("PREPROD_003_RECEIPT_INTEGRITY: PASS\n");

// Independent fresh role-bound read of the canonical migration ledger.
const reporting=postgresDatabase(adminUrl,1);
try{
  const rows=await queryRows<{migration_id:string;status:string;checksum_hex:string}>(
    reporting,
    "SELECT migration_id,status,encode(checksum,'hex') checksum_hex "+
    "FROM platform.target_migration_executions "+
    "WHERE migration_id='003_fiscal_electronic_invoicing_foundation'");
  if(rows.length!==1||
     rows[0]?.migration_id!==POSTGRES_003_MIGRATION_ID||
     rows[0].status!=="APPLIED"||
     rows[0].checksum_hex!==applied.checksumHex)
    throw Error("PREPROD_003_LEDGER_POSTCHECK_FAILED_NO_RETRY");
}finally{await reporting.destroy();}
process.stdout.write("PREPROD_003_LEDGER: APPLIED_VERIFIED\n");
process.stdout.write("PREPROD_003_CANONICAL_MIGRATION: PASS\n");
process.stdout.write("POSTGRES_004_AND_LOGIN_NOT_CERTIFIED\n");
