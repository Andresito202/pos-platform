/**
 * P0 Windows commercial-login migration status only; NEVER applies a grant or
 * SQL migration, deletes objects, or writes a receipt.
 *
 * Use before/after or following any partial 006–016 outcome. Reads the real
 * canonical ledger under the schema owner in a READ ONLY transaction and
 * reports booleans/statuses only (no secrets, UUIDs or connection URLs).
 *
 * NOT a recovery tool that changes state. Even an APPLIED row is not a
 * human-login or post-apply receipt certification.
 */
import {existsSync,readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Pool} from "pg";
import {POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR} from "./contract.js";
import {POSTGRES_004_DESCRIPTOR} from "./postgres-004-contract.js";
import {POSTGRES_005_DESCRIPTOR} from "./postgres-005-contract.js";
import {POSTGRES_006_DESCRIPTOR} from "./postgres-006-contract.js";
import {POSTGRES_007_DESCRIPTOR} from "./postgres-007-contract.js";
import {COMMERCIAL_MIGRATIONS} from "./postgres-commercial-runner.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {readArtifact,sha256} from "./shared.js";
import {verifyPreprodLoginArtifactLock} from "./preprod-login-sql-lock.js";

if(process.argv.length!==2)throw Error("LOGIN_STAGE_STATUS_TAKES_NO_ARGUMENTS");
if(process.platform!=="win32"||!process.env.LOCALAPPDATA)
  throw Error("LOGIN_STAGE_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)
  throw Error("LOGIN_STAGE_GENERIC_PASSWORD_FORBIDDEN");
const dir=join(process.env.LOCALAPPDATA,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf"),ca=join(dir,"pg-server-ca.crt");
const receipt005=join(dir,"postgres-005-apply-20261029.json");
if([passfile,ca,receipt005].some(path=>!existsSync(path)))
  throw Error("LOGIN_STAGE_PROTECTED_FILES_MISSING");
process.env.PGPASSFILE=passfile;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("LOGIN_STAGE_BRANCH_MISMATCH");
if(git(["status","--porcelain=v1"])!=="")
  throw Error("LOGIN_STAGE_WORKTREE_NOT_CLEAN");
const descriptors=[
  POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR,
  POSTGRES_004_DESCRIPTOR,POSTGRES_005_DESCRIPTOR,POSTGRES_006_DESCRIPTOR,
  POSTGRES_007_DESCRIPTOR,...COMMERCIAL_MIGRATIONS,
];
const digests=await Promise.all(descriptors.map(async d=>({
  migrationId:d.migrationId,hash:sha256(await readArtifact(d.upArtifact)).toString("hex"),
})));
if(digests.length!==16)throw Error("LOGIN_STAGE_EXPECTED_001_016");
verifyPreprodLoginArtifactLock(digests.slice(4).map(d=>({id:d.migrationId,hash:d.hash})));
const receipt=JSON.parse(readFileSync(receipt005,"utf8")) as {
  receipt_payload?:{
    migration_id?:string;artifact_sha256?:string;execution_id?:string;
    actor_rls_smoke_assertions?:number;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };
  receipt_sha256?:string;
};
const p=receipt.receipt_payload;
if(!p||p.migration_id!==POSTGRES_005_DESCRIPTOR.migrationId||
   p.artifact_sha256!==digests[4]?.hash||p.actor_rls_smoke_assertions!==17||
   p.target?.environment_id!=="camacho-pos-windows-preprod"||
   p.target?.database_name!=="camacho_pos_preprod"||
   p.target?.postgres_version_num!=="160014"||
   receipt.receipt_sha256!==sha256(canonicalJson(p)).toString("hex"))
  throw Error("LOGIN_STAGE_005_RECEIPT_INVALID");
const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
url.username="pos_migrator";
url.searchParams.set("sslmode","verify-full");
url.searchParams.set("sslrootcert",ca);
type Row={
  migration_id:string;execution_id:string;status:string;checksum_hex:string;
  body_committed:boolean;smoke_verified:boolean;applied:boolean;
};
let result:"ALL_006_016_ABSENT"|"PARTIALLY_APPLIED"|"ALL_006_016_APPLIED"|"REQUIRES_MANUAL_RECONCILIATION"=
  "ALL_006_016_ABSENT";
let rollback=false;
const pool=new Pool({connectionString:url.toString(),max:1});
const client=await pool.connect();
let began=false;
try{
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  began=true;
  const identity=(await client.query<{
    db:string;version:string;session_user:string;current_user:string;ro:string;ssl:boolean
  }>("SELECT current_database() db,current_setting('server_version_num') version,"+
    "session_user,current_user,current_setting('transaction_read_only') ro,"+
    "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl")).rows[0];
  if(identity?.db!=="camacho_pos_preprod"||identity.version!=="160014"||
     identity.session_user!=="pos_migrator"||identity.current_user!=="pos_migrator"||
     identity.ro!=="on"||identity.ssl!==true)
    throw Error("LOGIN_STAGE_IDENTITY_OR_TLS_INVALID");
  await client.query("SET LOCAL ROLE pos_schema_owner");
  const owner=(await client.query<{session_user:string;current_user:string}>(
    "SELECT session_user,current_user")).rows[0];
  if(owner?.session_user!=="pos_migrator"||owner.current_user!=="pos_schema_owner")
    throw Error("LOGIN_STAGE_OWNER_ROLE_INVALID");
  const rows=(await client.query<Row>(
    "SELECT migration_id,execution_id::text execution_id,status,"+
    "encode(checksum,'hex') checksum_hex,body_committed_at IS NOT NULL body_committed,"+
    "smoke_verified_at IS NOT NULL smoke_verified,applied_at IS NOT NULL applied "+
    "FROM platform.target_migration_executions WHERE migration_id=ANY($1::text[])",
    [digests.map(d=>d.migrationId)])).rows;
  for(const d of digests.slice(0,5)){
    const found=rows.filter(x=>x.migration_id===d.migrationId);
    if(found.length!==1||found[0]?.status!=="APPLIED"||
       found[0].checksum_hex!==d.hash)
      throw Error("LOGIN_STAGE_001_005_BASELINE_INVALID");
  }
  const stored005=rows.find(x=>x.migration_id===POSTGRES_005_DESCRIPTOR.migrationId);
  if(stored005?.execution_id!==p.execution_id||
     !stored005.body_committed||!stored005.smoke_verified)
    throw Error("LOGIN_STAGE_005_RECEIPT_LEDGER_MISMATCH");
  let completed=0,missing=0,unhealthy=0;
  for(const d of digests.slice(5)){
    const prefix=d.migrationId.slice(0,3);
    const relevant=rows.filter(x=>x.migration_id===d.migrationId);
    let state:"ABSENT"|"APPLIED_LEDGER_ONLY"|"REVIEW_REQUIRED";
    if(relevant.length===0){state="ABSENT";missing++;}
    else if(relevant.length===1&&relevant[0]?.status==="APPLIED"&&
      relevant[0].checksum_hex===d.hash&&relevant[0].body_committed&&
      relevant[0].smoke_verified&&relevant[0].applied){
      state="APPLIED_LEDGER_ONLY";completed++;
    }else{state="REVIEW_REQUIRED";unhealthy++;}
    process.stdout.write("LOGIN_STAGE_"+prefix+": "+state+"\n");
  }
  result=unhealthy>0?"REQUIRES_MANUAL_RECONCILIATION":
    completed===0?"ALL_006_016_ABSENT":
    missing===0?"ALL_006_016_APPLIED":"PARTIALLY_APPLIED";
}finally{
  if(began){
    try{await client.query("ROLLBACK");rollback=true}
    catch{rollback=false}
  }
  client.release();await pool.end();
}
if(!rollback)throw Error("LOGIN_STAGE_READ_ONLY_ROLLBACK_UNCONFIRMED");
process.stdout.write("LOGIN_STAGE_ROLLBACK: CONFIRMED\n");
process.stdout.write("LOGIN_STAGE_STATUS: "+result+"\n");
process.stdout.write("LOGIN_STAGE_NO_MUTATIONS_PERFORMED\n");
process.stdout.write("APPLIED_LEDGER_ONLY_REQUIRES_RECEIPT_AND_LIVE_LOGIN_PROOF\n");
