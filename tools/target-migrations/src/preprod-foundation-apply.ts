/**
 * Camacho POS Windows preproduction: explicit and guarded canonical
 * PostgreSQL foundation migration 001 -> 002, nothing else.
 *
 * --inspect: read-only (default)
 * --apply-foundation: imports real role/TLS/invalid-password gate first, then
 * invokes existing official runners. Never changes TLS, passwords or pg_hba.
 * Run only on the dedicated, owner-approved fresh port 55435 database.
 */
import {existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {Client} from "pg";
import {applyPostgres001,applyPostgres002} from "./postgres.js";

const args=process.argv.slice(2);
if(args.length>1||args.some(x=>x!=="--inspect"&&x!=="--apply-foundation")){
  throw Error("PREPROD_FOUNDATION_USAGE: --inspect OR --apply-foundation");
}
const apply=args.includes("--apply-foundation");
const root=process.env.LOCALAPPDATA;
if(process.platform!=="win32"||!root)throw Error("PREPROD_FOUNDATION_WINDOWS_REQUIRED");
const privateDir=join(root,"CamachoPOS","preprod");
const passfile=join(privateDir,"pgpass.conf");
const ca=join(privateDir,"pg-server-ca.crt");
if(!existsSync(passfile)||!existsSync(ca))throw Error("PREPROD_FOUNDATION_MANAGED_FILES_MISSING");
if(process.env.PGPASSWORD!==undefined)throw Error("PREPROD_FOUNDATION_GENERIC_PASSWORD_ENV_FORBIDDEN");
process.env.PGPASSFILE=passfile;
const repoRoot=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const git=(args:string[])=>execFileSync("git",args,{cwd:repoRoot,encoding:"utf8"}).trim();
if(git(["branch","--show-current"])!=="feat/p0-windows-login-install-readiness")throw Error("PREPROD_FOUNDATION_BRANCH_MISMATCH");
if(git(["status","--porcelain=v1"])!=="")throw Error("PREPROD_FOUNDATION_WORKTREE_DIRTY");
const sha=git(["rev-parse","HEAD"]);
if(!/^[0-9a-f]{40}$/.test(sha))throw Error("PREPROD_FOUNDATION_SHA_NOT_VERIFIED");

// Credential-free URL: pgpass is used only for the exact approved roles.
// Both PostgreSQL and Node TLS verify the pinned server certificate IP SAN.
function urlFor(user:string){
  const url=new URL("postgresql://127.0.0.1:55435/camacho_pos_preprod");
  url.username=user;
  url.searchParams.set("sslmode","verify-full");
  url.searchParams.set("sslrootcert",ca);
  return url.toString();
}
const adminUrl=urlFor("postgres");
const client=new Client({connectionString:adminUrl,connectionTimeoutMillis:8000});
let ledgerState="ABSENT";
try{
  await client.connect();
  const result=await client.query<{
    db:string;account:string;ssl:boolean;version:string;ledger:string;tableCount:string;
  }>("SELECT current_database() AS db,current_user AS account,"+
    " (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,"+
    " current_setting('server_version_num') AS version,"+
    " CASE WHEN to_regclass('platform.target_migration_executions') IS NULL THEN 'ABSENT' ELSE 'PRESENT' END AS ledger,"+
    " (SELECT count(*)::text FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS \"tableCount\"");
  const r=result.rows[0];
  if(!r||r.db!=="camacho_pos_preprod"||r.account!=="postgres"||
     !r.ssl||r.version!=="160014")throw Error("PREPROD_FOUNDATION_TARGET_TLS_OR_IDENTITY_REJECTED");
  ledgerState=r.ledger;
  if(ledgerState==="ABSENT"&&r.tableCount!=="0"){
    throw Error("PREPROD_FOUNDATION_NONEMPTY_SCHEMA_WITHOUT_LEDGER");
  }
  if(ledgerState==="PRESENT"){
    const history=await client.query<{migration_id:string;status:string}>(
      "SELECT migration_id,status FROM platform.target_migration_executions ORDER BY migration_id");
    const allowed=new Set(["001_central_foundation","002_external_integrations_foundation"]);
    if(history.rows.some(x=>!allowed.has(x.migration_id)||x.status!=="APPLIED")){
      throw Error("PREPROD_FOUNDATION_UNAPPROVED_OR_INCOMPLETE_LEDGER");
    }
  }
  process.stdout.write("FOUNDATION_DATABASE_TLS_TARGET: PASS\n");
  process.stdout.write("FOUNDATION_LEDGER: "+ledgerState+"\n");
  process.stdout.write("REPOSITORY_SHA: "+sha+"\n");
}finally{
  await client.end().catch(()=>undefined);
}
if(!apply){
  process.stdout.write("READ_ONLY: no schema, data or role changes\n");
  process.exit(0);
}
// This real external database check must pass before ANY migration.
await import("./preprod-role-client-gate.js");
const one=await applyPostgres001({adminUrl});
process.stdout.write("FOUNDATION_001: "+(one.noOp?"ALREADY_APPLIED":"APPLIED")+"\n");
const two=await applyPostgres002({adminUrl});
process.stdout.write("FOUNDATION_002: "+(two.noOp?"ALREADY_APPLIED":"APPLIED")+"\n");
process.stdout.write("FOUNDATION_001_002: APPLIED_AND_CANONICAL_SMOKE_VERIFIED\n");
process.stdout.write("NO_OTHER_MIGRATIONS_OR_LOGIN_CERTIFICATION\n");
