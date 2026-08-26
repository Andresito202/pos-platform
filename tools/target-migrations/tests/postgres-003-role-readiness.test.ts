import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postgresRoleUrls, applyPostgres001, applyPostgres002 } from "../src/postgres.js";
import {
  applyRoleReadiness,
  canonicalJson,
  checkRoleReadiness,
  classifyRoleReadiness,
  freshAdminPostcheck,
  inspectRoleReadinessAcl,
  revertRoleReadiness,
  validateRoleReadinessReceipt,
  validateRoleReadinessReversal,
  type RoleReadinessAclSnapshot,
  type RoleReadinessConfig,
  type RoleReadinessReceipt,
  ROLE_READINESS_AUTOMATIC_REVERSAL_COMPATIBLE_VERSIONS,
  ROLE_READINESS_LIFECYCLE_CONTRACT_VERSION,
  ROLE_READINESS_RECEIPT_VERSION,
} from "../src/postgres-003-role-readiness.js";
import { postgresDatabase } from "../src/database.js";
import { validatePostgres002Catalog } from "../src/postgres-introspection.js";
import { POSTGRES_MIGRATION_LOCK_RESOURCE, sha256 } from "../src/shared.js";

const SERVER_URL=process.env.POSTGRES_TEST_URL??"postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES=["role_readiness_core","role_readiness_publication","role_readiness_security"] as const;
const COMMIT="ef1f05322252aa22428686a355be8735b6618ff5";
let tempDirectory="";

