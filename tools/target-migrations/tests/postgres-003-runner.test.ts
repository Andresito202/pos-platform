import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresDatabase, executeRaw, queryRows } from "../src/database.js";
import { applyPostgres001, applyPostgres002, postgresRoleUrls } from "../src/postgres.js";
import { applyRoleReadiness, type RoleReadinessConfig } from "../src/postgres-003-role-readiness.js";
import { applyPostgres003, downPostgres003 } from "../src/postgres-003-runner.js";
import { validatePostgres003Catalog } from "../src/postgres-003-introspection.js";
import { POSTGRES_003_DESCRIPTOR } from "../src/contract.js";
import { validatePostgres002Catalog } from "../src/postgres-introspection.js";

const SERVER_URL=process.env.POSTGRES_TEST_URL??"postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES=["target_003_runner","target_003_down_guard"] as const;
const COMMIT="e615eec222f72c1277e300509bf29cd67ae362c7";
let tempDirectory="";
function adminUrl(name:string):string{const url=new URL(SERVER_URL);url.pathname=`/${name}`;return url.toString();}
function receipt(label:string):string{return join(tempDirectory,`${label}.json`);}
function readiness(name:string,path:string):RoleReadinessConfig{
  const roles=postgresRoleUrls(adminUrl(name));
  return {provisioningUrl:roles.pos_migrator!,verificationUrl:roles.pos_platform_admin!,environmentId:`test-${name}`,expectedDatabase:name,repositoryCommit:COMMIT,operatorOrJobId:"vitest",receiptOutputPath:path};
}
async function recreate():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES){await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await pool.query(`CREATE DATABASE "${name}"`);}}finally{await pool.end();}}
async function drop():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES)await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);}finally{await pool.end();}}
async function prepare(name:string):Promise<void>{
  await applyPostgres001({adminUrl:adminUrl(name),skipSmoke:true});
  await applyPostgres002({adminUrl:adminUrl(name),skipSmoke:true});
  const result=await applyRoleReadiness(readiness(name,receipt(`readiness-${name}`)));
  expect(["READY_WITH_RECEIPT","READY_NO_OP"]).toContain(result.result);
}

describe("003 runner / introspection / smoke slice",()=>{
  beforeAll(async()=>{tempDirectory=await mkdtemp(join(tmpdir(),"pos-003-runner-"));await recreate();for(const name of DATABASES)await prepare(name);},180_000);
  afterAll(async()=>{await drop();await rm(tempDirectory,{recursive:true,force:true});},120_000);

  it("applies, introspects, no-ops, downs to exact 002 and reapplies",async()=>{
    const name=DATABASES[0];const firstReceipt=receipt("apply-first");
    const config={adminUrl:adminUrl(name),expectedDatabase:name,environmentId:`test-${name}`,repositoryCommit:COMMIT,receiptOutputPath:firstReceipt};
    const first=await applyPostgres003(config);
    expect(first).toMatchObject({noOp:false,result:"APPLIED_WITH_RECEIPT"});
    const db=postgresDatabase(adminUrl(name),1);
    try{
      await validatePostgres003Catalog(db);
      await executeRaw(db,"DROP POLICY fiscal_connections_tenant_isolation ON fiscal.fiscal_connections; CREATE POLICY fiscal_connections_tenant_isolation ON fiscal.fiscal_connections TO pos_app,pos_worker,pos_platform_app USING (true) WITH CHECK (true);");
      await expect(validatePostgres003Catalog(db)).rejects.toThrow("policy definition diverges");
      await executeRaw(db,"DROP POLICY fiscal_connections_tenant_isolation ON fiscal.fiscal_connections; "+POSTGRES_003_DESCRIPTOR.exactPolicyDefinitions.fiscal_connections_tenant_isolation);
      await executeRaw(db,"GRANT DELETE ON fiscal.fiscal_artifacts TO pos_worker");
      await expect(validatePostgres003Catalog(db)).rejects.toThrow("unexpected fiscal runtime privileges");
      await executeRaw(db,"REVOKE DELETE ON fiscal.fiscal_artifacts FROM pos_worker");
      await validatePostgres003Catalog(db);
      const ledger=await queryRows<{status:string;runner_version:string}>(db,"SELECT status,runner_version FROM platform.target_migration_executions WHERE migration_id='003_fiscal_electronic_invoicing_foundation' ORDER BY started_at DESC LIMIT 1");
      expect(ledger[0]?.status).toBe("APPLIED");expect(ledger[0]?.runner_version).toContain(COMMIT);
    }finally{await db.destroy();}
    const repeat=await applyPostgres003({...config,receiptOutputPath:receipt("unused-noop")});
    expect(repeat).toMatchObject({noOp:true,result:"ALREADY_APPLIED",executionId:first.executionId});
    await downPostgres003({...config,applyReceiptPath:firstReceipt,confirmFreshTestDown:true});
    const downDb=postgresDatabase(adminUrl(name),1);try{await validatePostgres002Catalog(downDb);}finally{await downDb.destroy();}
    const second=await applyPostgres003({...config,receiptOutputPath:receipt("apply-second")});
    expect(second).toMatchObject({noOp:false,result:"APPLIED_WITH_RECEIPT"});
  },120_000);

  it("refuses down when 003-owned DEBIT_NOTES history exists",async()=>{
    const name=DATABASES[1];const applyReceipt=receipt("guard-apply");
    const config={adminUrl:adminUrl(name),expectedDatabase:name,environmentId:`test-${name}`,repositoryCommit:COMMIT,receiptOutputPath:applyReceipt};
    await applyPostgres003(config);
    const db=postgresDatabase(adminUrl(name),1);
    try{await executeRaw(db,`
      SET ROLE pos_schema_owner;
      INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at)
      VALUES ('018f3000-0000-7000-8000-000000000010','RUNNER_GUARD','Runner Guard','ERP_ACCOUNTING','ACTIVE',clock_timestamp(),clock_timestamp());
      INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at)
      VALUES ('018f3000-0000-7000-8000-000000000011','018f3000-0000-7000-8000-000000000010','runner-guard','1.0.0',1,'IMPLEMENTED','NOT_EVALUATED',clock_timestamp());
      INSERT INTO integrations.provider_capability_declarations(id,provider_id,provider_adapter_version_id,capability_code,support_status,created_at)
      VALUES ('018f3000-0000-7000-8000-000000000012','018f3000-0000-7000-8000-000000000010','018f3000-0000-7000-8000-000000000011','DEBIT_NOTES','SUPPORTED',clock_timestamp());
      RESET ROLE;
    `);}finally{await db.destroy();}
    await expect(downPostgres003({...config,applyReceiptPath:applyReceipt,confirmFreshTestDown:true})).rejects.toThrow("history exists");
  },120_000);
});
