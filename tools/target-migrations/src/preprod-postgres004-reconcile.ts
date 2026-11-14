/**
 * Reconcile a successfully applied 004 after a least-privilege failure in the
 * post-run reporting wrapper. Never reapply 004, never modify the database.
 *
 * Modes: --inspect (read-only, no files); --complete-receipt (same checks
 * plus exclusive durable local receipt). A failure requires manual review.
 */
import {existsSync,readFileSync} from "node:fs";
import {open} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {postgresDatabase,executeRaw,queryRows} from "./database.js";
import {POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR} from "./contract.js";
import {POSTGRES_004_DESCRIPTOR,DEVICE_TRUST_004_COLUMNS} from "./postgres-004-contract.js";
import {validatePostgres003Catalog} from "./postgres-003-introspection.js";
import {runPostgres004Smoke} from "./postgres-004-smoke.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {readArtifact,sha256,POSTGRES_004_MIGRATION_ID} from "./shared.js";

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=="--inspect"&&mode!=="--complete-receipt"))
  throw Error("PREPROD_004_RECONCILE_VALID_MODE_REQUIRED");
const local=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!local)throw Error("PREPROD_004_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_004_GENERIC_PASSWORD_FORBIDDEN");
const dir=join(local,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf");
const cert=join(dir,"pg-server-ca.crt");
const priorReceipt=join(dir,"postgres-003-apply-20261029.json");
const output=join(dir,"postgres-004-apply-20261029.json");
for(const file of [passfile,cert,priorReceipt])
  if(!existsSync(file))throw Error("PREPROD_004_REQUIRED_FILE_MISSING");
if(existsSync(output))throw Error("PREPROD_004_RECEIPT_EXISTS_MANUAL_REVIEW");
process.env.PGPASSFILE=passfile;
const repoRoot=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
function git(args:string[]):string{
  return execFileSync("git",args,{cwd:repoRoot,encoding:"utf8"}).trim();
}
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_004_BRANCH_REJECTED");
if(git(["status","--porcelain=v1"])!=="")throw Error("PREPROD_004_WORKTREE_DIRTY");
const saved003=JSON.parse(readFileSync(priorReceipt,"utf8")) as {
  receipt_payload?:{
    receipt_version?:number;migration_id?:string;execution_id?:string;artifact_sha256?:string;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };
  receipt_sha256?:string;
};
if(!saved003.receipt_payload||
   saved003.receipt_payload.receipt_version!==1||
   saved003.receipt_payload.migration_id!==POSTGRES_003_DESCRIPTOR.migrationId||
   saved003.receipt_payload.target?.environment_id!=="camacho-pos-windows-preprod"||
   saved003.receipt_payload.target?.database_name!=="camacho_pos_preprod"||
   saved003.receipt_payload.target?.postgres_version_num!=="160014"||
   saved003.receipt_sha256!==sha256(canonicalJson(saved003.receipt_payload)).toString("hex"))
  throw Error("PREPROD_004_003_RECEIPT_INVALID");
const artifacts=await Promise.all(
  [POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR,POSTGRES_004_DESCRIPTOR]
    .map(async d=>({id:d.migrationId,sha:sha256(await readArtifact(d.upArtifact)).toString("hex")}))
);
if(saved003.receipt_payload.artifact_sha256!==artifacts[2]?.sha)
  throw Error("PREPROD_004_003_ARTIFACT_MISMATCH");
function roleUrl(role:"pos_migrator"|"pos_platform_admin"):string{
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=role;url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",cert);
  return url.toString();
}
type Row={migration_id:string;execution_id:string;checksum_hex:string;status:string;
  body_committed:boolean;smoke_verified:boolean;applied:boolean;runner_version:string};
let target:Row|undefined;
let didRollback=false;
const db=postgresDatabase(roleUrl("pos_migrator"),1);
try{
  await db.connection().execute(async connection=>{
    let began=false;
    try{
      await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      began=true;
      const identity=(await queryRows<{database:string;version:string;session_user:string;
        current_user:string;read_only:string;ssl:boolean}>(connection,
        "SELECT current_database() database,current_setting('server_version_num') version,"+
        "session_user,current_user,current_setting('transaction_read_only') read_only,"+
        "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
      if(identity?.database!=="camacho_pos_preprod"||identity.version!=="160014"||
         identity.session_user!=="pos_migrator"||identity.current_user!=="pos_migrator"||
         identity.read_only!=="on"||identity.ssl!==true)
        throw Error("PREPROD_004_IDENTITY_TLS_OR_TARGET_INVALID");
      await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
      const owner=(await queryRows<{session_user:string;current_user:string}>(
        connection,"SELECT session_user,current_user"))[0];
      if(owner?.session_user!=="pos_migrator"||owner.current_user!=="pos_schema_owner")
        throw Error("PREPROD_004_OWNER_ROLE_INVALID");
      const ledger=await queryRows<Row>(connection,
        "SELECT migration_id,execution_id::text execution_id,status,"+
        "encode(checksum,'hex') checksum_hex,runner_version,"+
        "body_committed_at IS NOT NULL body_committed,"+
        "smoke_verified_at IS NOT NULL smoke_verified,"+
        "applied_at IS NOT NULL applied "+
        "FROM platform.target_migration_executions WHERE migration_id IN "+
        "('001_central_foundation','002_external_integrations_foundation',"+
        "'003_fiscal_electronic_invoicing_foundation','004_device_trust')");
      for(const artifact of artifacts){
        const rows=ledger.filter(row=>row.migration_id===artifact.id);
        if(rows.length!==1||rows[0]?.status!=="APPLIED"||
           rows[0].checksum_hex!==artifact.sha)
          throw Error("PREPROD_004_LEDGER_OR_CHECKSUM_MISMATCH");
      }
      if(ledger.find(row=>row.migration_id===POSTGRES_003_DESCRIPTOR.migrationId)?.execution_id
         !==saved003.receipt_payload?.execution_id)
        throw Error("PREPROD_004_PRIOR_EXECUTION_ID_MISMATCH");
      target=ledger.find(row=>row.migration_id===POSTGRES_004_MIGRATION_ID);
      if(!target?.body_committed||!target.smoke_verified||!target.applied)
        throw Error("PREPROD_004_MISSING_COMMIT_OR_SMOKE_EVIDENCE");
      await validatePostgres003Catalog(connection);
      const catalog=await queryRows<{table_name:string;column_name:string;owner_name:string}>(connection,
        "SELECT n.nspname||'.'||c.relname table_name,a.attname column_name,"+
        "pg_get_userbyid(c.relowner) owner_name "+
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
        "JOIN pg_attribute a ON a.attrelid=c.oid "+
        "WHERE n.nspname='identity' AND c.relname IN "+
        "('device_registry','device_credentials','device_enrollment_activations','device_authentication_events') "+
        "AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped");
      for(const [table,columns] of Object.entries(DEVICE_TRUST_004_COLUMNS)){
        const found=catalog.filter(row=>row.table_name===table);
        if(found.length!==columns.length||
           found.some(row=>row.owner_name!=="pos_schema_owner")||
           !columns.every(col=>found.some(row=>row.column_name===col)))
          throw Error("PREPROD_004_CATALOG_DIVERGENCE");
      }
    }finally{
      if(began){
        try{await executeRaw(connection,"ROLLBACK");didRollback=true}
        catch{didRollback=false}
      }
    }
  });
}finally{await db.destroy()}
if(!didRollback||!target)throw Error("PREPROD_004_ROLLBACK_OR_LEDGER_FAILED");
const match=target.runner_version.match(/;migration=004;repo=([0-9a-f]{40})$/);
if(!match)throw Error("PREPROD_004_LEDGER_PROVENANCE_MISSING");
const originalCommit=match[1]!;
try{git(["merge-base","--is-ancestor",originalCommit,"HEAD"])}
catch{throw Error("PREPROD_004_APPLY_COMMIT_NOT_IN_HISTORY")}
process.stdout.write("PREPROD_004_LEDGER: APPLIED_WITH_SMOKE_VERIFIED\n");
process.stdout.write("PREPROD_004_PREDECESSORS_001_003: VALID\n");
process.stdout.write("PREPROD_004_DEVICE_CATALOG: VALID\n");
process.stdout.write("PREPROD_004_ROLLBACK: CONFIRMED\n");
const assertions=await runPostgres004Smoke(roleUrl("pos_platform_admin"),"camacho_pos_preprod");
if(assertions!==132)throw Error("PREPROD_004_ROLE_SMOKE_COUNT_INVALID");
process.stdout.write("PREPROD_004_ROLE_ACL_SMOKE_ASSERTIONS: "+assertions+"\n");
if(mode==="--inspect"){
  process.stdout.write("PREPROD_004_READ_ONLY_RECONCILIATION: PASS\n");
  process.stdout.write("PREPROD_004_RECEIPT: NOT_WRITTEN\n");
}else{
  const payload={
    receipt_version:1,migration_id:POSTGRES_004_MIGRATION_ID,
    execution_id:target.execution_id,repository_commit:originalCommit,
    artifact_sha256:artifacts[3]!.sha,
    target:{environment_id:"camacho-pos-windows-preprod",
      database_name:"camacho_pos_preprod",postgres_version_num:"160014"},
    role_acl_smoke_assertions:assertions,
  };
  const digest=sha256(canonicalJson(payload)).toString("hex");
  const handle=await open(output,"wx");
  try{
    await handle.writeFile(JSON.stringify({receipt_payload:payload,receipt_sha256:digest},null,2)+"\n","utf8");
    await handle.sync();
  }finally{await handle.close()}
  const receipt=JSON.parse(readFileSync(output,"utf8")) as {
    receipt_payload:typeof payload;receipt_sha256:string
  };
  if(receipt.receipt_sha256!==digest||
     sha256(canonicalJson(receipt.receipt_payload)).toString("hex")!==digest)
    throw Error("PREPROD_004_RECEIPT_INTEGRITY_FAILED");
  process.stdout.write("PREPROD_004_RECEIPT_RECONCILED: VERIFIED\n");
  process.stdout.write("PREPROD_004_NO_DATABASE_MUTATION\n");
}