function adminUrl(name:string):string{const url=new URL(SERVER_URL);url.pathname=`/${name}`;return url.toString();}
function config(name:string,path?:string):RoleReadinessConfig{const roles=postgresRoleUrls(adminUrl(name));return {provisioningUrl:roles.pos_migrator!,verificationUrl:roles.pos_platform_admin!,environmentId:`test-${name}`,expectedDatabase:name,repositoryCommit:COMMIT,operatorOrJobId:"vitest",...(path?{receiptOutputPath:path}:{})};}
async function server(statement:string):Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{await pool.query(statement);}finally{await pool.end();}}
async function inDatabase(name:string,statement:string):Promise<void>{const pool=new Pool({connectionString:adminUrl(name)});try{await pool.query(statement);}finally{await pool.end();}}
async function restoreRoles():Promise<void>{await server(`ALTER ROLE pos_schema_owner NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;ALTER ROLE pos_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;ALTER ROLE pos_platform_admin LOGIN NOSUPERUSER BYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;REVOKE pos_reporting FROM pos_platform_admin;GRANT pos_schema_owner TO pos_migrator WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);}
async function missing(name:string):Promise<void>{await inDatabase(name,"REVOKE SELECT (migration_id,status,checksum) ON platform.target_migration_executions FROM pos_platform_admin; REVOKE SELECT ON platform.target_migration_executions FROM pos_platform_admin; REVOKE USAGE,CREATE ON SCHEMA platform FROM pos_platform_admin; REVOKE ALL ON platform.target_migration_executions FROM PUBLIC; REVOKE ALL ON SCHEMA platform FROM PUBLIC");}
async function snapshot(name:string):Promise<RoleReadinessAclSnapshot>{const db=postgresDatabase(adminUrl(name),1);try{return await inspectRoleReadinessAcl(db);}finally{await db.destroy();}}
function receiptPath(label:string):string{return join(tempDirectory,`${label}.json`);}

describe("MAT-003 canonical role readiness materialization",()=>{
  beforeAll(async()=>{
    tempDirectory=await mkdtemp(join(tmpdir(),"pos-role-readiness-"));
    const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES){await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await pool.query(`CREATE DATABASE "${name}"`);}}finally{await pool.end();}
    for(const name of DATABASES){await applyPostgres001({adminUrl:adminUrl(name),skipSmoke:true});await applyPostgres002({adminUrl:adminUrl(name),skipSmoke:true});}
    await restoreRoles();
  },120_000);
  beforeEach(async()=>{await restoreRoles();for(const name of DATABASES)await missing(name);});
  afterAll(async()=>{await restoreRoles();const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES)await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);}finally{await pool.end();await rm(tempDirectory,{recursive:true,force:true});}},120_000);

  it("acepta la membresía exacta y clasifica MISSING",async()=>{
    expect(await checkRoleReadiness(config(DATABASES[0]))).toMatchObject({result:"PASS",state:"MISSING"});
    expect(classifyRoleReadiness(await snapshot(DATABASES[0]))).toBe("MISSING");
  });

  it.each([
    ["set_option","GRANT pos_schema_owner TO pos_migrator WITH SET FALSE, INHERIT FALSE, ADMIN FALSE"],
    ["inherit_option","GRANT pos_schema_owner TO pos_migrator WITH SET TRUE, INHERIT TRUE, ADMIN FALSE"],
    ["admin_option","GRANT pos_schema_owner TO pos_migrator WITH SET TRUE, INHERIT FALSE, ADMIN TRUE"],
  ])("rechaza membresía con %s incorrecto",async(_label,statement)=>{
    await server(statement);try{expect(await checkRoleReadiness(config(DATABASES[0]))).toMatchObject({result:"FAIL",failure_code:"MEMBERSHIP_CONTRACT_INVALID"});}finally{await restoreRoles();}
  });

  it("clasifica PARTIAL y falla cerrado sin reparación",async()=>{
    await inDatabase(DATABASES[0],"SET ROLE pos_schema_owner; GRANT USAGE ON SCHEMA platform TO pos_platform_admin; RESET ROLE");
    expect(classifyRoleReadiness(await snapshot(DATABASES[0]))).toBe("PARTIAL");
    expect(await checkRoleReadiness(config(DATABASES[0]))).toMatchObject({result:"FAIL",failure_code:"PARTIAL_STATE"});
    const path=receiptPath("partial");expect(await applyRoleReadiness(config(DATABASES[0],path))).toMatchObject({result:"FAIL",failure_code:"PARTIAL_STATE"});await expect(readFile(path,"utf8")).rejects.toMatchObject({code:"ENOENT"});
  });

  it.each([
    ["SELECT de tabla","SET ROLE pos_schema_owner; GRANT SELECT ON platform.target_migration_executions TO pos_platform_admin; RESET ROLE"],
    ["GRANT OPTION","SET ROLE pos_schema_owner; GRANT USAGE ON SCHEMA platform TO pos_platform_admin WITH GRANT OPTION; RESET ROLE"],
    ["ruta PUBLIC","GRANT USAGE ON SCHEMA platform TO PUBLIC"],
    ["ruta por membresía","GRANT pos_reporting TO pos_platform_admin WITH SET TRUE, INHERIT TRUE, ADMIN FALSE"],
  ])("clasifica como UNEXPECTED: %s",async(_label,statement)=>{
    await inDatabase(DATABASES[0],statement).catch(async()=>server(statement));
    try{expect(classifyRoleReadiness(await snapshot(DATABASES[0]))).toBe("UNEXPECTED");expect(await checkRoleReadiness(config(DATABASES[0]))).toMatchObject({result:"FAIL",failure_code:_label==="ruta por membresía"?"MEMBERSHIP_CONTRACT_INVALID":"UNEXPECTED_STATE"});expect(await applyRoleReadiness(config(DATABASES[0],receiptPath(`unexpected-${_label}`)))).toMatchObject({result:"FAIL",failure_code:_label==="ruta por membresía"?"MEMBERSHIP_CONTRACT_INVALID":"UNEXPECTED_STATE"});}finally{if(_label==="ruta por membresía")await server("REVOKE pos_reporting FROM pos_platform_admin");}
  });

  it.each([
    ["PARTIAL","SET ROLE pos_schema_owner; GRANT USAGE ON SCHEMA platform TO pos_platform_admin; RESET ROLE"],
    ["UNEXPECTED","SET ROLE pos_schema_owner; GRANT SELECT ON platform.target_migration_executions TO pos_platform_admin; RESET ROLE"],
  ])("el postcheck fresco esperado READY rechaza %s",async(_state,statement)=>{
    await inDatabase(DATABASES[0],statement);await expect(freshAdminPostcheck(config(DATABASES[0]),"READY")).rejects.toThrow("CURRENT_SECURITY_STATE_MISMATCH");
  });

  it("el postcheck fresco esperado MISSING rechaza READY",async()=>{
    await inDatabase(DATABASES[0],"SET ROLE pos_schema_owner; GRANT USAGE ON SCHEMA platform TO pos_platform_admin; GRANT SELECT (migration_id,status,checksum) ON platform.target_migration_executions TO pos_platform_admin; RESET ROLE");
    await expect(freshAdminPostcheck(config(DATABASES[0]),"MISSING")).rejects.toThrow("CURRENT_SECURITY_STATE_MISMATCH");
  });

  it("aplica exactamente el delta, verifica con conexión fresca, no duplica recibo y revierte al MISSING exacto",async()=>{
    const path=receiptPath("lifecycle");const before=await snapshot(DATABASES[0]);const businessBefore=await businessCounts(DATABASES[0]);const integrationsBefore=await integrationsAcl(DATABASES[0]);await assertCatalog(DATABASES[0]);
    const applied=await applyRoleReadiness(config(DATABASES[0],path));
    expect(applied).toMatchObject({result:"READY_WITH_RECEIPT",state:"READY",receipt_path:path});
    expect(applied.operation_id).toMatch(/^[0-9a-f-]{36}$/);expect(applied.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
    const parsed=validateRoleReadinessReceipt(JSON.parse(await readFile(path,"utf8")));
    expect(sha256(canonicalJson(parsed.receipt_payload)).toString("hex")).toBe(parsed.receipt_sha256);
    expect(parsed.receipt_payload.identities).toMatchObject({session_user:"pos_migrator",effective_role:"pos_schema_owner",target_role:"pos_platform_admin"});
    expect(parsed.receipt_payload).toMatchObject({
      receipt_version: ROLE_READINESS_RECEIPT_VERSION,
      lifecycle_contract_version: ROLE_READINESS_LIFECYCLE_CONTRACT_VERSION,
      governance: {
        sql_003: "ABSENT",
        descriptor_003: "PRESENT_UNAPPLIED",
        migration_003_ledger_entries: 0,
        fiscal_schema: "ABSENT",
      },
    });
    const after=await snapshot(DATABASES[0]);expect(classifyRoleReadiness(after)).toBe("READY");
    expect(after.schema.entries.filter(entry=>entry.grantee==="pos_platform_admin")).toEqual([{grantee:"pos_platform_admin",grantor:"pos_schema_owner",privilege:"USAGE",is_grantable:false}]);
    expect(after.table.entries.filter(entry=>entry.grantee==="pos_platform_admin")).toEqual([]);
    expect(after.columns.flatMap(column=>column.entries.filter(entry=>entry.grantee==="pos_platform_admin").map(entry=>[column.column_name,entry.privilege,entry.grantor,entry.is_grantable]))).toEqual([["checksum","SELECT","pos_schema_owner",false],["migration_id","SELECT","pos_schema_owner",false],["status","SELECT","pos_schema_owner",false]]);
    expect(after.effective).toMatchObject({schema_usage:true,schema_create:false,table_select:false});
    expect(after.effective.columns.filter(column=>column.select).map(column=>column.column_name)).toEqual(["checksum","migration_id","status"]);
    expect(after.effective.writes.every(item=>!item.allowed)).toBe(true);expect(after.memberships).toEqual([]);expect(after.ownership.every(item=>item.owner==="pos_schema_owner")).toBe(true);
    const secondPath=receiptPath("must-not-exist");expect(await applyRoleReadiness(config(DATABASES[0],secondPath))).toMatchObject({result:"READY_NO_OP",operation_id:null,receipt_path:null});
    await expect(readFile(secondPath,"utf8")).rejects.toMatchObject({code:"ENOENT"});
    expect(await validateRoleReadinessReversal(config(DATABASES[0]),path)).toEqual({status:"VALID_FOR_REVERSAL"});
    const reverted=await revertRoleReadiness(config(DATABASES[0]),path);expect(reverted.failure_code).toBe(null);expect(reverted).toMatchObject({result:"REVERTED",state:"MISSING"});
    expect(await snapshot(DATABASES[0])).toEqual(before);expect(await businessCounts(DATABASES[0])).toEqual(businessBefore);expect(await integrationsAcl(DATABASES[0])).toEqual(integrationsBefore);await assertCatalog(DATABASES[0]);
  });

  it("falla rápido por contención del lock y no concede",async()=>{
    const pool=new Pool({connectionString:adminUrl(DATABASES[0])});let client:PoolClient|undefined;
    try{client=await pool.connect();await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[POSTGRES_MIGRATION_LOCK_RESOURCE]);expect(await applyRoleReadiness(config(DATABASES[0],receiptPath("locked")))).toMatchObject({result:"FAIL",failure_code:"GLOBAL_LOCK_UNAVAILABLE"});expect(classifyRoleReadiness(await snapshot(DATABASES[0]))).toBe("MISSING");}finally{await client?.query("ROLLBACK");client?.release();await pool.end();}
  });

  it("no sobrescribe un destino existente y reporta el límite post-commit con grants READY",async()=>{
    const path=receiptPath("existing");await writeFile(path,"sentinel","utf8");const result=await applyRoleReadiness(config(DATABASES[1],path));
    expect(result).toMatchObject({result:"APPLIED_WITHOUT_DURABLE_RECEIPT",failure_code:"RECEIPT_PUBLICATION_FAILED",receipt_path:null,receipt_sha256:null});
    expect(await readFile(path,"utf8")).toBe("sentinel");expect(classifyRoleReadiness(await snapshot(DATABASES[1]))).toBe("READY");
    expect(await validateRoleReadinessReversal(config(DATABASES[1]),undefined)).toEqual({status:"RECEIPT_MISSING"});
  });

  it("rechaza recibos parciales, campos desconocidos, versiones y payload manipulados",async()=>{
    const path=receiptPath("validation-source");await applyRoleReadiness(config(DATABASES[0],path));const valid=JSON.parse(await readFile(path,"utf8")) as RoleReadinessReceipt;
    expect(()=>validateRoleReadinessReceipt({...valid,unknown:true})).toThrow("INVALID_RECEIPT");
    expect(()=>validateRoleReadinessReceipt({...valid,receipt_payload:{...valid.receipt_payload,receipt_version:3}})).toThrow("INVALID_RECEIPT");
    expect(()=>validateRoleReadinessReceipt({...valid,receipt_payload:{...valid.receipt_payload,lifecycle_contract_version:3}})).toThrow("INVALID_RECEIPT");
    expect(()=>validateRoleReadinessReceipt({...valid,receipt_payload:{...valid.receipt_payload,receipt_version:1,lifecycle_contract_version:2}})).toThrow("INVALID_RECEIPT");
    expect(()=>validateRoleReadinessReceipt({...valid,receipt_payload:{...valid.receipt_payload,repository_commit:"0".repeat(40)}})).toThrow("RECEIPT_INTEGRITY_FAILURE");
    const partial=receiptPath("partial-json");await writeFile(partial,'{"receipt_payload":',"utf8");expect(await validateRoleReadinessReversal(config(DATABASES[0]),partial)).toEqual({status:"INVALID_RECEIPT"});
  });

  it("mantiene validación backwards-compatible de receipts lifecycle v1",async()=>{
    const path=receiptPath("v1-source");await applyRoleReadiness(config(DATABASES[0],path));
    const current=JSON.parse(await readFile(path,"utf8")) as RoleReadinessReceipt;
    const legacyPayload={
      ...current.receipt_payload,
      receipt_version:1 as const,
      lifecycle_contract_version:1 as const,
      governance:{sql_003:"ABSENT" as const,descriptor_003:"ABSENT" as const,migration_003_ledger_entries:0 as const,fiscal_schema:"ABSENT" as const},
    };
    const legacy:RoleReadinessReceipt={receipt_payload:legacyPayload,receipt_sha256:sha256(canonicalJson(legacyPayload)).toString("hex")};
    expect(validateRoleReadinessReceipt(legacy)).toEqual(legacy);
    expect(ROLE_READINESS_AUTOMATIC_REVERSAL_COMPATIBLE_VERSIONS).toEqual([1,2]);
  });

  it("rechaza reversión sin recibo, target distinto, digest alterado y ACL cambiada",async()=>{
    const path=receiptPath("unsafe");await applyRoleReadiness(config(DATABASES[0],path));
    expect(await validateRoleReadinessReversal(config(DATABASES[0]),undefined)).toEqual({status:"RECEIPT_MISSING"});
    expect(await validateRoleReadinessReversal({...config(DATABASES[0]),environmentId:"other"},path)).toEqual({status:"TARGET_MISMATCH"});
    expect(await validateRoleReadinessReversal({...config(DATABASES[0]),expectedDatabase:"other"},path)).toEqual({status:"TARGET_MISMATCH"});
    const receipt=JSON.parse(await readFile(path,"utf8")) as RoleReadinessReceipt;receipt.receipt_sha256="0".repeat(64);const altered=receiptPath("digest");await writeFile(altered,JSON.stringify(receipt),"utf8");expect(await validateRoleReadinessReversal(config(DATABASES[0]),altered)).toEqual({status:"RECEIPT_INTEGRITY_FAILURE"});
    await inDatabase(DATABASES[0],"SET ROLE pos_schema_owner; GRANT SELECT (error_code) ON platform.target_migration_executions TO pos_platform_admin; RESET ROLE");
    expect(await validateRoleReadinessReversal(config(DATABASES[0]),path)).toEqual({status:"CURRENT_SECURITY_STATE_MISMATCH"});expect(await revertRoleReadiness(config(DATABASES[0]),path)).toMatchObject({result:"FAIL",failure_code:"CURRENT_SECURITY_STATE_MISMATCH"});
  });

  it("bloquea reversión cuando la declaración local deja de reconocer lifecycle v1",async()=>{
    const path=receiptPath("compatibility");await applyRoleReadiness(config(DATABASES[0],path));const versions=ROLE_READINESS_AUTOMATIC_REVERSAL_COMPATIBLE_VERSIONS as unknown as number[];const saved=[...versions];versions.length=0;
    try{expect(await validateRoleReadinessReversal(config(DATABASES[0]),path)).toEqual({status:"LATER_DEPENDENCY_NOT_PROVEN_SAFE"});}finally{versions.push(...saved);}
  });

  it("rechaza cambios de rol, membresía y ownership antes de DOWN",async()=>{
    const cases=[
      ["role",async()=>server("ALTER ROLE pos_platform_admin INHERIT"),async()=>restoreRoles()],
      ["membership",async()=>server("GRANT pos_reporting TO pos_platform_admin WITH SET TRUE, INHERIT TRUE, ADMIN FALSE"),async()=>server("REVOKE pos_reporting FROM pos_platform_admin")],
      ["owner",async()=>inDatabase(DATABASES[2],"ALTER SCHEMA platform OWNER TO pos_platform_admin"),async()=>inDatabase(DATABASES[2],"ALTER SCHEMA platform OWNER TO pos_schema_owner")],
    ] as const;
    for(const [label,mutate,restore] of cases){await missing(DATABASES[2]);const path=receiptPath(`security-${label}`);const applied=await applyRoleReadiness(config(DATABASES[2],path));expect(applied.result,label).toBe("READY_WITH_RECEIPT");await mutate();try{const status=await validateRoleReadinessReversal(config(DATABASES[2]),path);expect(["CURRENT_SECURITY_STATE_MISMATCH","CATALOG_OR_PREDECESSOR_INVALID"],label).toContain(status.status);}finally{await restore();}}
  });

  it("no expone raw-up, raw-down ni ejecución directa de down.sql",async()=>{
    const packageJson=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8")) as {scripts:Record<string,string>};
    expect(Object.keys(packageJson.scripts).some(name=>/raw|down-sql/i.test(name))).toBe(false);expect(packageJson.scripts["role-readiness:003:revert"]).toContain(" revert");
  });
});

async function businessCounts(name:string):Promise<Record<string,string>>{const pool=new Pool({connectionString:adminUrl(name)});try{return(await pool.query<Record<string,string>>(`SELECT
  (SELECT count(*)::text FROM identity.users) users,
  (SELECT count(*)::text FROM integrations.external_integrations) integrations,
  (SELECT count(*)::text FROM integrations.integration_dispatches) dispatches`)).rows[0]!;}finally{await pool.end();}}
async function integrationsAcl(name:string):Promise<unknown[]>{const pool=new Pool({connectionString:adminUrl(name)});try{return(await pool.query(`SELECT 'schema' kind,nspname object_name,nspacl::text acl FROM pg_namespace WHERE nspname='integrations' UNION ALL SELECT 'table',c.relname,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='integrations' AND c.relkind='r' UNION ALL SELECT 'column',c.relname||'.'||a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='integrations' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2`)).rows;}finally{await pool.end();}}
async function assertCatalog(name:string):Promise<void>{const db=postgresDatabase(adminUrl(name),1);try{await validatePostgres002Catalog(db);}finally{await db.destroy();}}
