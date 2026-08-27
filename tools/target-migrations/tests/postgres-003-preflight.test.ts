import { readFile, readdir } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE,
  MAT003_PREFLIGHT_REQUIRED_SCHEMAS,
  MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS,
  MAT003_PREFLIGHT_REQUIRED_TABLES,
  mat003PreflightExitCode,
  runMat003Preflight,
} from "../src/postgres-003-preflight.js";
import { applyPostgres001, applyPostgres002 } from "../src/postgres.js";

const SERVER_URL=process.env.POSTGRES_TEST_URL??"postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES=["target_003_preflight","target_003_preflight_failure"] as const;
const ROLES={ok:"mat003_preflight_ok",noBypass:"mat003_preflight_no_bypass",missingRead:"mat003_preflight_missing_read"} as const;
const q=(value:string):string=>`"${value.replaceAll('"','""')}"`;
const id=(value:number):string=>`01900000-0000-7000-8000-${value.toString(16).padStart(12,"0")}`;
const databaseUrl=(name:string,role="postgres"):string=>{const value=new URL(SERVER_URL);value.pathname=`/${name}`;value.username=role;value.password="";return value.toString();};

const IDS={
  tenantA:id(1),companyA:id(2),providerA:id(3),adapterA:id(4),integrationA:id(5),
  tenantB:id(11),companyB:id(12),providerB:id(13),adapterB:id(14),integrationB:id(15),
  declaration:id(101),capabilityA:id(102),dispatch:id(104),attempt:id(105),operation:id(106),entity:id(107),correlation:id(108),
  ownership:id(109),mapping:id(110),configuration:id(111),otherEntity:id(112),otherMapping:id(113),scopeMapping:id(114),
  unrelatedOwnership:id(115),operationOwnership:id(116),scopeOwnership:id(117),
} as const;
interface ScopeFixture{tenant:string;company:string;provider:string;adapter:string;integration:string;code:string}
const SCOPE_A:ScopeFixture={tenant:IDS.tenantA,company:IDS.companyA,provider:IDS.providerA,adapter:IDS.adapterA,integration:IDS.integrationA,code:"PREFLIGHT_A"};
const SCOPE_B:ScopeFixture={tenant:IDS.tenantB,company:IDS.companyB,provider:IDS.providerB,adapter:IDS.adapterB,integration:IDS.integrationB,code:"PREFLIGHT_B"};

