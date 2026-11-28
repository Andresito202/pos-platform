import {execFileSync} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import {Pool, type PoolClient} from "pg";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {applyPostgres001,applyPostgres002} from "../src/postgres.js";
import {applyPostgres003} from "../src/postgres-003-runner.js";
import {applyRoleReadiness} from "../src/postgres-003-role-readiness.js";
import {applyPostgres004} from "../src/postgres-004-runner.js";
import {applyPostgres005} from "../src/postgres-005-runner.js";
import {applyPostgres006} from "../src/postgres-006-runner.js";
import {applyPostgres007} from "../src/postgres-007-runner.js";
import {applyCommercialMigrations,commercialMigrationManifest} from "../src/postgres-commercial-runner.js";
import {uuidV7 as id} from "../src/shared.js";

// Destructive fixture lifecycle is allowed only on an explicitly supplied,
// disposable loopback test server. Never default to the commercial database.
const server=process.env.CASH_BINDING_TEST_URL;
describe.runIf(Boolean(server))("033 real PostgreSQL license reservation",()=>{
  const database="test_cash_binding_"+id().replaceAll("-","");
  let admin:Pool,root:Pool,runtime:Pool,created=false,temporary:string;
  const tenant=id(),company=id(),branch=id(),foreignTenant=id(),license=id(),secondLicense=id(),businessLicense=id(),acceptedLicense=id();
  const user=id(),session=id(),membership=id();
  let migration:Parameters<typeof applyCommercialMigrations>[0];
  function url(role?:string){const u=new URL(server!);u.pathname="/"+database;if(role){u.username=role;u.password="";}return u.href;}
  beforeAll(async()=>{
    const u=new URL(server!);
    if(u.hostname!=="127.0.0.1"||["5432","55433",""].includes(u.port)||u.pathname!=="/postgres")throw Error("DISPOSABLE_TEST_SERVER_REQUIRED");
    admin=new Pool({connectionString:server});await admin.query(`CREATE DATABASE "${database}"`);created=true;
    const repositoryCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",windowsHide:true}).trim();
    const config={adminUrl:url(),expectedDatabase:database,repositoryCommit};
    await applyPostgres001(config);await applyPostgres002(config);
    temporary=await mkdtemp(join(tmpdir(),"camacho-binding-receipt-"));
    await applyRoleReadiness({provisioningUrl:url("pos_migrator"),verificationUrl:url("pos_platform_admin"),
      environmentId:"DISPOSABLE_BINDING_TEST",expectedDatabase:database,repositoryCommit,operatorOrJobId:"vitest-binding",
      receiptOutputPath:join(temporary,"readiness.json")});
    await applyPostgres003({...config,environmentId:"DISPOSABLE_BINDING_TEST",receiptOutputPath:join(temporary,"receipt.json")});
    await applyPostgres004(config);await applyPostgres005(config);await applyPostgres006(config);await applyPostgres007(config);
    migration={migratorUrl:url("pos_migrator"),expectedDatabase:database,repositoryCommit,lockTimeoutMs:5000,statementTimeoutMs:20000};
    await applyCommercialMigrations({...migration,target:"LICENSE_CATALOG"});
    for(const target of ["CASH_REGISTER_MASTER","COMMERCIAL_AUTHORIZATION","BUSINESS_OWNER","TENANT_INITIALIZATION","CASH_REGISTER_BINDINGS"] as const)
      await applyCommercialMigrations({...migration,target});
    await applyCommercialMigrations({...migration,target:"COMMERCIAL_PORTAL_BRIDGE"});
    await applyCommercialMigrations({...migration,target:"COMMERCIAL_ORDER_ACTIVATION"});
    root=new Pool({connectionString:url()});runtime=new Pool({connectionString:url("pos_platform_app"),max:4});
    // Fixtures use the real schema and constraints. No provider calls or product
    // credentials: all records disappear with this newly-created test database.
    for(const t of [tenant,foreignTenant])await root.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Test only','ACTIVE',now(),now())",[t]);
    await root.query("INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES($1,$2,'Test only','America/Bogota','COP','ACTIVE',now(),now())",[company,tenant]);
    await root.query("INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'Test only','America/Bogota','ACTIVE',now(),now())",[branch,tenant,company]);
    const provider=id(),adapter=id(),integration=id(),plan=id();
    await root.query("INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES($1,'binding@example.invalid','binding@example.invalid','Test only','ACTIVE',now(),now())",[user]);
    await root.query("INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,mfa_status,created_at) VALUES($1,$2,now(),now()+interval '1 hour','SATISFIED',now())",[session,user]);
    await root.query("INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at) VALUES($1,'BINDING_TEST','Test only','OTHER_REVIEW_REQUIRED','ACTIVE',now(),now())",[provider]);
    await root.query("INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at) VALUES($1,$2,'BINDING_TEST','1',1,'IMPLEMENTED','MOCK_TESTED',now())",[adapter,provider]);
    await root.query("INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at) VALUES($1,$2,$3,$4,'BINDING_TEST',$5,'TEST','CREATED',1,now(),now())",[integration,tenant,company,provider,adapter]);
    await root.query("INSERT INTO licensing.plans(id,code,name,billing_model,deployment_mode,currency_code,price_minor,status,created_at,updated_at) VALUES($1,'BINDING_TEST','Test only','MONTHLY','HYBRID','COP',100,'DRAFT',now(),now())",[plan]);
    for(const l of [license,secondLicense,businessLicense,acceptedLicense]){
      const quote=id(),group=id(),payment=id();
      await root.query(`INSERT INTO subscriptions.license_quotes(id,tenant_id,company_id,merchant_tenant_id,merchant_company_id,integration_id,provider_reference,plan_id,plan_version,currency_code,total_minor,currency_exponent,included_registers,additional_registers,pricing_snapshot,terms_snapshot,entitlements_snapshot,idempotency_key,request_checksum,quote_checksum,created_by_user_id,created_by_session_id,created_at,expires_at)
        VALUES($1::uuid,$2,$3,$2,$3,$4,$5,$6,1,'COP',100,2,1,0,'{}','{"policy_reference":"TEST_ONLY"}','[]',$1::text,$7,$7,$8,$9,now(),now()+interval '1 hour')`,[quote,tenant,company,integration,id(),plan,"a".repeat(64),user,session]);
      await root.query(`INSERT INTO payments.payment_groups(id,tenant_id,company_id,branch_id,collection_subject_type,collection_subject_id,currency_code,expected_payable_amount,idempotency_key,request_checksum,correlation_id,created_at)
        VALUES($1::uuid,$2,$3,$4,'SUBSCRIPTION_QUOTE',$5,'COP',1,$1::text,$6,$7,now())`,[group,tenant,company,branch,quote,"a".repeat(64),id()]);
      await root.query(`INSERT INTO payments.payments(id,tenant_id,company_id,branch_id,payment_group_id,payment_method,expected_amount,currency_code,status,authority_type,operator_actor_type,idempotency_key,request_checksum,correlation_id,created_at,server_recorded_at)
        VALUES($1::uuid,$2,$3,$4,$5,'QR',1,'COP','CREATED','EXTERNAL_PROVIDER_AUTHORITATIVE','SYSTEM',$1::text,$6,$7,now(),now())`,[payment,tenant,company,branch,group,"a".repeat(64),id()]);
      await root.query("UPDATE payments.payments SET status='PENDING',version=version+1 WHERE id=$1",[payment]);
      await root.query("UPDATE payments.payments SET status='CONFIRMED',confirmed_amount=1,confirmed_at=now(),version=version+1 WHERE id=$1",[payment]);
      await root.query(`INSERT INTO licensing.licenses(id,tenant_id,plan_id,deployment_mode,contract_status,not_before,expires_at,policy_version,commercial_reference,created_at,updated_at)
        VALUES($1,$2,$3,'HYBRID','ACTIVE',now(),now()+interval '1 month','TEST_ONLY',$4,now(),now())`,[l,tenant,plan,"SUBSCRIPTION_PAYMENT:"+payment]);
      await root.query("INSERT INTO licensing.license_entitlements(id,license_id,capability_code,enabled,limit_type,source_plan_version,created_at) VALUES($1,$2,'CASH_REGISTER',true,'NOT_APPLICABLE',1,now())",[id(),l]);
    }
    await root.query("INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_at,activated_at) VALUES($1,$2,$3,'OWNER','ACTIVE',true,'SYSTEM',now(),now())",[membership,tenant,user]);
    await root.query("UPDATE identity.sessions SET tenant_id=$2,tenant_membership_id=$3,last_reauthenticated_at=clock_timestamp(),version=version+1 WHERE id=$1",[session,tenant,membership]);
    await root.query(`INSERT INTO "authorization".user_role_assignments(id,tenant_id,tenant_membership_id,role_id,company_id,status,valid_from,created_at,created_by_actor_type)
      SELECT $1,$2,$3,id,$4,'ACTIVE',now(),now(),'SYSTEM' FROM "authorization".roles WHERE code='OWNER' AND scope_type='BUSINESS'`,[id(),tenant,membership,company]);
  },120000);
  afterAll(async()=>{
    await runtime?.end();await root?.end();
    if(created)await admin.query(`DROP DATABASE "${database}"`);
    await admin?.end();
    if(temporary){
      if(dirname(resolve(temporary))!==resolve(tmpdir())||!basename(temporary).startsWith("camacho-binding-receipt-"))throw Error("TEST_CLEANUP_PATH_REJECTED");
      await rm(temporary,{recursive:true,force:true});
    }
  });
  async function transaction<T>(work:(c:PoolClient)=>Promise<T>){
    const c=await runtime.connect();try{await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','5s',true)",[tenant]);
      const value=await work(c);await c.query("COMMIT");return value;
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  async function master(){const register=id();await root.query("INSERT INTO cash.cash_registers(id,tenant_id,company_id,branch_id,code,code_normalized,name,currency_code,status) VALUES($1::uuid,$2,$3,$4,$1::text,$1::text,'Test only','COP','ACTIVE')",[register,tenant,company,branch]);return register;}
  const bind=(c:PoolClient,register:string,l:string)=>c.query("INSERT INTO licensing.cash_register_bindings(register_id,tenant_id,company_id,branch_id,license_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(register_id) DO NOTHING",[register,tenant,company,branch,l]);
  it("verifies exact ledger/checksum and no-op through the canonical runner",async()=>{
    expect((await applyCommercialMigrations({...migration,target:"CASH_REGISTER_BINDINGS"}))[0]?.status).toBe("ALREADY_APPLIED");
    const manifest=await commercialMigrationManifest("CASH_REGISTER_BINDINGS");
    expect((await root.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id='033_cash_register_license_bindings' AND status='APPLIED'")).rows).toEqual([{checksum:manifest["033_cash_register_license_bindings"]}]);
  });
  it("serializes concurrent creates at the last paid slot, and preserves reservation after retirement",async()=>{
    const a=await master(),b=await master();
    const outcomes=await Promise.allSettled([transaction(c=>bind(c,a,license)),transaction(c=>bind(c,b,license))]);
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o=>o.status==='rejected').map(o=>(o as PromiseRejectedResult).reason.message)).toEqual(["CASH_REGISTER_CAPACITY_EXHAUSTED"]);
    const held=(await root.query("SELECT register_id FROM licensing.cash_register_bindings WHERE license_id=$1",[license])).rows[0].register_id;
    await root.query("UPDATE cash.cash_registers SET status='RETIRED',retired_at=clock_timestamp(),version=version+1 WHERE id=$1",[held]);
    await transaction(c=>bind(c,held,license)); // replay consumes no extra slot
    await expect(transaction(c=>bind(c,held===a?b:a,license))).rejects.toThrow("CASH_REGISTER_CAPACITY_EXHAUSTED");
  });
  it("reserves a second license independently and prevents double assignment",async()=>{
    const register=await master();await transaction(c=>bind(c,register,secondLicense));
    await transaction(c=>bind(c,register,license));
    expect((await root.query("SELECT license_id FROM licensing.cash_register_bindings WHERE register_id=$1",[register])).rows).toEqual([{license_id:secondLicense}]);
    await expect(root.query("UPDATE licensing.cash_register_bindings SET license_id=$1 WHERE register_id=$2",[license,register])).rejects.toThrow("CASH_REGISTER_BINDING_IMMUTABLE");
    await expect(root.query("DELETE FROM licensing.cash_register_bindings WHERE register_id=$1",[register])).rejects.toThrow("CASH_REGISTER_BINDING_IMMUTABLE");
    await expect(root.query("TRUNCATE licensing.cash_register_bindings")).rejects.toThrow();
  });
  it("forces tenant RLS and denies mutation privileges and foreign company bindings",async()=>{
    await transaction(async c=>{
      expect((await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='licensing.cash_register_bindings'::regclass")).rows[0]).toEqual({relrowsecurity:true,relforcerowsecurity:true});
      expect((await c.query("SELECT has_table_privilege(current_user,'licensing.cash_register_bindings','UPDATE') AS writable")).rows[0].writable).toBe(false);
      await c.query("SELECT set_config('app.tenant_id',$1,true)",[foreignTenant]);
      expect((await c.query("SELECT * FROM licensing.cash_register_bindings")).rowCount).toBe(0);
    });
    const register=await master();
    await expect(transaction(c=>c.query("INSERT INTO licensing.cash_register_bindings(register_id,tenant_id,company_id,branch_id,license_id) VALUES($1,$2,$3,$4,$5)",[register,foreignTenant,company,branch,secondLicense]))).rejects.toThrow();
  });
  it("runs the real BUSINESS cash use case, permission guard and transactional audit with runtime SQL grants",()=>{
    const result=execFileSync(process.execPath,["--import","tsx","tests/helpers/business-cash-postgres-probe.ts",JSON.stringify({
      tenantId:tenant,companyId:company,branchId:branch,licenseId:businessLicense,otherLicenseId:secondLicense,sessionId:session,userId:user,membershipId:membership})],
      {cwd:resolve("../../apps/central-authority"),encoding:"utf8",windowsHide:true,timeout:60000,env:{...process.env,CASH_BINDING_PROBE_URL:url("pos_platform_app")}});
    expect(JSON.parse(result)).toEqual({created:true,replayed:true,staleVersion:true,otherLicense:true,edited:true,retired:true,audited:true,retiredActivationRejected:true});
  },65000);
  it("records local license acceptance through HTTPS and PostgreSQL",()=>{
    const result=execFileSync(process.execPath,["--import","tsx","tests/helpers/license-local-acceptance-postgres-probe.ts",JSON.stringify({
      tenant,company,branch,licenseId:acceptedLicense,
    })],{cwd:resolve("../../apps/central-authority"),encoding:"utf8",windowsHide:true,timeout:30_000,
      env:{...process.env,CASH_BINDING_PROBE_URL:url("pos_platform_app"),CASH_BINDING_PROBE_ADMIN_URL:url()}});
    expect(JSON.parse(result)).toEqual({issued:true,accepted:true,concurrentReceipts:1,replayRejected:true,revokedRejected:true});
  },35_000);
  it("issues commercial calendar terms and checks durable activation evidence over HTTPS",()=>{
    const result=execFileSync(process.execPath,["--import","tsx","tests/helpers/license-local-acceptance-postgres-probe.ts",JSON.stringify({
      tenant,company,branch,commercial:true,
    })],{cwd:resolve("../../apps/central-authority"),encoding:"utf8",windowsHide:true,timeout:30_000,
      env:{...process.env,CASH_BINDING_PROBE_URL:url("pos_platform_app"),CASH_BINDING_PROBE_ADMIN_URL:url()}});
    expect(JSON.parse(result)).toEqual({issued:true,accepted:true,concurrentReceipts:1,replayRejected:true,revokedRejected:true,
      commercialStatus:true,calendarTerms:true});
  },35_000);
});
