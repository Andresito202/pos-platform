/**
 * Windows preprod 008–016 BUSINESS authentication schema using the canonical
 * commercial runner. Requires an already verified 006/007 receipt and exact
 * PostgreSQL ledger. No further subscriptions, licensing operations or GLOBAL.
 *
 * A partial/ambiguous run is NEVER automatically retried. The canonical
 * runner applies transactional migrations individually under one advisory lock.
 * This wrapper checks actual ACL/canonical ledger and writes a separate,
 * exclusive SHA256 receipt. SQL schema smoke != human login certification.
 */
import {existsSync,readFileSync} from "node:fs";
import {open} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Pool} from "pg";
import {POSTGRES_005_DESCRIPTOR} from "./postgres-005-contract.js";
import {POSTGRES_006_DESCRIPTOR} from "./postgres-006-contract.js";
import {POSTGRES_007_DESCRIPTOR} from "./postgres-007-contract.js";
import {COMMERCIAL_MIGRATIONS,applyCommercialMigrations} from "./postgres-commercial-runner.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {readArtifact,sha256} from "./shared.js";

if(process.argv.length!==3||process.argv[2]!=="--apply-authentication-008-016")
  throw Error("LOGIN_AUTHENTICATION_EXPLICIT_OPERATOR_FLAG_REQUIRED");
if(process.platform!=="win32"||!process.env.LOCALAPPDATA)
  throw Error("LOGIN_AUTHENTICATION_WINDOWS_REQUIRED");
if(process.env.PGPASSWORD!==undefined)
  throw Error("LOGIN_AUTHENTICATION_PASSWORD_ENV_FORBIDDEN");
const dir=join(process.env.LOCALAPPDATA,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf"),cert=join(dir,"pg-server-ca.crt");
const prior=join(dir,"postgres-login-foundation-006-007.json");
const output=join(dir,"postgres-login-authentication-008-016.json");
for(const file of [passfile,cert,prior])
  if(!existsSync(file))throw Error("LOGIN_AUTHENTICATION_PROTECTED_INPUT_MISSING");
if(existsSync(output))throw Error("LOGIN_AUTHENTICATION_RECEIPT_ALREADY_EXISTS");
process.env.PGPASSFILE=passfile;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("LOGIN_AUTHENTICATION_BRANCH_MISMATCH");
if(git(["status","--porcelain=v1"])!=="")throw Error("LOGIN_AUTHENTICATION_UNCOMMITTED_CHANGES");
const commit=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(commit))throw Error("LOGIN_AUTHENTICATION_COMMIT_INVALID");
const database="camacho_pos_preprod",environment="camacho-pos-windows-preprod";
const descriptors=[POSTGRES_005_DESCRIPTOR,POSTGRES_006_DESCRIPTOR,POSTGRES_007_DESCRIPTOR,...COMMERCIAL_MIGRATIONS];
const hashes=await Promise.all(descriptors.map(async d=>({
  id:d.migrationId,hash:sha256(await readArtifact(d.upArtifact)).toString("hex"),
})));
const expectedIds=["008_platform_role_assignments","009_webauthn_challenges",
  "010_webauthn_credential_material","011_session_assertion_sequences",
  "012_device_request_proof_replays","013_business_browser_sessions",
  "014_commercial_refresh_binding","015_authorization_snapshot_sequences",
  "016_native_business_authorization"];
if(COMMERCIAL_MIGRATIONS.length!==expectedIds.length||
  COMMERCIAL_MIGRATIONS.some((d,i)=>d.migrationId!==expectedIds[i]))
  throw Error("LOGIN_AUTHENTICATION_CANONICAL_MIGRATION_ORDER_DRIFT");
const receipt=JSON.parse(readFileSync(prior,"utf8")) as {
  receipt_payload?:{
    receipt_version?:number;
    migrations?:{migration_id?:string;execution_id?:string;artifact_sha256?:string}[];
    predecessor_005_execution_id?:string;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string};
  };
  receipt_sha256?:string;
};
const p=receipt.receipt_payload;
if(!p||p.receipt_version!==1||p.migrations?.length!==2||
   p.target?.environment_id!==environment||p.target.database_name!==database||
   p.target.postgres_version_num!=="160014"||
   receipt.receipt_sha256!==sha256(canonicalJson(p)).toString("hex"))
  throw Error("LOGIN_AUTHENTICATION_FOUNDATION_RECEIPT_INVALID");
