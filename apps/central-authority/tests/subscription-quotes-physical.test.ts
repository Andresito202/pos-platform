import {afterAll,beforeAll,it,expect} from "vitest";
import {createPostgresPool,type Pool} from "@pos-platform/database-postgres";
import {uuidV7,type LicenseOfferDraft,type SubscriptionQuoteRequest} from "@pos-platform/contracts";
import {createHash,randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {SubscriptionQuotes,type SubscriptionQuotePolicy} from "../src/subscription-quotes.js";
import {LicenseOfferDrafts} from "../src/license-offer-drafts.js";

const server=process.env.POSTGRES_TEST_URL,db="pos_subscription_quotes_test_"+randomBytes(8).toString("hex"),tool=resolve("../../tools/target-migrations");
const root=new URL("../../../tools/target-migrations/sql/postgres/",import.meta.url),id=uuidV7;
const sql=(name:string)=>readFile(new URL(name,root),"utf8");
let admin:Pool,owner:Pool,runtime:Pool,created=false,globalSession:string,user:string,grant:string;
let merchant:SubscriptionQuotePolicy["merchant"],buyer:{tenant:string;company:string};
const offers:LicenseOfferDraft[]=[];
const limits={reauthenticationMs:60000,lockTimeoutMs:1000,statementTimeoutMs:10000};
const policy=():SubscriptionQuotePolicy=>({merchant,resolveTerms:({pricing,supportSelected,now})=>({
  policy_reference:"TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION",tax_policy_reference:"TEST_TAX_RESULT",support_policy_reference:"TEST_SUPPORT_TERMS",
  customer_verification_reference:"TEST_VERIFICATION",tax_mode:"EXCLUDED",tax_minor:123,currency_exponent:2,
  service_from:new Date(now.getTime()+60000).toISOString(),service_until:pricing.billing_model==="PERPETUAL"?null:new Date(now.getTime()+3600000).toISOString(),
  support_until:supportSelected?new Date(now.getTime()+1800000).toISOString():null,expires_at:new Date(now.getTime()+300000).toISOString(),
})});
function request(plan=offers[0]!):SubscriptionQuoteRequest{return {id:id(),tenant_id:buyer.tenant,company_id:buyer.company,plan_id:plan.id,plan_version:1,
  selection:{additional_registers:2,support:true},idempotency_key:id(),correlation_id:id()};}
async function company(){const tenant=id(),company=id();
  await owner.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Temporary','ACTIVE',now(),now())",[tenant]);
  await owner.query("INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES($1,$2,'Temporary','America/Bogota','COP','ACTIVE',now(),now())",[company,tenant]);return {tenant,company};}
beforeAll(async()=>{
  if(!server)return;const u=new URL(server);if(!["localhost","127.0.0.1"].includes(u.hostname)||u.port!=="55433")throw Error("TEMPORARY_POSTGRES_ONLY");
  admin=createPostgresPool(server,2,"subscription-temp-admin");await admin.query(`CREATE DATABASE "${db}"`);created=true;u.pathname="/"+db;
  execFileSync(process.execPath,["--import","tsx","--input-type=module","-e","const {applyPostgres001}=await import('./src/postgres.ts');await applyPostgres001({adminUrl:process.env.FIXTURE_DATABASE_URL})"],
    {cwd:tool,windowsHide:true,env:{...process.env,FIXTURE_DATABASE_URL:u.href},stdio:"pipe"});
  owner=createPostgresPool(u.href,2,"subscription-temp-owner");const c=await owner.connect();try{await c.query("SET ROLE pos_schema_owner");await c.query("CREATE EXTENSION btree_gist");
    for(const n of ["002_external_integrations_foundation","003_fiscal_electronic_invoicing_foundation","004_device_trust","006_licensing_foundation","007_password_recovery"])await c.query(await sql(n+".up.sql"));
    for(const n of ["003_fiscal_electronic_invoicing_foundation","006_licensing_foundation","007_password_recovery"])
      await c.query(`INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,body_committed_at,smoke_verified_at,applied_at,finished_at,runner_version)
        VALUES($1,$2,'POSTGRESQL',1,$3,'APPLIED',now(),now(),now(),now(),now(),'TEMPORARY_FIXTURE_PREDECESSOR')`,[id(),n,createHash("sha256").update(await sql(n+".up.sql")).digest()]);
  }finally{await c.query("RESET ROLE");c.release();}
  u.username="pos_migrator";u.password="";const env={...process.env,POSTGRES_MIGRATOR_URL:u.href,POSTGRES_EXPECTED_DATABASE:db,
    REPOSITORY_COMMIT:execFileSync("git",["rev-parse","HEAD"],{cwd:tool,encoding:"utf8",windowsHide:true}).trim(),POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"};
  const cli=(args:string[])=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts",...args],{cwd:tool,env,encoding:"utf8",windowsHide:true}));
  expect(cli(["--subscriptions"]).filter((r:{status:string})=>r.status==="APPLIED")).toHaveLength(12);
  expect(cli(["--subscriptions"]).every((r:{status:string})=>r.status==="ALREADY_APPLIED")).toBe(true);
  expect(Object.keys(cli(["--manifest"]))).toHaveLength(9);expect(Object.keys(cli(["--factus-pay","--manifest"]))).toHaveLength(11);
  u.username="pos_platform_app";runtime=createPostgresPool(u.href,5,"subscription-temp-runtime");
  buyer=await company();const seller=await company(),provider=id(),adapter=id(),integration=id();merchant={tenantId:seller.tenant,companyId:seller.company,integrationId:integration};
  await owner.query("INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at) VALUES($1,'FACTUS_PAY','Temporary','OTHER_REVIEW_REQUIRED','ACTIVE',now(),now())",[provider]);
  await owner.query(`INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,implementation_status,verification_status,created_at)
    VALUES($1,$2,'FACTUS_PAY','TEST',1,'IMPLEMENTED','MOCK_TESTED',now())`,[adapter,provider]);
  await owner.query(`INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,created_at,updated_at)
    VALUES($1,$2,$3,$4,'FACTUS_PAY',$5,'SANDBOX','CREDENTIALS_CONFIGURED',1,now(),now())`,[integration,seller.tenant,seller.company,provider,adapter]);
  const binding=id();await owner.query(`INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,generation,status,created_at)
    VALUES($1,$2,$3,$4,'temporary-reference','PROVIDER_API',1,'PENDING',now())`,[binding,seller.tenant,seller.company,integration]);
  await owner.query("UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=now() WHERE id=$1",[binding]);
  for(const s of ["AUTHENTICATED","DISCOVERING","DISCOVERY_COMPLETE","READY_FOR_REVIEW","ACTIVE"])await owner.query("UPDATE integrations.external_integrations SET status=$2,updated_at=now(),version=version+1 WHERE id=$1",[integration,s]);
  user=id();globalSession=id();const role=id(),permission=id();grant=id();
  await owner.query("INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES($1,'quote-test@example.invalid','quote-test@example.invalid','Temporary','ACTIVE',now(),now())",[user]);
  await owner.query("INSERT INTO identity.mfa_factors(id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at) VALUES($1,$2,'WEBAUTHN','TEST_REFERENCE','ACTIVE',now(),now())",[id(),user]);
  await owner.query("INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES($1,$2,now(),now()+interval '10 minutes',now(),'SATISFIED',now())",[globalSession,user]);
  await owner.query("INSERT INTO \"authorization\".roles(id,code,name,scope_type,version,status,created_at) VALUES($1,'TEST_QUOTE_ADMIN','Test','PLATFORM',1,'ACTIVE',now())",[role]);
  await owner.query("INSERT INTO \"authorization\".permissions(id,code,module,description,status,created_at) VALUES($1,'LICENSE_PLAN_MANAGE','LICENSING','Test only','ACTIVE',now())",[permission]);
  await owner.query("INSERT INTO \"authorization\".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES($1,$2,$3,1,'ACTIVE',now(),now())",[grant,role,permission]);
  const a=await owner.connect();try{await a.query("BEGIN");await a.query("SELECT set_config('app.audit_id',$1,true),set_config('app.correlation_id',$2,true)",[id(),id()]);
    await a.query("INSERT INTO \"authorization\".platform_role_assignments(id,user_id,role_id,status,valid_from,created_at,created_by_actor_type) VALUES($1,$2,$3,'ACTIVE',now(),now(),'SYSTEM')",[id(),user,role]);await a.query("COMMIT");
  }catch(e){await a.query("ROLLBACK");throw e;}finally{a.release();}
  const drafts=new LicenseOfferDrafts(runtime,60000);
  for(const model of ["MONTHLY","ANNUAL","PERPETUAL"] as const){const p:LicenseOfferDraft={id:id(),code:"TEST_QUOTE_"+model,name:"Test quotation only",billing_model:model,
    deployment_mode:model==="PERPETUAL"?"LOCAL_PERPETUAL":"HYBRID",currency_code:"COP",price_minor:10000,included_registers:1,additional_register_price_minor:2000,
    support_price_minor:1000,support_charge:"OPTIONAL_SAME_TERM",policy_reference:"TEST_PRICE_NOT_FOR_PRODUCTION"};
    await drafts.save(globalSession,p,0,id());await drafts.publish(globalSession,p.id,1,id());offers.push(p);}
},60000);
afterAll(async()=>{await runtime?.end();await owner?.end();if(created)await admin.query(`DROP DATABASE "${db}"`);await admin?.end();});

it.runIf(Boolean(server))("quotes: immutable durable monthly/annual/perpetual price snapshots, one included, no default fiscal/support policy",async()=>{
  await expect(new SubscriptionQuotes(runtime,null,limits).issue(globalSession,request())).rejects.toThrow("FISCAL_SUPPORT_POLICY_REQUIRED");
  const service=new SubscriptionQuotes(runtime,policy(),limits);
  await expect(service.issue(globalSession,{...request(),price_minor:1})).rejects.toThrow();
  for(const p of offers){const r=request(p),issued=await service.issue(globalSession,r);
    expect(issued).toMatchObject({state:"QUOTED",totalMinor:"15123",includedRegisters:1,additionalRegisters:2,paymentStatus:"NOT_REQUESTED",activationStatus:"NOT_ACTIVATED"});
    expect((await service.issue(globalSession,{...r,correlation_id:id()})).idempotent).toBe(true);
    const stored=(await owner.query("SELECT * FROM subscriptions.license_quotes WHERE id=$1",[r.id])).rows[0];
    expect(stored.pricing_snapshot.offer.price_minor).toBe(10000);expect(stored.terms_snapshot.policy_reference).toBe("TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION");
    expect(stored.provider_reference).not.toBe(r.id);expect(stored.merchant_tenant_id).not.toBe(stored.tenant_id);
    await expect(service.issue(globalSession,{...r,selection:{additional_registers:0,support:false}})).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  }
  const drafts=new LicenseOfferDrafts(runtime,60000),original={...offers[0]!,id:id(),code:"TEST_QUOTE_PRICE_HISTORY"};
  await drafts.save(globalSession,original,0,id());await drafts.publish(globalSession,original.id,1,id());
  const quoted=request(original);expect((await service.issue(globalSession,quoted)).totalMinor).toBe("15123");
  const revised={...original,id:id(),price_minor:20000};await drafts.save(globalSession,revised,1,id());await drafts.publish(globalSession,revised.id,2,id());
  expect(await service.issue(globalSession,quoted)).toMatchObject({totalMinor:"15123",idempotent:true});
  await expect(service.issue(globalSession,request(original))).rejects.toThrow("PUBLISHED_PLAN_REQUIRED");
  expect((await service.issue(globalSession,{...request(revised),plan_version:2})).totalMinor).toBe("25123");
  expect((await owner.query("SELECT count(*)::int AS n FROM licensing.licenses")).rows[0].n).toBe(0);
  await expect(runtime.query("UPDATE subscriptions.license_quotes SET total_minor=1")).rejects.toThrow("permission denied");
  await expect(owner.query("UPDATE subscriptions.license_quotes SET total_minor=1")).rejects.toThrow("append-only");
});

it.runIf(Boolean(server))("quotes: concurrent replay, inactive buyer, bad terms, audit rollback and missing GLOBAL MFA/grant",async()=>{
  const service=new SubscriptionQuotes(runtime,policy(),limits),r=request();
  const both=await Promise.all([service.issue(globalSession,r),service.issue(globalSession,r)]);
  expect(both.filter(x=>!x.idempotent)).toHaveLength(1);expect(both.filter(x=>x.idempotent)).toHaveLength(1);
  const invalid={...policy(),resolveTerms:()=>null};
  await expect(new SubscriptionQuotes(runtime,invalid,limits).issue(globalSession,request())).rejects.toThrow("FISCAL_SUPPORT_POLICY_REQUIRED");
  await expect(service.issue(globalSession,{...request(),company_id:id()})).rejects.toThrow("BUYER_NOT_ACTIVE");
  await expect(service.issue(id(),request())).rejects.toThrow("GLOBAL_MFA_PERMISSION_REQUIRED");
  const regular=policy(),expiring={...regular,resolveTerms:(...args:Parameters<typeof regular.resolveTerms>)=>({
    ...regular.resolveTerms(...args)!,expires_at:new Date(args[0].now.getTime()+1).toISOString()})};
  const expiringService=new SubscriptionQuotes(runtime,expiring,limits),expiringRequest=request();
  await expiringService.issue(globalSession,expiringRequest);await new Promise(r=>setTimeout(r,30));
  expect((await expiringService.issue(globalSession,expiringRequest)).state).toBe("EXPIRED");
  await owner.query(`CREATE FUNCTION public.reject_quote_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_code='SUBSCRIPTION_QUOTE_ISSUED'
    THEN RAISE EXCEPTION 'QUOTE_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_quote_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_quote_audit()`);
  const failed=request();try{await expect(service.issue(globalSession,failed)).rejects.toThrow("QUOTE_AUDIT_FAILURE");
    expect((await owner.query("SELECT 1 FROM subscriptions.license_quotes WHERE id=$1",[failed.id])).rowCount).toBe(0);
  }finally{await owner.query("DROP TRIGGER reject_quote_audit ON audit.audit_events; DROP FUNCTION public.reject_quote_audit()");}
  await owner.query("UPDATE identity.sessions SET mfa_status='PENDING' WHERE id=$1",[globalSession]);
  await expect(service.issue(globalSession,request())).rejects.toThrow("GLOBAL_MFA_PERMISSION_REQUIRED");
  await owner.query("UPDATE identity.sessions SET mfa_status='SATISFIED' WHERE id=$1",[globalSession]);
  await owner.query("UPDATE \"authorization\".role_permission_grants SET status='RETIRED',retired_at=now() WHERE id=$1",[grant]);
  await expect(service.issue(globalSession,r)).rejects.toThrow("GLOBAL_MFA_PERMISSION_REQUIRED");
},30000);
