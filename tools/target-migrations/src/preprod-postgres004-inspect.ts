/**
 * Strict READ-ONLY Windows preproduction gate for PostgreSQL migration 004.
 *
 * Validates the previously applied 003 ledger/receipt, immutable migration
 * artifact digests, canonical 003 catalog, and absence of partial 004 DDL.
 * Does not apply 004, make security changes, or mark smoke as verified.
 */
import {existsSync,readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {postgresDatabase,executeRaw,queryRows} from "./database.js";
import {POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR} from "./contract.js";
import {POSTGRES_004_DESCRIPTOR,DEVICE_TRUST_004_TABLES} from "./postgres-004-contract.js";
import {validatePostgres003Catalog} from "./postgres-003-introspection.js";
import {readArtifact,sha256} from "./shared.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";

if(process.argv.length!==2)throw Error("PREPROD_004_INSPECT_NO_ARGS");
const local=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!local)throw Error("PREPROD_004_WINDOWS_ONLY");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_004_PASSWORD_ENV_FORBIDDEN");
const base=join(local,"CamachoPOS","preprod");
const pgpass=join(base,"pgpass.conf");
const ca=join(base,"pg-server-ca.crt");
const receiptFile=join(base,"postgres-003-apply-20261029.json");
for(const path of [pgpass,ca,receiptFile])if(!existsSync(path))
  throw Error("PREPROD_004_REQUIRED_LOCAL_PROTECTED_FILE_MISSING");
process.env.PGPASSFILE=pgpass;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_004_BRANCH_MISMATCH");
if(git(["status","--porcelain=v1"])!=="")throw Error("PREPROD_004_WORKTREE_NOT_CLEAN");
const receipt=JSON.parse(readFileSync(receiptFile,"utf8")) as {
  receipt_payload?:{
    receipt_version?:number;migration_id?:string;repository_commit?:string;execution_id?:string;
    artifact_sha256?:string;target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };
  receipt_sha256?:string
};
if(!receipt.receipt_payload||
   receipt.receipt_payload.receipt_version!==1||
   receipt.receipt_payload.migration_id!=="003_fiscal_electronic_invoicing_foundation"||
   receipt.receipt_payload.target?.environment_id!=="camacho-pos-windows-preprod"||
   receipt.receipt_payload.target?.database_name!=="camacho_pos_preprod"||
   receipt.receipt_payload.target?.postgres_version_num!=="160014"||
   receipt.receipt_sha256!==sha256(canonicalJson(receipt.receipt_payload)).toString("hex"))
  throw Error("PREPROD_004_003_RECEIPT_INVALID");
const predecessors=[POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR];
const hashes=await Promise.all(predecessors.map(async d=>({
  migration_id:d.migrationId,
  hash:sha256(await readArtifact(d.upArtifact)).toString("hex"),
})));
if(receipt.receipt_payload.artifact_sha256!==hashes[2]?.hash)
  throw Error("PREPROD_004_003_ARTIFACT_MISMATCH");
const up004=sha256(await readArtifact(POSTGRES_004_DESCRIPTOR.upArtifact)).toString("hex");
if(!/^[0-9a-f]{64}$/.test(up004))throw Error("PREPROD_004_ARTIFACT_INVALID");
const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
url.username="pos_migrator";
url.searchParams.set("sslmode","verify-full");
url.searchParams.set("sslrootcert",ca);
const db=postgresDatabase(url.toString(),1);
let rolledBack=false;
try{
  await db.connection().execute(async connection=>{
    let inTransaction=false;
    try{
      await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      inTransaction=true;
      const identity=(await queryRows<{database:string;version:string;session_user:string;current_user:string;readonly:string}>(
        connection,"SELECT current_database() database,current_setting('server_version_num') version,session_user,current_user,current_setting('transaction_read_only') readonly"))[0];
      if(identity?.database!=="camacho_pos_preprod"||
         identity.version!=="160014"||
         identity.session_user!=="pos_migrator"||
         identity.current_user!=="pos_migrator"||
         identity.readonly!=="on")
        throw Error("PREPROD_004_SESSION_OR_TARGET_MISMATCH");
      await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
      const owner=(await queryRows<{session_user:string;current_user:string}>(
        connection,"SELECT session_user,current_user"))[0];
      if(owner?.session_user!=="pos_migrator"||owner.current_user!=="pos_schema_owner")
        throw Error("PREPROD_004_OWNER_IDENTITY_MISMATCH");
      const ledger=await queryRows<{migration_id:string;status:string;checksum_hex:string;execution_id:string}>(
        connection,"SELECT migration_id,status,encode(checksum,'hex') checksum_hex,execution_id::text "+
        "FROM platform.target_migration_executions "+
        "WHERE migration_id IN ('001_central_foundation','002_external_integrations_foundation',"+
        "'003_fiscal_electronic_invoicing_foundation','004_device_trust') ORDER BY migration_id");
      for(const entry of hashes){
        const rows=ledger.filter(item=>item.migration_id===entry.migration_id);
        if(rows.length!==1||rows[0]?.status!=="APPLIED"||
           rows[0].checksum_hex!==entry.hash)
          throw Error("PREPROD_004_PREDECESSOR_INTEGRITY_FAILED");
      }
      const applied003=ledger.find(row=>row.migration_id===POSTGRES_003_DESCRIPTOR.migrationId);
      if(applied003?.execution_id!==receipt.receipt_payload?.execution_id)
        throw Error("PREPROD_004_003_RECEIPT_LEDGER_MISMATCH");
      if(ledger.some(row=>row.migration_id==="004_device_trust"))
        throw Error("PREPROD_004_HISTORY_EXISTS_RECONCILIATION_REQUIRED");
      await validatePostgres003Catalog(connection);
      const tables=await queryRows<{qualified_name:string;present:boolean}>(connection,
        "SELECT name qualified_name,to_regclass(name) IS NOT NULL present FROM (VALUES "+
        DEVICE_TRUST_004_TABLES.map(name=>"('"+name+"')").join(",")+
        ") AS expected(name)");
      if(tables.length!==DEVICE_TRUST_004_TABLES.length||tables.some(row=>row.present))
        throw Error("PREPROD_004_PARTIAL_SCHEMA_MATERIALIZATION");
      process.stdout.write("PREPROD_004_TLS_MODE: verify-full\n");
      process.stdout.write("PREPROD_004_003_RECEIPT_LEDGER: PASS\n");
      process.stdout.write("PREPROD_004_PREDECESSORS_001_003: APPLIED_AND_CHECKSUM_VERIFIED\n");
      process.stdout.write("PREPROD_004_FISCAL_CATALOG: VALID\n");
      process.stdout.write("PREPROD_004_LEDGER_HISTORY: ABSENT\n");
      process.stdout.write("PREPROD_004_FOUR_DEVICE_TABLES: ABSENT\n");
      process.stdout.write("PREPROD_004_ARTIFACT_SHA256: "+up004+"\n");
    }finally{
      if(inTransaction){
        try{await executeRaw(connection,"ROLLBACK");rolledBack=true}catch{rolledBack=false}
      }
    }
  });
}finally{await db.destroy()}
if(!rolledBack)throw Error("PREPROD_004_ROLLBACK_NOT_CONFIRMED");
process.stdout.write("PREPROD_004_ROLLBACK: CONFIRMED\n");
process.stdout.write("PREPROD_004_READ_ONLY_INSPECTION: PASS\n");
process.stdout.write("POSTGRES_004_NOT_APPLIED_OR_SMOKE_CERTIFIED\n");