for(let i=0;i<2;i++){
  const got=p.migrations?.[i],expected=hashes[i+1];
  if(!got||got.migration_id!==expected?.id||got.artifact_sha256!==expected.hash||
     !/^[a-f0-9-]{36}$/.test(got.execution_id??""))
    throw Error("LOGIN_AUTHENTICATION_FOUNDATION_RECEIPT_DIVERGED");
}
function roleUrl(role:"pos_migrator"|"pos_platform_app"):string{
  const u=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  u.username=role;u.searchParams.set("sslmode","verify-full");
  u.searchParams.set("sslrootcert",cert);return u.toString();
}
const migratorUrl=roleUrl("pos_migrator");
type Row={migration_id:string;execution_id:string;checksum_hex:string;status:string;
  body_committed:boolean;smoke_verified:boolean;applied:boolean};
async function verify(stage:"BEFORE"|"AFTER",results?:readonly {migrationId:string;executionId:string}[]):Promise<void>{
  const pool=new Pool({connectionString:migratorUrl,max:1});
  const client=await pool.connect();
  let began=false,rollback=false;
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began=true;
    const me=(await client.query<{database:string;version:string;session_user:string;current_user:string;
      ro:string;ssl:boolean}>(
      "SELECT current_database() database,current_setting('server_version_num') version,"+
      "session_user,current_user,current_setting('transaction_read_only') ro,"+
      "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl")).rows[0];
    if(me?.database!==database||me.version!=="160014"||
       me.session_user!=="pos_migrator"||me.current_user!=="pos_migrator"||
       me.ro!=="on"||me.ssl!==true)
      throw Error("LOGIN_AUTHENTICATION_TARGET_TLS_OR_IDENTITY_INVALID");
    await client.query("SET LOCAL ROLE pos_schema_owner");
    const ledger=(await client.query<Row>(
      "SELECT migration_id,execution_id::text execution_id,encode(checksum,'hex') checksum_hex,"+
      "status,body_committed_at IS NOT NULL body_committed,"+
      "smoke_verified_at IS NOT NULL smoke_verified,applied_at IS NOT NULL applied "+
      "FROM platform.target_migration_executions WHERE migration_id=ANY($1::text[])",
      [hashes.map(h=>h.id)])).rows;
    for(const predecessor of hashes.slice(0,3)){
      const rows=ledger.filter(row=>row.migration_id===predecessor.id);
      if(rows.length!==1||rows[0]?.status!=="APPLIED"||
         rows[0].checksum_hex!==predecessor.hash)
        throw Error("LOGIN_AUTHENTICATION_FOUNDATION_LEDGER_INVALID");
    }
    for(const [i,record] of p.migrations!.entries()){
      if(ledger.find(x=>x.migration_id===hashes[i+1]?.id)?.execution_id!==record.execution_id)
        throw Error("LOGIN_AUTHENTICATION_FOUNDATION_RECEIPT_LEDGER_MISMATCH");
    }
    for(const d of hashes.slice(3)){
      const rows=ledger.filter(row=>row.migration_id===d.id);
      if(stage==="BEFORE"){
        if(rows.length!==0)throw Error("LOGIN_AUTHENTICATION_EXISTING_HISTORY_NO_RETRY");
      }else{
        const run=results?.find(x=>x.migrationId===d.id);
        if(rows.length!==1||!run||rows[0]?.status!=="APPLIED"||
           rows[0].checksum_hex!==d.hash||rows[0].execution_id!==run.executionId||
           !rows[0].body_committed||!rows[0].smoke_verified||!rows[0].applied)
          throw Error("LOGIN_AUTHENTICATION_LEDGER_MISMATCH_NO_RETRY");
      }
    }
    const namedRelations=COMMERCIAL_MIGRATIONS.flatMap(d=>d.ownedTables)
      .filter(name=>name!=="identity.session_refresh_tokens");
    const catalog=(await client.query<{name:string;owner:string;rls:boolean;forced:boolean}>(
      "SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,"+
      "c.relrowsecurity rls,c.relforcerowsecurity forced "+
      "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
      "WHERE n.nspname||'.'||c.relname=ANY($1::text[]) AND c.relkind='r'",
      [namedRelations])).rows;
    if(stage==="BEFORE"){
      if(catalog.length!==0)throw Error("LOGIN_AUTHENTICATION_PREEXISTING_TABLES");
    }else{
      if(catalog.length!==namedRelations.length||
         catalog.some(row=>row.owner!=="pos_schema_owner"||!row.rls||!row.forced))
        throw Error("LOGIN_AUTHENTICATION_OWNER_RLS_MISMATCH");
      // Contractual prevention of tenant and administrative access to Central
      // challenge/code/sequence stores. The Central platform app alone can
      // read these; no broad GRANT is added.
      const privateTables=[
        "identity.webauthn_challenges","identity.webauthn_credential_material",
        "identity.session_assertion_sequences","identity.device_request_proof_replays",
        "identity.browser_session_handoffs","identity.browser_sessions",
        "authorization.snapshot_sequences","identity.native_authorization_codes",
        "identity.native_authorization_requests",
      ];
      const grants=(await client.query<{name:string;central_select:boolean;
        app_select:boolean;worker_select:boolean;admin_select:boolean}>(
        "SELECT name,has_table_privilege('pos_platform_app',name,'SELECT') central_select,"+
        "has_table_privilege('pos_app',name,'SELECT') app_select,"+
        "has_table_privilege('pos_worker',name,'SELECT') worker_select,"+
        "has_table_privilege('pos_platform_admin',name,'SELECT') admin_select "+
        "FROM unnest($1::text[]) AS t(name)",[privateTables])).rows;
      if(grants.length!==privateTables.length||grants.some(g=>
         !g.central_select||g.app_select||g.worker_select||g.admin_select))
        throw Error("LOGIN_AUTHENTICATION_CENTRAL_PRIVATE_TABLE_ACL_INVALID");
    }
  }finally{
    if(began){try{await client.query("ROLLBACK");rollback=true}catch{rollback=false}}
    client.release();await pool.end();
  }
  if(!rollback)throw Error("LOGIN_AUTHENTICATION_READ_ONLY_ROLLBACK_UNCONFIRMED");
}
process.stdout.write("LOGIN_AUTHENTICATION_TARGET: camacho_pos_preprod\n");
process.stdout.write("LOGIN_AUTHENTICATION_TLS: verify-full\n");
await verify("BEFORE");
process.stdout.write("LOGIN_AUTHENTICATION_READ_ONLY_PREFLIGHT: PASS\n");
process.stdout.write("LOGIN_AUTHENTICATION_CANONICAL_008_016: STARTED\n");
const outcomes=await applyCommercialMigrations({
  migratorUrl,expectedDatabase:database,repositoryCommit:commit,
  lockTimeoutMs:3000,statementTimeoutMs:30000,target:"AUTHENTICATION",
});
if(outcomes.length!==expectedIds.length||
  outcomes.some(x=>x.status!=="APPLIED")||
  outcomes.some((x,i)=>x.migrationId!==expectedIds[i]))
  throw Error("LOGIN_AUTHENTICATION_PARTIAL_OR_NOOP_MANUAL_RECONCILIATION");
