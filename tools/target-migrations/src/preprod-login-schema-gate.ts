/**
 * P0 BUSINESS login SQL readiness. Strictly read-only; never runs migrations.
 *
 * --manifest: offline hashes / dependency chain only (no PC/database).
 * --inspect: Windows preprod TLS/role/receipt/ledger/catalog gate. No writes.
 * Designed for a staging boundary AFTER physically certified 001-005 and
 * BEFORE any 006/007/008-016 apply. Historical/partial state fails closed.
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

const mode=process.argv[2];
if(process.argv.length!==3||(mode!=="--manifest"&&mode!=="--inspect"))
  throw Error("LOGIN_SCHEMA_GATE_MODE_REQUIRED");
const root=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("LOGIN_SCHEMA_BRANCH_MISMATCH");
if(git(["status","--porcelain=v1"])!=="")
  throw Error("LOGIN_SCHEMA_UNCOMMITTED_CHANGES_REJECTED");
const gitHead=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(gitHead))throw Error("LOGIN_SCHEMA_INVALID_GIT_HEAD");
const descriptors=[
  POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR,
  POSTGRES_004_DESCRIPTOR,POSTGRES_005_DESCRIPTOR,
  POSTGRES_006_DESCRIPTOR,POSTGRES_007_DESCRIPTOR,...COMMERCIAL_MIGRATIONS,
];
const expectedIds=[
  "001_central_foundation","002_external_integrations_foundation",
  "003_fiscal_electronic_invoicing_foundation","004_device_trust",
  "005_onboarding_bootstrap_hardening","006_licensing_foundation",
  "007_password_recovery","008_platform_role_assignments",
  "009_webauthn_challenges","010_webauthn_credential_material",
  "011_session_assertion_sequences","012_device_request_proof_replays",
  "013_business_browser_sessions","014_commercial_refresh_binding",
  "015_authorization_snapshot_sequences","016_native_business_authorization",
] as const;
if(descriptors.length!==expectedIds.length||
   descriptors.some((d,i)=>d.migrationId!==expectedIds[i]))
  throw Error("LOGIN_SCHEMA_CANONICAL_ORDER_DRIFT");
for(let i=1;i<descriptors.length;i++){
  const previous=descriptors[i-1]!;
  const current=descriptors[i]!;
  if(!current.dependencies.includes(previous.migrationId))
    throw Error("LOGIN_SCHEMA_DEPENDENCY_CHAIN_BROKEN");
}
const digests=await Promise.all(descriptors.map(async d=>({
  migration_id:d.migrationId,
  checksum_sha256:sha256(await readArtifact(d.upArtifact)).toString("hex"),
})));
if(digests.some(d=>!/^[a-f0-9]{64}$/.test(d.checksum_sha256)))
  throw Error("LOGIN_SCHEMA_ARTIFACT_DIGEST_INVALID");
verifyPreprodLoginArtifactLock(digests.slice(4).map(d=>({id:d.migration_id,hash:d.checksum_sha256})));
const canonical005="4cc95c0fd293c75305c672d2b7b5e958d80a687fc5e0b736d5233272665f8387";
if(digests[4]?.checksum_sha256!==canonical005)
  throw Error("LOGIN_SCHEMA_APPROVED_005_ARTIFACT_DRIFT");

process.stdout.write("LOGIN_SCHEMA_COMMIT: "+gitHead+"\n");
process.stdout.write("LOGIN_SCHEMA_MANIFEST: "+JSON.stringify(digests)+"\n");
process.stdout.write("LOGIN_SCHEMA_DEPENDENCIES: VALID_001_016\n");
if(mode==="--manifest"){
  process.stdout.write("LOGIN_SCHEMA_OFFLINE_MANIFEST: PASS\n");
}else{
  if(process.platform!=="win32"||!process.env.LOCALAPPDATA)
    throw Error("LOGIN_SCHEMA_WINDOWS_PREPROD_REQUIRED");
  if(process.env.PGPASSWORD!==undefined)
    throw Error("LOGIN_SCHEMA_PASSWORD_ENV_FORBIDDEN");
  const dir=join(process.env.LOCALAPPDATA,"CamachoPOS","preprod");
  const passfile=join(dir,"pgpass.conf");
  const cert=join(dir,"pg-server-ca.crt");
  const r005Path=join(dir,"postgres-005-apply-20261029.json");
  if([passfile,cert,r005Path].some(path=>!existsSync(path)))
    throw Error("LOGIN_SCHEMA_PROTECTED_INPUTS_MISSING");
  process.env.PGPASSFILE=passfile;
  const receipt=JSON.parse(readFileSync(r005Path,"utf8")) as {
    receipt_payload?:{
      receipt_version?:number;migration_id?:string;execution_id?:string;
      artifact_sha256?:string;actor_rls_smoke_assertions?:number;
      target?:{environment_id?:string;database_name?:string;postgres_version_num?:string};
    };
    receipt_sha256?:string;
  };
  const p=receipt.receipt_payload;
  if(!p||p.receipt_version!==1||p.migration_id!==POSTGRES_005_DESCRIPTOR.migrationId||
     p.artifact_sha256!==canonical005||p.actor_rls_smoke_assertions!==17||
     p.target?.environment_id!=="camacho-pos-windows-preprod"||
     p.target?.database_name!=="camacho_pos_preprod"||
     p.target?.postgres_version_num!=="160014"||
     receipt.receipt_sha256!==sha256(canonicalJson(p)).toString("hex"))
    throw Error("LOGIN_SCHEMA_005_RECEIPT_INVALID");

  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username="pos_migrator";
  url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",cert);
  const pool=new Pool({connectionString:url.toString(),max:1});
  const client=await pool.connect();
  let began=false,rolledBack=false;
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began=true;
    const ident=(await client.query<{
      database:string;version:string;session_user:string;current_user:string;
      read_only:string;ssl:boolean;
    }>("SELECT current_database() database,current_setting('server_version_num') version,"+
       "session_user,current_user,current_setting('transaction_read_only') read_only,"+
       "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl")).rows[0];
    if(ident?.database!=="camacho_pos_preprod"||ident.version!=="160014"||
       ident.session_user!=="pos_migrator"||ident.current_user!=="pos_migrator"||
       ident.read_only!=="on"||ident.ssl!==true)
      throw Error("LOGIN_SCHEMA_TLS_ROLE_OR_TARGET_MISMATCH");
    await client.query("SET LOCAL ROLE pos_schema_owner");
    const owner=(await client.query<{session_user:string;current_user:string}>(
      "SELECT session_user,current_user")).rows[0];
    if(owner?.session_user!=="pos_migrator"||owner.current_user!=="pos_schema_owner")
      throw Error("LOGIN_SCHEMA_OWNER_ROLE_INVALID");
    const ledger=(await client.query<{
      migration_id:string;status:string;checksum_hex:string;execution_id:string;
      body_committed:boolean;smoke_verified:boolean;
    }>("SELECT migration_id,status,encode(checksum,'hex') checksum_hex,"+
       "execution_id::text execution_id,body_committed_at IS NOT NULL body_committed,"+
       "smoke_verified_at IS NOT NULL smoke_verified "+
       "FROM platform.target_migration_executions WHERE migration_id = ANY($1::text[])",
       [expectedIds])).rows;
    for(const d of digests.slice(0,5)){
      const rows=ledger.filter(row=>row.migration_id===d.migration_id);
      if(rows.length!==1||rows[0]?.status!=="APPLIED"||
         rows[0].checksum_hex!==d.checksum_sha256)
        throw Error("LOGIN_SCHEMA_PREDECESSOR_LEDGER_INVALID");
    }
    const row005=ledger.find(row=>row.migration_id===POSTGRES_005_DESCRIPTOR.migrationId);
    if(row005?.execution_id!==p.execution_id||!row005.body_committed||!row005.smoke_verified)
      throw Error("LOGIN_SCHEMA_005_RECEIPT_LEDGER_MISMATCH");
    if(ledger.some(row=>expectedIds.slice(5).includes(row.migration_id as never)))
      throw Error("LOGIN_SCHEMA_FUTURE_LEDGER_PRESENT_RECONCILIATION_REQUIRED");
    const expectedAbsent=[
      "licensing.plans","identity.password_recovery_requests",
      "authorization.platform_role_assignments","identity.webauthn_challenges",
      "identity.webauthn_credential_material","identity.session_assertion_sequences",
      "identity.device_request_proof_replays","identity.browser_sessions",
      "identity.native_authorization_codes","authorization.snapshot_sequences",
    ];
    const relations=(await client.query<{name:string;present:boolean}>(
      "SELECT name,to_regclass(name) IS NOT NULL present "+
      "FROM unnest($1::text[]) AS t(name)",[expectedAbsent])).rows;
    if(relations.length!==expectedAbsent.length||relations.some(x=>x.present))
      throw Error("LOGIN_SCHEMA_FUTURE_RELATION_ALREADY_PRESENT");
    const status=(await client.query<{rls:boolean;forced:boolean;commercial_reference:boolean}>(
      "SELECT c.relrowsecurity rls,c.relforcerowsecurity forced,"+
      "EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid "+
      "AND a.attname='commercial_reference' AND a.attnum>0 AND NOT a.attisdropped) commercial_reference "+
      "FROM pg_class c WHERE c.oid='tenancy.onboarding_operations'::regclass")).rows[0];
    if(!status?.rls||!status.forced||!status.commercial_reference)
      throw Error("LOGIN_SCHEMA_005_RLS_REGRESSION");
    process.stdout.write("LOGIN_SCHEMA_TLS_IDENTITY: PASS\n");
    process.stdout.write("LOGIN_SCHEMA_005_RECEIPT_LEDGER: PASS\n");
    process.stdout.write("LOGIN_SCHEMA_PREDECESSORS_001_005: APPLIED_CHECKSUM_VALID\n");
    process.stdout.write("LOGIN_SCHEMA_006_016_LEDGER: ABSENT\n");
    process.stdout.write("LOGIN_SCHEMA_FUTURE_TABLES: ABSENT\n");
  }finally{
    if(began){
      try{await client.query("ROLLBACK");rolledBack=true}
      catch{rolledBack=false}
    }
    client.release();await pool.end();
  }
  if(!rolledBack)throw Error("LOGIN_SCHEMA_ROLLBACK_UNCONFIRMED");
  process.stdout.write("LOGIN_SCHEMA_ROLLBACK: CONFIRMED\n");
  process.stdout.write("LOGIN_SCHEMA_READ_ONLY_INSPECTION: PASS\n");
  process.stdout.write("NO_LOGIN_MIGRATIONS_APPLIED\n");
}