async function recreateDatabases():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES){await pool.query(`DROP DATABASE IF EXISTS ${q(name)} WITH (FORCE)`);await pool.query(`CREATE DATABASE ${q(name)}`);}}finally{await pool.end();}}
async function dropDatabases():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const name of DATABASES)await pool.query(`DROP DATABASE IF EXISTS ${q(name)} WITH (FORCE)`);}finally{await pool.end();}}
async function recreateRoles():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const role of Object.values(ROLES))await pool.query(`DROP ROLE IF EXISTS ${q(role)}`);await pool.query(`CREATE ROLE ${q(ROLES.ok)} LOGIN NOSUPERUSER BYPASSRLS NOINHERIT`);await pool.query(`CREATE ROLE ${q(ROLES.noBypass)} LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);await pool.query(`CREATE ROLE ${q(ROLES.missingRead)} LOGIN NOSUPERUSER BYPASSRLS NOINHERIT`);}finally{await pool.end();}}
async function dropRoles():Promise<void>{const pool=new Pool({connectionString:SERVER_URL});try{for(const role of Object.values(ROLES))await pool.query(`DROP ROLE IF EXISTS ${q(role)}`);}finally{await pool.end();}}
async function grantPreflightReads(adminUrl:string,role:string):Promise<void>{
  const pool=new Pool({connectionString:adminUrl});try{
    await pool.query(`GRANT USAGE ON SCHEMA ${MAT003_PREFLIGHT_REQUIRED_SCHEMAS.map(q).join(",")} TO ${q(role)}`);
    for(const [name,columns] of Object.entries(MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS)){
      const table=name.split(".").map(q).join(".");
      await pool.query(`GRANT SELECT (${columns.map(q).join(",")}) ON ${table} TO ${q(role)}`);
    }
  }finally{await pool.end();}
}
async function cleanFixtures(pool:Pool):Promise<void>{await pool.query(`
  DELETE FROM integrations.integration_dispatch_attempts;DELETE FROM integrations.integration_dispatches;
  DELETE FROM integrations.external_reference_mappings;DELETE FROM integrations.integration_capabilities;
  DELETE FROM integrations.resource_ownership_policies;DELETE FROM integrations.integration_credential_bindings;
  DELETE FROM integrations.external_integrations;DELETE FROM integrations.provider_platform_configurations;
  DELETE FROM integrations.provider_capability_declarations;DELETE FROM integrations.provider_adapter_versions;
  DELETE FROM integrations.provider_registry;DELETE FROM organization.branches;DELETE FROM organization.companies;DELETE FROM tenancy.tenants;`);}
async function insertBase(pool:Pool,scope:ScopeFixture):Promise<void>{
  await pool.query(`INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at)VALUES($1,$2,'ACTIVE',clock_timestamp(),clock_timestamp())`,[scope.tenant,`${scope.code} Tenant`]);
  await pool.query(`INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at)VALUES($1,$2,$3,'America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())`,[scope.company,scope.tenant,`${scope.code} Company`]);
  await pool.query(`INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at)VALUES($1,$2,$3,'ERP_ACCOUNTING','ACTIVE',clock_timestamp(),clock_timestamp())`,[scope.provider,scope.code,scope.code]);
  await pool.query(`INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at)VALUES($1,$2,$3,'1.0.0',1,'DESIGNED','NOT_EVALUATED',clock_timestamp())`,[scope.adapter,scope.provider,`${scope.code.toLowerCase()}-adapter`]);
  await pool.query(`INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,'TEST','CREATED',1,clock_timestamp(),clock_timestamp())`,[scope.integration,scope.tenant,scope.company,scope.provider,scope.code,scope.adapter]);
}
async function insertDeclaration(pool:Pool):Promise<void>{await pool.query(`INSERT INTO integrations.provider_capability_declarations(id,provider_id,provider_adapter_version_id,capability_code,support_status,created_at)VALUES($1,$2,$3,'DEBIT_NOTES','SUPPORTED',clock_timestamp())`,[IDS.declaration,IDS.providerA,IDS.adapterA]);}
async function insertCapability(pool:Pool,ownership:string|null=null):Promise<void>{await pool.query(`INSERT INTO integrations.integration_capabilities(id,tenant_id,company_id,integration_id,capability_code,support_status,configuration_version,effective_from,ownership_policy_id,created_at)VALUES($1,$2,$3,$4,'DEBIT_NOTES','SUPPORTED',1,clock_timestamp()-interval '1 minute',$5,clock_timestamp())`,[IDS.capabilityA,IDS.tenantA,IDS.companyA,IDS.integrationA,ownership]);}
async function insertDispatch(pool:Pool,dispatchId=IDS.dispatch,entityId=IDS.entity,suffix="main"):Promise<void>{await pool.query(`INSERT INTO integrations.integration_dispatches(id,tenant_id,company_id,integration_id,capability_code,dispatch_class,resource_type,internal_operation_id,internal_entity_type,internal_entity_id,idempotency_key,payload_schema_version,payload_checksum,status,correlation_id,created_at,updated_at)VALUES($1,$2,$3,$4,'DEBIT_NOTES','NON_FISCAL','DEBIT_NOTE',$5,'LegacyDebitNote',$6,$7,1,repeat('a',64),'QUEUED',$8,clock_timestamp(),clock_timestamp())`,[dispatchId,IDS.tenantA,IDS.companyA,IDS.integrationA,id(1000+Number.parseInt(suffix,36)%100000),entityId,`dispatch-${suffix}`,id(200000+Number.parseInt(suffix,36)%100000)]);}
async function insertPolicy(pool:Pool,policyId:string,scope:ScopeFixture,operationScope:string):Promise<void>{await pool.query(`INSERT INTO integrations.resource_ownership_policies(id,tenant_id,company_id,integration_id,resource_type,operation_scope,authority_type,policy_version,status,effective_from,created_at)VALUES($1,$2,$3,$4,'DEBIT_NOTE',$5,'PROVIDER_AUTHORITATIVE',1,'DRAFT',clock_timestamp(),clock_timestamp())`,[policyId,scope.tenant,scope.company,scope.integration,operationScope]);}
async function insertMapping(pool:Pool,mappingId:string,scope:ScopeFixture,entityId:string,externalId:string):Promise<void>{await pool.query(`INSERT INTO integrations.external_reference_mappings(id,tenant_id,company_id,integration_id,resource_type,internal_entity_type,internal_entity_id,external_id,mapping_status,provider_metadata_schema_version,provider_metadata,created_at,updated_at)VALUES($1,$2,$3,$4,'DEBIT_NOTE','LegacyDebitNote',$5,$6,'PROPOSED',1,'{}',clock_timestamp(),clock_timestamp())`,[mappingId,scope.tenant,scope.company,scope.integration,entityId,externalId]);}
async function snapshot(pool:Pool):Promise<Record<string,unknown>>{const result=await pool.query<{snapshot:Record<string,unknown>}>(`SELECT jsonb_build_object('ledger',(SELECT coalesce(jsonb_agg(jsonb_build_array(migration_id,status,encode(checksum,'hex')) ORDER BY migration_id),'[]'::jsonb)FROM platform.target_migration_executions),'rows',(SELECT sum(n)FROM(SELECT count(*) n FROM integrations.provider_capability_declarations UNION ALL SELECT count(*)FROM integrations.provider_platform_configurations UNION ALL SELECT count(*)FROM integrations.external_integrations UNION ALL SELECT count(*)FROM integrations.resource_ownership_policies UNION ALL SELECT count(*)FROM integrations.integration_capabilities UNION ALL SELECT count(*)FROM integrations.external_reference_mappings UNION ALL SELECT count(*)FROM integrations.integration_dispatches UNION ALL SELECT count(*)FROM integrations.integration_dispatch_attempts)x),'schema_objects',(SELECT count(*)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('platform','integrations','fiscal')),'fiscal_schema',to_regnamespace('fiscal')IS NOT NULL,'ledger_003',(SELECT count(*)FROM platform.target_migration_executions WHERE migration_id LIKE '003\\_%' ESCAPE '\\'))snapshot`);return result.rows[0]!.snapshot;}
function check(result:Awaited<ReturnType<typeof runMat003Preflight>>,checkId:string){const found=result.checks.find(item=>item.check_id===checkId);expect(found,`missing check ${checkId}`).toBeDefined();return found!;}
async function grantSnapshot(pool:Pool):Promise<unknown[]>{return(await pool.query(`SELECT grantee,table_schema,table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee='${ROLES.ok}' UNION ALL SELECT grantee,object_schema,object_name,privilege_type FROM information_schema.role_usage_grants WHERE grantee='${ROLES.ok}' ORDER BY 1,2,3,4`)).rows;}
const DISPATCH_CLASS_CONSTRAINT="integration_dispatches_dispatch_class_002_ck";
async function dispatchClassConstraint(client:PoolClient):Promise<string>{return(await client.query<{definition:string}>("SELECT pg_get_constraintdef(oid,true) definition FROM pg_constraint WHERE conrelid='integrations.integration_dispatches'::regclass AND conname=$1",[DISPATCH_CLASS_CONSTRAINT])).rows[0]!.definition;}
async function replaceDispatchClassConstraint(client:PoolClient,definition:string):Promise<void>{await client.query(`ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT ${DISPATCH_CLASS_CONSTRAINT}`);await client.query(`ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT ${DISPATCH_CLASS_CONSTRAINT} ${definition}`);}