await verify("AFTER",outcomes);
process.stdout.write("LOGIN_AUTHENTICATION_LEDGER_CATALOG_ROLE_ACL: PASS\n");
const payload={
  receipt_version:1,
  migrations:outcomes.map(o=>({
    migration_id:o.migrationId,execution_id:o.executionId,
    artifact_sha256:hashes.find(h=>h.id===o.migrationId)!.hash,
  })),
  predecessor_007_execution_id:p.migrations![1]!.execution_id,
  repository_commit:commit,
  target:{environment_id:environment,database_name:database,postgres_version_num:"160014"},
  verified:"SCHEMA_RLS_LEDGER_AND_PRIVATE_TABLE_ACL_NOT_HUMAN_AUTHENTICATION",
};
const digest=sha256(canonicalJson(payload)).toString("hex");
const file=await open(output,"wx");
try{await file.writeFile(JSON.stringify({receipt_payload:payload,receipt_sha256:digest},null,2)+"\n","utf8");
  await file.sync();
}finally{await file.close()}
const saved=JSON.parse(readFileSync(output,"utf8")) as {receipt_payload:typeof payload;receipt_sha256:string};
if(saved.receipt_sha256!==digest||
   sha256(canonicalJson(saved.receipt_payload)).toString("hex")!==digest)
  throw Error("LOGIN_AUTHENTICATION_RECEIPT_INVALID_NO_RETRY");
process.stdout.write("LOGIN_AUTHENTICATION_RECEIPT: VERIFIED\n");
process.stdout.write("LOGIN_AUTHENTICATION_008_016: APPLIED_WITH_SCHEMA_ACL_EVIDENCE\n");
process.stdout.write("HUMAN_LOGIN_GLOBAL_AND_SCM_NOT_CERTIFIED\n");
