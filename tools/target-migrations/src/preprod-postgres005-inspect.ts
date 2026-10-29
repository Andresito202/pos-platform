/**
 * Windows preprod PostgreSQL 005: READ-ONLY prerequisite/receipt inspection.
 *
 * Does not apply migrations, change credentials/roles, perform INSERTs, or
 * run the database-destructive physical 005 test suite. Protects 001-004
 * lineage and flags any existing 005 history/catalog before further work.
 */
import {existsSync,readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {postgresDatabase,executeRaw,queryRows} from "./database.js";
import {POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR} from "./contract.js";
import {POSTGRES_004_DESCRIPTOR,DEVICE_TRUST_004_TABLES} from "./postgres-004-contract.js";
import {POSTGRES_005_DESCRIPTOR} from "./postgres-005-contract.js";
import {validatePostgres003Catalog} from "./postgres-003-introspection.js";
import {canonicalJson} from "./postgres-003-role-readiness.js";
import {readArtifact,sha256} from "./shared.js";

if(process.argv.length!==2)throw Error("PREPROD_005_INSPECT_NO_ARGUMENTS");
const local=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!local)throw Error("PREPROD_005_WINDOWS_ONLY");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_005_GENERIC_PASSWORD_FORBIDDEN");
const dir=join(local,"CamachoPOS","preprod");
const passfile=join(dir,"pgpass.conf");
const ca=join(dir,"pg-server-ca.crt");
const receipt003Path=join(dir,"postgres-003-apply-20261029.json");
const receipt004Path=join(dir,"postgres-004-apply-20261029.json");
for(const path of [passfile,ca,receipt003Path,receipt004Path])
  if(!existsSync(path))throw Error("PREPROD_005_CUSTODIED_INPUT_MISSING");