describe("MAT-003-PREFLIGHT remediated materialization",()=>{
  const mainAdmin=databaseUrl(DATABASES[0]);const failureAdmin=databaseUrl(DATABASES[1]);const canonical=databaseUrl(DATABASES[0],ROLES.ok);
  let pool:Pool;
  beforeAll(async()=>{
    await recreateDatabases();await applyPostgres001({adminUrl:mainAdmin,skipSmoke:true});await applyPostgres002({adminUrl:mainAdmin,skipSmoke:true});
    await applyPostgres001({adminUrl:failureAdmin,skipSmoke:true});await applyPostgres002({adminUrl:failureAdmin,skipSmoke:true});
    await recreateRoles();for(const role of Object.values(ROLES))await grantPreflightReads(mainAdmin,role);await grantPreflightReads(failureAdmin,ROLES.ok);
    const failurePool=new Pool({connectionString:failureAdmin});try{await failurePool.query(`INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,finished_at,runner_version,error_code)VALUES($1,'002_external_integrations_foundation','POSTGRESQL',1,decode(repeat('00',32),'hex'),'FAILED',clock_timestamp(),clock_timestamp(),'test','MISMATCH')`,[id(900)]);}finally{await failurePool.end();}
    const privilegePool=new Pool({connectionString:mainAdmin});try{await privilegePool.query(`REVOKE SELECT ON platform.target_migration_executions FROM ${q(ROLES.missingRead)}`);}finally{await privilegePool.end();}
    pool=new Pool({connectionString:mainAdmin});
  },120_000);
  beforeEach(async()=>cleanFixtures(pool));
  afterAll(async()=>{await pool?.end();await dropDatabases();await dropRoles();},120_000);

  it("requires an explicit syntactically valid PostgreSQL URL without connecting",async()=>{
    expect(await runMat003Preflight(undefined)).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_URL_REQUIRED"});
    expect(await runMat003Preflight("not-a-url")).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_URL_INVALID"});
  });
  it("rejects SUPERUSER and a role without BYPASSRLS",async()=>{
    expect(await runMat003Preflight(mainAdmin)).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_EXECUTION_ROLE_SUPERUSER"});
    expect(await runMat003Preflight(databaseUrl(DATABASES[0],ROLES.noBypass))).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_EXECUTION_ROLE_BYPASSRLS_REQUIRED"});
  });
  it("rejects missing deterministic read privilege before blocker evaluation",async()=>{
    expect(await runMat003Preflight(databaseUrl(DATABASES[0],ROLES.missingRead))).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_READ_PRIVILEGE_MISSING",checks:[]});
  });
  it("classifies the current pos_platform_admin grants as NOT_READY with exact missing platform reads",async()=>{
    const required=Object.entries(MAT003_PREFLIGHT_REQUIRED_TABLE_COLUMNS).flatMap(([table,columns])=>columns.map(column=>`('${table}','${column}')`)).join(",");
    const missingSchemas=(await pool.query(`SELECT name FROM (VALUES ('platform'),('integrations')) required(name) WHERE NOT has_schema_privilege('pos_platform_admin',name,'USAGE') ORDER BY name`)).rows.map(row=>row.name);
    const missingColumns=(await pool.query(`SELECT table_name||'.'||column_name name FROM (VALUES ${required}) required(table_name,column_name) WHERE NOT has_column_privilege('pos_platform_admin',table_name,column_name,'SELECT') ORDER BY 1`)).rows.map(row=>row.name);
    expect(missingSchemas).toEqual(["platform"]);
    expect(missingColumns).toEqual(["platform.target_migration_executions.checksum","platform.target_migration_executions.migration_id","platform.target_migration_executions.status"]);
    expect(await runMat003Preflight(databaseUrl(DATABASES[0],"pos_platform_admin"))).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_READ_PRIVILEGE_MISSING"});
  });
  it("keeps zero-history preflight strict but permits explicit ROLLED_BACK-only history for runner reapply",async()=>{
    const executionId=id(900001);
    await pool.query(`
      INSERT INTO platform.target_migration_executions(
        execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,
        body_committed_at,rolled_back_at,finished_at,runner_version
      ) VALUES (
        $1,'003_fiscal_electronic_invoicing_foundation','POSTGRESQL',1,decode(repeat('ab',32),'hex'),
        'ROLLED_BACK',clock_timestamp()-interval '3 seconds',clock_timestamp()-interval '2 seconds',
        clock_timestamp()-interval '1 second',clock_timestamp(),'preflight-test'
      )
    `,[executionId]);
    try{
      expect(await runMat003Preflight(canonical)).toMatchObject({result:"FAIL",failure_code:"PREDECESSOR_OR_CONTRACT_INVALID"});
      const reapply=await runMat003Preflight(canonical,{allowClosed003History:true});
      expect(reapply).toMatchObject({result:"PASS",database_state:{migration_003_ledger_entries:1,fiscal_schema:"ABSENT"}});
    }finally{
      await pool.query("DELETE FROM platform.target_migration_executions WHERE execution_id=$1",[executionId]);
    }
  });
  it("uses REPEATABLE READ, READ ONLY, the shared lock, six checks and always rolls back",async()=>{
    const before=await snapshot(pool);const first=await runMat003Preflight(canonical);const second=await runMat003Preflight(canonical);
    expect(first.result).toBe("PASS");expect(first.checks).toHaveLength(6);expect(first.checks.every(item=>item.status==="PASS")).toBe(true);
    expect(first.database_state).toMatchObject({transaction_read_only:true,transaction_isolation:"repeatable read",execution_role:ROLES.ok,execution_role_nonsuperuser:true,execution_role_bypassrls:true,global_lock_resource:MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE,global_lock_acquired:true});
    expect(first).toEqual(second);expect(await snapshot(pool)).toEqual(before);expect(mat003PreflightExitCode(first)).toBe(0);
  });
  it("makes the shared advisory lock the first database statement after BEGIN and reuses the same transaction for canonical catalog validation",async()=>{
    const source=await readFile(new URL("../src/postgres-003-preflight.ts",import.meta.url),"utf8");
    expect(source).toContain(`await executeRaw(connection,"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); started=true;\n      await acquireLock(connection); const runtime=await verifyRuntime(connection); await verifyPrivileges(connection); const state=await inspectPredecessor(connection,runtime,options);`);
    const inspection=source.slice(source.indexOf("async function inspectPredecessor"),source.indexOf("async function executeCheck"));
    expect(inspection).toContain("await validatePostgres002Catalog(db)");expect(inspection).not.toContain("postgresDatabase(");
  });
  it("closes the stale-snapshot race that existed when inspection preceded the shared lock",async()=>{
    const staleReader:PoolClient=await pool.connect();const writer:PoolClient=await pool.connect();let original="";let driftCommitted=false;
    try{
      original=await dispatchClassConstraint(writer);
      await staleReader.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const before=await dispatchClassConstraint(staleReader);
      await writer.query("BEGIN");await writer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE]);
      await replaceDispatchClassConstraint(writer,"CHECK (dispatch_class IN ('FISCAL','NON_FISCAL','RACE_DRIFT'))");await writer.query("COMMIT");driftCommitted=true;
      expect((await staleReader.query<{acquired:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired",[MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE])).rows[0]!.acquired).toBe(true);
      expect(await dispatchClassConstraint(staleReader)).toBe(before);
      await staleReader.query("ROLLBACK");
      expect(await dispatchClassConstraint(writer)).not.toBe(original);
      expect(await runMat003Preflight(canonical)).toMatchObject({result:"FAIL",failure_code:"PREDECESSOR_OR_CONTRACT_INVALID",checks:[]});
    }finally{
      try{await staleReader.query("ROLLBACK");}catch{}
      try{await writer.query("ROLLBACK");}catch{}
      if(driftCommitted&&original){await writer.query("BEGIN");try{await replaceDispatchClassConstraint(writer,original);await writer.query("COMMIT");}catch(error){await writer.query("ROLLBACK");throw error;}}
      staleReader.release();writer.release();
    }
    expect((await runMat003Preflight(canonical)).result).toBe("PASS");
  });
  it("fails fast on global lock contention and the xact lock is released afterward",async()=>{
    const client:PoolClient=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[MAT003_PREFLIGHT_GLOBAL_LOCK_RESOURCE]);const blocked=await runMat003Preflight(canonical);expect(blocked).toMatchObject({result:"FAIL",failure_code:"PREFLIGHT_GLOBAL_LOCK_UNAVAILABLE"});await client.query("ROLLBACK");}finally{client.release();}
    expect((await runMat003Preflight(canonical)).result).toBe("PASS");
  });
  it("fails trust validation when a constraint keeps its name but its definition drifts",async()=>{
    const client:PoolClient=await pool.connect();const original=await dispatchClassConstraint(client);let driftCommitted=false;
    try{
      await client.query("BEGIN");await replaceDispatchClassConstraint(client,"CHECK (dispatch_class IN ('FISCAL','NON_FISCAL','SEMANTIC_DRIFT'))");await client.query("COMMIT");driftCommitted=true;
      expect(await dispatchClassConstraint(client)).not.toBe(original);
      expect(await runMat003Preflight(canonical)).toMatchObject({result:"FAIL",failure_code:"PREDECESSOR_OR_CONTRACT_INVALID",checks:[]});
    }finally{
      try{await client.query("ROLLBACK");}catch{}
      if(driftCommitted){await client.query("BEGIN");try{await replaceDispatchClassConstraint(client,original);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}}
      client.release();
    }
    expect((await runMat003Preflight(canonical)).result).toBe("PASS");
  });
  it("global provider declaration and DEBIT_NOTES-like configuration alone do not block",async()=>{
    await insertBase(pool,SCOPE_A);await insertDeclaration(pool);await pool.query(`INSERT INTO integrations.provider_platform_configurations(id,provider_id,environment,configuration_type,configuration_schema_version,configuration_payload,status,valid_from,created_at,updated_at,version)VALUES($1,$2,'TEST','DEBIT_NOTES',1,'{"hint":"DEBIT_NOTES"}','DRAFT',clock_timestamp(),clock_timestamp(),clock_timestamp(),1)`,[IDS.configuration,IDS.providerA]);
    const result=await runMat003Preflight(canonical);expect(result.result).toBe("PASS");expect(result.checks.map(item=>item.check_id)).not.toContain("MAT003_PROVIDER_DECLARATION_DEBIT_NOTES");expect(result.checks.map(item=>item.check_id)).not.toContain("MAT003_DEBIT_NOTES_PROVIDER_CONFIGURATION");
  });
  it("matches mappings only on the complete scoped typed identity",async()=>{
    await insertBase(pool,SCOPE_A);await insertBase(pool,SCOPE_B);await insertDeclaration(pool);await insertCapability(pool);await insertDispatch(pool);
    await insertMapping(pool,IDS.mapping,SCOPE_A,IDS.entity,"exact");await insertMapping(pool,IDS.otherMapping,SCOPE_A,IDS.otherEntity,"same-resource-other-entity");await insertMapping(pool,IDS.scopeMapping,SCOPE_B,IDS.entity,"same-entity-other-scope");
    const mapping=check(await runMat003Preflight(canonical),"MAT003_DEBIT_NOTES_MAPPING");expect(mapping.count).toBe(1);expect(mapping.evidence.map(item=>item.id)).toEqual([IDS.mapping]);
  });
  it("matches ownership only through capability ownership_policy_id and exact scope",async()=>{
    await insertBase(pool,SCOPE_A);await insertBase(pool,SCOPE_B);await insertPolicy(pool,IDS.ownership,SCOPE_A,"ISSUE");await insertPolicy(pool,IDS.unrelatedOwnership,SCOPE_A,"OTHER");await insertPolicy(pool,IDS.scopeOwnership,SCOPE_B,"ISSUE");await insertDeclaration(pool);await insertCapability(pool,IDS.ownership);
    const ownership=check(await runMat003Preflight(canonical),"MAT003_DEBIT_NOTES_OWNERSHIP");expect(ownership.count).toBe(1);expect(ownership.evidence.map(item=>item.id)).toEqual([IDS.ownership]);
  });
  it("reports all five exact blockers and keeps scope integrity as a passing trust condition",async()=>{
    await insertBase(pool,SCOPE_A);await insertPolicy(pool,IDS.ownership,SCOPE_A,"ISSUE");await insertDeclaration(pool);await insertCapability(pool,IDS.ownership);await insertDispatch(pool);await insertMapping(pool,IDS.mapping,SCOPE_A,IDS.entity,"exact");
    await pool.query(`INSERT INTO integrations.integration_dispatch_attempts(id,tenant_id,company_id,integration_dispatch_id,dispatch_class,attempt_number,status,request_id,started_at,created_at)VALUES($1,$2,$3,$4,'NON_FISCAL',1,'CREATED','request-1',clock_timestamp(),clock_timestamp())`,[IDS.attempt,IDS.tenantA,IDS.companyA,IDS.dispatch]);
    const before=await snapshot(pool);const result=await runMat003Preflight(canonical);
    expect(result.result).toBe("BLOCKED");expect(result.checks.filter(item=>item.status==="BLOCKED").map(item=>item.check_id)).toEqual(["MAT003_INTEGRATION_CAPABILITY_DEBIT_NOTES","MAT003_NON_FISCAL_DEBIT_NOTES_DISPATCH","MAT003_NON_FISCAL_DEBIT_NOTES_ATTEMPT","MAT003_DEBIT_NOTES_MAPPING","MAT003_DEBIT_NOTES_OWNERSHIP"]);
    expect(check(result,"MAT003_AFFECTED_SCOPE_INTEGRITY")).toMatchObject({count:0,status:"PASS"});expect(mat003PreflightExitCode(result)).toBe(2);expect(await snapshot(pool)).toEqual(before);
  });
  it("keeps full counts separate from deterministic evidence limited to 100",async()=>{
    await insertBase(pool,SCOPE_A);await insertDeclaration(pool);await insertCapability(pool);
    for(let index=0;index<101;index+=1)await insertDispatch(pool,id(10000+index),id(20000+index),(1000+index).toString(36));
    const dispatch=check(await runMat003Preflight(canonical),"MAT003_NON_FISCAL_DEBIT_NOTES_DISPATCH");
    expect(dispatch.count).toBe(101);expect(dispatch.evidence).toHaveLength(100);expect(dispatch.evidence_truncated).toBe(true);expect(dispatch.evidence.map(item=>item.id)).toEqual([...dispatch.evidence.map(item=>item.id)].sort());
  });
  it("does not mutate role attributes or privileges",async()=>{
    const before=await grantSnapshot(pool);const roleBefore=(await pool.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1",[ROLES.ok])).rows[0];await runMat003Preflight(canonical);
    expect(await grantSnapshot(pool)).toEqual(before);expect((await pool.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1",[ROLES.ok])).rows[0]).toEqual(roleBefore);
  });
  it("fails closed on invalid predecessor ledger under the canonical role",async()=>{
    expect(await runMat003Preflight(databaseUrl(DATABASES[1],ROLES.ok))).toMatchObject({result:"FAIL",failure_code:"PREDECESSOR_OR_CONTRACT_INVALID",checks:[]});
  });
  it("keeps SQL003 repository artifacts PRESENT_UNAPPLIED without creating fiscal DB state",async()=>{
    const before=await snapshot(pool);
    expect((await runMat003Preflight(canonical)).result).toBe("PASS");
    expect(await snapshot(pool)).toEqual(before);
    expect(await snapshot(pool)).toMatchObject({fiscal_schema:false,ledger_003:0});
    expect((await readdir(new URL("../sql/postgres/",import.meta.url))).filter(name=>name.startsWith("003")).sort()).toEqual([
      "003_fiscal_electronic_invoicing_foundation.down.sql",
      "003_fiscal_electronic_invoicing_foundation.up.sql",
    ]);
    expect((await readdir(new URL("../sql/sqlite/",import.meta.url))).filter(name=>name.startsWith("003"))).toEqual([]);
  });
});