process.env.PGPASSFILE=passfile;
const repository=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(a:string[])=>execFileSync("git",a,{cwd:repository,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")
  throw Error("PREPROD_005_BRANCH_MISMATCH");
if(git(["status","--porcelain=v1"])!=="")throw Error("PREPROD_005_WORKTREE_DIRTY");

type Receipt={receipt_payload?:{
    receipt_version?:number;migration_id?:string;execution_id?:string;
    repository_commit?:string;artifact_sha256?:string;role_acl_smoke_assertions?:number;
    target?:{environment_id?:string;database_name?:string;postgres_version_num?:string}
  };
  receipt_sha256?:string};
const receipt003=JSON.parse(readFileSync(receipt003Path,"utf8")) as Receipt;
const receipt004=JSON.parse(readFileSync(receipt004Path,"utf8")) as Receipt;
const descriptors=[
  POSTGRES_001_DESCRIPTOR,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR,
  POSTGRES_004_DESCRIPTOR,POSTGRES_005_DESCRIPTOR,
];
const hashes=await Promise.all(descriptors.map(async d=>({
  id:d.migrationId,sha:sha256(await readArtifact(d.upArtifact)).toString("hex"),
})));
for(const [receipt,index] of [[receipt003,2],[receipt004,3]] as const){
  const payload=receipt.receipt_payload;
  if(!payload||
     payload.receipt_version!==1||
     payload.migration_id!==hashes[index]?.id||
     payload.artifact_sha256!==hashes[index]?.sha||
     payload.target?.environment_id!=="camacho-pos-windows-preprod"||
     payload.target?.database_name!=="camacho_pos_preprod"||
     payload.target?.postgres_version_num!=="160014"||
     receipt.receipt_sha256!==sha256(canonicalJson(payload)).toString("hex"))
    throw Error("PREPROD_005_PREDECESSOR_RECEIPT_INVALID");
}
if(receipt004.receipt_payload?.role_acl_smoke_assertions!==132)
  throw Error("PREPROD_005_004_SMOKE_RECEIPT_INVALID");
const original004=receipt004.receipt_payload.repository_commit;
if(!original004||!/^[0-9a-f]{40}$/.test(original004))
  throw Error("PREPROD_005_004_PROVENANCE_INVALID");
try{git(["merge-base","--is-ancestor",original004,"HEAD"])}
catch{throw Error("PREPROD_005_004_APPLY_COMMIT_NOT_ANCESTOR")}

const uri=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
uri.username="pos_migrator";
uri.searchParams.set("sslmode","verify-full");
uri.searchParams.set("sslrootcert",ca);

let rolledBack=false;
const db=postgresDatabase(uri.toString(),1);
try{
  await db.connection().execute(async connection=>{
    let begun=false;
    try{
      await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      begun=true;
      const session=(await queryRows<{database:string;version:string;session_user:string;
        current_user:string;readonly:string;ssl:boolean}>(connection,
        "SELECT current_database() database,current_setting('server_version_num') version,"+
        "session_user,current_user,current_setting('transaction_read_only') readonly,"+
        "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) ssl"))[0];
      if(session?.database!=="camacho_pos_preprod"||session.version!=="160014"||
         session.session_user!=="pos_migrator"||session.current_user!=="pos_migrator"||
         session.readonly!=="on"||session.ssl!==true)
        throw Error("PREPROD_005_TARGET_OR_TLS_INVALID");
      await executeRaw(connection,"SET LOCAL ROLE pos_schema_owner");
      const owner=(await queryRows<{session_user:string;current_user:string}>(
        connection,"SELECT session_user,current_user"))[0];
      if(owner?.session_user!=="pos_migrator"||owner.current_user!=="pos_schema_owner")
        throw Error("PREPROD_005_OWNER_ROLE_INVALID");

      const ledger=await queryRows<{migration_id:string;execution_id:string;status:string;checksum_hex:string}>(connection,
        "SELECT migration_id,execution_id::text execution_id,status,encode(checksum,'hex') checksum_hex "+
        "FROM platform.target_migration_executions WHERE migration_id IN ("+
        "'001_central_foundation','002_external_integrations_foundation',"+
        "'003_fiscal_electronic_invoicing_foundation','004_device_trust',"+
        "'005_onboarding_bootstrap_hardening') ORDER BY migration_id");
      for(const expected of hashes.slice(0,4)){
        const records=ledger.filter(row=>row.migration_id===expected.id);
        if(records.length!==1||records[0]?.status!=="APPLIED"||
           records[0].checksum_hex!==expected.sha)
          throw Error("PREPROD_005_PREDECESSOR_LEDGER_INVALID");
      }
      for(const [receipt,id] of [
        [receipt003,POSTGRES_003_DESCRIPTOR.migrationId],
        [receipt004,POSTGRES_004_DESCRIPTOR.migrationId],
      ] as const){
        if(ledger.find(row=>row.migration_id===id)?.execution_id!==receipt.receipt_payload?.execution_id)
          throw Error("PREPROD_005_RECEIPT_LEDGER_MISMATCH");
      }
      if(ledger.some(row=>row.migration_id===POSTGRES_005_DESCRIPTOR.migrationId))
        throw Error("PREPROD_005_HISTORY_EXISTS_RECONCILIATION_REQUIRED");
      await validatePostgres003Catalog(connection);
      const deviceTables=await queryRows<{name:string;present:boolean}>(connection,
        "SELECT name,to_regclass(name) IS NOT NULL present FROM (VALUES "+
        DEVICE_TRUST_004_TABLES.map(name=>"('"+name+"')").join(",")+
        ") t(name)");
      if(deviceTables.length!==4||deviceTables.some(row=>!row.present))
        throw Error("PREPROD_005_004_DEVICE_CATALOG_MISSING");

      const onboarding=(await queryRows<{owner_name:string;column_present:boolean;index_present:boolean;
        actor_platform_insert:boolean;actor_platform_select:boolean}>(connection,
        "SELECT pg_get_userbyid(c.relowner) owner_name,"+
        "EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid "+
        "AND a.attname='commercial_reference' AND a.attnum>0 AND NOT a.attisdropped) column_present,"+
        "to_regclass('tenancy.onboarding_operations_commercial_reference_uq') IS NOT NULL index_present,"+
        "has_table_privilege('pos_platform_app',c.oid,'INSERT') actor_platform_insert,"+
        "has_table_privilege('pos_platform_app',c.oid,'SELECT') actor_platform_select "+
        "FROM pg_class c WHERE c.oid='tenancy.onboarding_operations'::regclass"))[0];
      if(onboarding?.owner_name!=="pos_schema_owner"||
         onboarding.column_present||onboarding.index_present||
         !onboarding.actor_platform_insert||!onboarding.actor_platform_select)
        throw Error("PREPROD_005_ONBOARDING_BASELINE_INVALID");
      const policies=await queryRows<{name:string}>(connection,
        "SELECT polname name FROM pg_policy WHERE polrelid='tenancy.onboarding_operations'::regclass");
      if(policies.some(row=>[
        "onboarding_operations_actor_select","onboarding_operations_bootstrap_insert",
        "onboarding_operations_actor_update",
      ].includes(row.name)))
        throw Error("PREPROD_005_POLICIES_ALREADY_PRESENT");

      process.stdout.write("PREPROD_005_TLS_VERIFY_FULL: PASS\n");
      process.stdout.write("PREPROD_005_PREDECESSOR_RECEIPTS: VERIFIED\n");
      process.stdout.write("PREPROD_005_LEDGER_001_004: APPLIED_CHECKSUM_VALID\n");
      process.stdout.write("PREPROD_005_FISCAL_CATALOG: VALID\n");
      process.stdout.write("PREPROD_005_DEVICE_TABLES_004: PRESENT\n");
      process.stdout.write("PREPROD_005_HISTORY: ABSENT\n");
      process.stdout.write("PREPROD_005_ONBOARDING_BASELINE: VALID\n");
      process.stdout.write("PREPROD_005_UP_ARTIFACT_SHA256: "+hashes[4]?.sha+"\n");
    }finally{
      if(begun){
        try{await executeRaw(connection,"ROLLBACK");rolledBack=true}catch{rolledBack=false}
      }
    }
  });
}finally{await db.destroy()}
if(!rolledBack)throw Error("PREPROD_005_ROLLBACK_NOT_CONFIRMED");
process.stdout.write("PREPROD_005_READ_ONLY_ROLLBACK: CONFIRMED\n");
process.stdout.write("PREPROD_005_INSPECTION: PASS\n");
process.stdout.write("POSTGRES_005_NOT_APPLIED_OR_SMOKE_VERIFIED\n");
