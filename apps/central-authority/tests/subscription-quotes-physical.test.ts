import {afterAll,beforeAll,it,expect} from "vitest";
import {createPostgresPool,type Pool} from "@pos-platform/database-postgres";
import {uuidV7,addLicenseCalendarMonths,type LicenseOfferDraft,type SubscriptionQuoteRequest} from "@pos-platform/contracts";
import {createHash,randomBytes,generateKeyPairSync,sign,X509Certificate} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile,writeFile,mkdtemp,rm} from "node:fs/promises";
import {resolve,join,dirname,basename} from "node:path";
import {tmpdir} from "node:os";
import {createServer,request as httpsRequest,type Server} from "node:https";
import {FactusPayQuoteVerifier,type FactusPayCredentialResolver} from "../src/factus-pay-quote-verifier.js";
import {SubscriptionPayments} from "../src/subscription-payments.js";
import {prepareSubscriptionCollectionRuntime} from "../src/subscription-collection-runtime.js";
import {SubscriptionQuotes,type SubscriptionQuotePolicy} from "../src/subscription-quotes.js";
import {LicenseOfferDrafts} from "../src/license-offer-drafts.js";
import {GlobalAdministrationSessions} from "../src/global-administration-sessions.js";
import {createGlobalAdministrationHandler} from "../src/global-administration-http.js";
import {createPublicLicenseCatalog} from "../src/public-license-catalog.js";
import {createGlobalAdministrationAssets} from "../src/global-administration-assets.js";
import {exercisePlatformAdministrationBrowser} from "./helpers/platform-administration-browser.js";
import {exerciseLicenseCapacity} from "./helpers/license-capacity-scenario.js";
import {BusinessInitialMfaFlow} from "../src/business-initial-mfa-flow.js";
import {createPlatformPasswordVerifier} from "../src/platform-password-verifier.js";
import {DurableBrowserSessionStore} from "../src/durable-browser-session-store.js";
import {SubscriptionLicenseContracts} from "../src/subscription-license-contracts.js";

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

it.runIf(Boolean(server))("quotes: revocation committed during a lock wait cannot use the earlier permission snapshot",async()=>{
  const r=request(),service=new SubscriptionQuotes(runtime,policy(),{...limits,lockTimeoutMs:5000});
  const lock=await owner.connect();let released=false;
  try{
    await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`subscription-quote:${r.tenant_id}:${r.company_id}:${r.idempotency_key}`]);
    const result=service.issue(globalSession,r).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
    let waiting=false;
    for(let i=0;i<100;i++){
      waiting=(await owner.query("SELECT 1 FROM pg_stat_activity WHERE application_name='subscription-temp-runtime' AND wait_event='advisory'")).rowCount!>0;
      if(waiting)break;await new Promise(yes=>setTimeout(yes,20));
    }
    expect(waiting).toBe(true);
    const old=(await owner.query('SELECT role_id,permission_id FROM "authorization".role_permission_grants WHERE id=$1',[grant])).rows[0];
    await owner.query('UPDATE "authorization".role_permission_grants SET status=\'RETIRED\',retired_at=now() WHERE id=$1',[grant]);
    await lock.query("COMMIT");released=true;
    const outcome=await result;expect(outcome.error?.message).toBe("SUBSCRIPTION_GLOBAL_MFA_PERMISSION_REQUIRED");
    expect((await owner.query("SELECT 1 FROM subscriptions.license_quotes WHERE id=$1",[r.id])).rowCount).toBe(0);
    // Test fixture replaces the retired grant with a new version, without
    // resurrecting it or changing production assignments.
    grant=id();await owner.query('INSERT INTO "authorization".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES($1,$2,$3,2,\'ACTIVE\',now(),now())',[grant,old.role_id,old.permission_id]);
  }finally{if(!released)await lock.query("ROLLBACK");lock.release();}
},15000);

it.runIf(Boolean(server))("FACTUS API: TLS/SQL quote correlation, custody binding, negative responses, replay evidence and revocation",async()=>{
  const migrationUrl=new URL(server!);migrationUrl.pathname="/"+db;migrationUrl.username="pos_migrator";migrationUrl.password="";
  const applyPayments=()=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts","--subscription-payments"],{cwd:tool,windowsHide:true,encoding:"utf8",env:{...process.env,
    POSTGRES_MIGRATOR_URL:migrationUrl.href,POSTGRES_EXPECTED_DATABASE:db,REPOSITORY_COMMIT:execFileSync("git",["rev-parse","HEAD"],{cwd:tool,encoding:"utf8",windowsHide:true}).trim(),
    POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"}}));
  const migrated=applyPayments();expect(migrated.filter((x:{status:string})=>x.status==="APPLIED")).toHaveLength(1);
  expect(applyPayments().every((x:{status:string})=>x.status==="ALREADY_APPLIED")).toBe(true);
  const branchId=id();await owner.query("INSERT INTO organization.branches(id,tenant_id,company_id,code,code_normalized,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'TEST_BILLING','test_billing','Temporary billing branch','America/Bogota','ACTIVE',now(),now())",[branchId,merchant.tenantId,merchant.companyId]);
  const service=new SubscriptionQuotes(runtime,policy(),limits),r=request();await service.issue(globalSession,r);
  const row=(await owner.query("SELECT provider_reference FROM subscriptions.license_quotes WHERE id=$1",[r.id])).rows[0];
  await owner.query("UPDATE integrations.external_integrations SET provider_account_reference='TEST_RECEIVER_ACCOUNT' WHERE id=$1",[merchant.integrationId]);
  const apiLimits={requestTimeoutMs:5000,maximumResponseBytes:16384,evidenceLifetimeMs:5000,lockTimeoutMs:1000,statementTimeoutMs:3000};
  const resolver:FactusPayCredentialResolver={resolve:async binding=>({binding:{...binding},accessToken:"TEST_ONLY_PROVIDER_TOKEN",expiresAt:new Date(Date.now()+60000).toISOString()})};
  let api:Server|undefined,dir:string|undefined,calls=0,status=200,reference=row.provider_reference;
  const posted:Record<string,unknown>[]=[];
  const collections=new Map<string,Record<string,unknown>>();
  let data:Record<string,unknown>={reference_code:row.provider_reference,amount:151.23,status:"paid"};
  let beforeReply:(()=>Promise<void>)|undefined;
  try{
    dir=await mkdtemp(join(tmpdir(),"pos-factus-api-"));
    const host="pay-api-sandbox.factus.com.co";
    execFileSync("C:/Program Files/Git/usr/bin/openssl.exe",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN="+host,
      "-addext","subjectAltName=DNS:"+host,"-keyout",join(dir,"tls.key"),"-out",join(dir,"tls.crt")],{stdio:"ignore",windowsHide:true});
    const cert=await readFile(join(dir,"tls.crt"));
    api=createServer({key:await readFile(join(dir,"tls.key")),cert},async(req,res)=>{
      calls++;let requested=reference;
      if(req.method==="POST"){
        expect(req.url).toBe("/v1/collections");const chunks:Buffer[]=[];for await(const b of req)chunks.push(Buffer.from(b));
        posted.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        requested=String(posted.at(-1)!.reference_code);
      }else{expect(req.method).toBe("GET");requested=req.url!.slice("/v1/collections/".length);
        expect([reference,...collections.keys()]).toContain(requested);}
      expect(req.headers.authorization).toBe("Bearer TEST_ONLY_PROVIDER_TOKEN");
      if(beforeReply)await beforeReply();
      res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify({status:"success",data:collections.get(requested)??data}));
    });
    await new Promise<void>(yes=>api!.listen(0,"127.0.0.1",yes));
    // Only the test transport routes the fixed official host to a local stand-in.
    // TLS validates hostname and the ephemeral test CA; production uses fetch.
    const transport:typeof fetch=async(input,init)=>{
      const url=new URL(String(input));expect(url.origin).toBe("https://"+host);expect(init?.redirect).toBe("error");
      return new Promise<Response>((yes,no)=>{
        const req=httpsRequest({host:"127.0.0.1",port:(api!.address() as {port:number}).port,servername:host,ca:cert,agent:false,
          path:url.pathname,method:init?.method,headers:init?.headers as Record<string,string>,signal:init?.signal??undefined},res=>{
          const chunks:Buffer[]=[];res.on("data",b=>chunks.push(Buffer.from(b)));res.on("end",()=>yes(new Response(Buffer.concat(chunks),{
            status:res.statusCode!,headers:{"content-type":res.headers["content-type"]!}})));});req.on("error",no);req.end(init?.body??undefined);
      });
    };
    const verifier=new FactusPayQuoteVerifier(runtime,resolver,apiLimits,transport);
    const payments=new SubscriptionPayments(runtime,verifier,{tenantId:merchant.tenantId,companyId:merchant.companyId,branchId},limits);
    await expect(new SubscriptionPayments(runtime,verifier,{tenantId:buyer.tenant,companyId:buyer.company,branchId},limits).reserve(r.id,id())).rejects.toThrow("MERCHANT_MISMATCH");
    const badBranch=new SubscriptionPayments(runtime,verifier,{tenantId:merchant.tenantId,companyId:merchant.companyId,branchId:id()},limits);
    await expect(badBranch.reserve(r.id,id())).rejects.toThrow("ACTIVE_MERCHANT_BRANCH_REQUIRED");
    const failedIntent=request();await service.issue(globalSession,failedIntent);
    await owner.query(`CREATE FUNCTION public.reject_reservation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action_code='SUBSCRIPTION_PAYMENT_RESERVED' THEN RAISE EXCEPTION 'RESERVATION_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_reservation_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_reservation_audit()`);
    try{await expect(payments.reserve(failedIntent.id,id())).rejects.toThrow("RESERVATION_AUDIT_FAILURE");
      expect((await owner.query("SELECT 1 FROM payments.payment_groups WHERE collection_subject_id=$1",[failedIntent.id])).rowCount).toBe(0);
      expect((await owner.query("SELECT 1 FROM sync.sync_operations WHERE payload->>'quote_id'=$1",[failedIntent.id])).rowCount).toBe(0);
    }finally{await owner.query("DROP TRIGGER reject_reservation_audit ON audit.audit_events; DROP FUNCTION public.reject_reservation_audit()");}
    const pending=await Promise.all([payments.reserve(r.id,id()),payments.reserve(r.id,id())]);
    expect(pending.filter(x=>!x.idempotent)).toHaveLength(1);expect(pending.filter(x=>x.idempotent)).toHaveLength(1);
    expect(pending[0]!.state).toBe("PENDING");
    await expect(payments.confirm({quoteId:r.id,paid:true},id())).rejects.toThrow("FRESH_RECEIPT_REQUIRED");
    const receipt=await verifier.verifyQuote(r.id);
    expect(JSON.stringify(receipt)).toBe("{}");expect(verifier.take(JSON.parse(JSON.stringify(receipt)))).toBeNull();
    expect(verifier.take(receipt)).toMatchObject({quoteId:r.id,buyerTenantId:buyer.tenant,buyerCompanyId:buyer.company,
      providerReference:row.provider_reference,amount:"151.230000",currencyCode:"COP",merchant:{tenantId:merchant.tenantId,companyId:merchant.companyId}});
    expect(verifier.take(receipt)).toBeNull();
    const forRollback=await verifier.verifyQuote(r.id);
    await owner.query(`CREATE FUNCTION public.reject_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action_code='SUBSCRIPTION_PAYMENT_CONFIRMED' THEN RAISE EXCEPTION 'PAYMENT_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_payment_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_payment_audit()`);
    try{await expect(payments.confirm(forRollback,id())).rejects.toThrow("PAYMENT_AUDIT_FAILURE");
      expect((await owner.query("SELECT status FROM payments.payments WHERE id=$1",[pending[0]!.paymentId])).rows[0].status).toBe("PENDING");
      expect((await owner.query("SELECT status FROM payments.payment_attempts WHERE payment_id=$1",[pending[0]!.paymentId])).rows[0].status).toBe("PENDING");
      expect((await owner.query("SELECT 1 FROM payments.payment_allocations")).rowCount).toBe(0);
      expect((await owner.query("SELECT 1 FROM sync.sync_operations WHERE operation_type='SUBSCRIPTION_PAYMENT_CONFIRMED'")).rowCount).toBe(0);
    }finally{await owner.query("DROP TRIGGER reject_payment_audit ON audit.audit_events; DROP FUNCTION public.reject_payment_audit()");}
    await expect(payments.confirm(forRollback,id())).rejects.toThrow("FRESH_RECEIPT_REQUIRED");
    await owner.query(`CREATE FUNCTION public.reject_payment_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.operation_type='SUBSCRIPTION_PAYMENT_CONFIRMED' THEN RAISE EXCEPTION 'PAYMENT_OUTBOX_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_payment_outbox BEFORE INSERT ON sync.outbox_entries FOR EACH ROW EXECUTE FUNCTION public.reject_payment_outbox()`);
    try{await expect(payments.confirm(await verifier.verifyQuote(r.id),id())).rejects.toThrow("PAYMENT_OUTBOX_FAILURE");
      expect((await owner.query("SELECT status FROM payments.payments WHERE id=$1",[pending[0]!.paymentId])).rows[0].status).toBe("PENDING");
      expect((await owner.query("SELECT 1 FROM payments.payment_allocations")).rowCount).toBe(0);
    }finally{await owner.query("DROP TRIGGER reject_payment_outbox ON sync.outbox_entries; DROP FUNCTION public.reject_payment_outbox()");}
    const proofs=await Promise.all([verifier.verifyQuote(r.id),verifier.verifyQuote(r.id)]);
    const confirmed=await Promise.all(proofs.map(proof=>payments.confirm(proof,id())));
    expect(confirmed.filter(x=>!x.idempotent)).toHaveLength(1);expect(confirmed.filter(x=>x.idempotent)).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({state:"CONFIRMED",activationStatus:"NOT_ACTIVATED"});
    expect((await owner.query("SELECT count(*)::int AS n FROM audit.audit_events WHERE action_code='SUBSCRIPTION_PAYMENT_CONFIRMED'")).rows[0].n).toBe(1);
    expect((await owner.query(`SELECT o.operation_type FROM sync.outbox_entries o JOIN sync.sync_operations s ON s.tenant_id=o.tenant_id AND s.id=o.operation_id
      WHERE s.aggregate_id=$1 AND o.payload_checksum=s.payload_checksum ORDER BY o.operation_type`,[pending[0]!.paymentId])).rows)
      .toEqual([{operation_type:"SUBSCRIPTION_PAYMENT_CONFIRMED"},{operation_type:"SUBSCRIPTION_PAYMENT_RESERVED"}]);
    expect((await owner.query("SELECT amount::text FROM payments.payment_allocations WHERE payment_id=$1",[pending[0]!.paymentId])).rows).toEqual([{amount:"151.230000"}]);
    expect((await owner.query("SELECT provider_reported_at FROM payments.payment_attempts WHERE payment_id=$1",[pending[0]!.paymentId])).rows[0].provider_reported_at).toBeNull();
    await expect(runtime.query("UPDATE payments.payments SET expected_amount=1")).rejects.toThrow("permission denied");
    const rollback=await owner.connect();try{await rollback.query("BEGIN");await rollback.query("SET LOCAL ROLE pos_schema_owner");
      await expect(rollback.query(await sql("020_subscription_payments.down.sql"))).rejects.toThrow("020 down refused");
    }finally{await rollback.query("ROLLBACK");rollback.release();}
    const forCommit=await verifier.verifyQuote(r.id);
    expect(await verifier.consume(forCommit,async(c,value)=>{
      expect((await c.query("SELECT current_user AS role")).rows[0].role).toBe("pos_platform_app");return value.providerReference;
    })).toBe(row.provider_reference);
    await expect(verifier.consume(forCommit,async()=>true)).rejects.toThrow("FRESH_RECEIPT_REQUIRED");
    const mismatch=new FactusPayQuoteVerifier(runtime,{resolve:async(binding,signal)=>{
      const c=await resolver.resolve(binding,signal);return {...c,binding:{...binding,companyId:buyer.company}};}},apiLimits,transport);
    const before=calls;await expect(mismatch.verifyQuote(r.id)).rejects.toThrow("CREDENTIAL_BINDING_REJECTED");expect(calls).toBe(before);
    for(const changed of [{amount:151.24},{reference_code:id()},{currency_code:"USD"},{status:"ready"}]){
      data={reference_code:row.provider_reference,amount:151.23,status:"paid",...changed};
      await expect(verifier.verifyQuote(r.id)).rejects.toThrow();
    }
    data={reference_code:row.provider_reference,amount:151.23,status:"paid"};status=401;
    await expect(verifier.verifyQuote(r.id)).rejects.toThrow("RESPONSE_REJECTED");status=200;
    const cancelled=new AbortController();cancelled.abort();await expect(verifier.verifyQuote(r.id,cancelled.signal)).rejects.toThrow("CANCELLED_OR_TIMEOUT");
    const bounded=new FactusPayQuoteVerifier(runtime,resolver,{...apiLimits,maximumResponseBytes:10},transport);
    await expect(bounded.verifyQuote(r.id)).rejects.toThrow("RESPONSE_TOO_LARGE");
    const timed=new FactusPayQuoteVerifier(runtime,{resolve:()=>new Promise(()=>undefined)},{...apiLimits,requestTimeoutMs:30},transport);
    await expect(timed.verifyQuote(r.id)).rejects.toThrow("CANCELLED_OR_TIMEOUT");
    const expiring=new FactusPayQuoteVerifier(runtime,resolver,{...apiLimits,evidenceLifetimeMs:1},transport);
    const expired=await expiring.verifyQuote(r.id);await new Promise(yes=>setTimeout(yes,10));expect(expiring.take(expired)).toBeNull();
    await owner.query(`CREATE FUNCTION public.reject_api_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action_code='FACTUS_PAY_QUOTE_API_VERIFIED' THEN RAISE EXCEPTION 'API_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_api_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_api_audit()`);
    try{await expect(verifier.verifyQuote(r.id)).rejects.toThrow("VERIFICATION_FAILED");}
    finally{await owner.query("DROP TRIGGER reject_api_audit ON audit.audit_events; DROP FUNCTION public.reject_api_audit()");}

    // New affected path: official POST contract -> durable readiness -> runtime
    // GET reconciliation. Test prices/policies remain explicitly non-production.
    const creationOffer={...offers[0]!,id:id(),code:"TEST_COLLECTION_CREATION",price_minor:110000};
    const drafts=new LicenseOfferDrafts(runtime,60000);await drafts.save(globalSession,creationOffer,0,id());await drafts.publish(globalSession,creationOffer.id,1,id());
    const cr=request(creationOffer);await service.issue(globalSession,cr);
    const cq=(await owner.query("SELECT * FROM subscriptions.license_quotes WHERE id=$1",[cr.id])).rows[0];reference=cq.provider_reference;
    const qr="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    data={reference_code:reference,amount:1151.23,status:"ready",qr};
    await expect(verifier.prepareCollection(cr.id,30)).rejects.toThrow("RESERVED_CURRENT_INTENT_REQUIRED");
    await payments.reserve(cr.id,id());
    await expect(verifier.prepareCollection(cr.id,1000)).rejects.toThrow("RESERVED_CURRENT_INTENT_REQUIRED");
    data={...data,amount:1151.24};await expect(verifier.prepareCollection(cr.id,30)).rejects.toThrow("COLLECTION_BINDING_MISMATCH");
    data={...data,amount:1151.23,qr:"https://untrusted.invalid/qr"};await expect(verifier.prepareCollection(cr.id,30)).rejects.toThrow("QR_REJECTED");
    data={...data,qr};
    const creationReceipt=await verifier.prepareCollection(cr.id,30);
    expect(posted.at(-1)).toEqual({reference_code:reference,amount:"1151.23",expiration:"30"});
    await expect(payments.confirm(creationReceipt,id())).rejects.toThrow("FRESH_RECEIPT_REQUIRED");
    await expect(payments.recordCollection(JSON.parse(JSON.stringify(creationReceipt)),id())).rejects.toThrow("COLLECTION_RECEIPT_REQUIRED");
    await owner.query(`CREATE FUNCTION public.reject_collection_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action_code='SUBSCRIPTION_COLLECTION_PREPARED' THEN RAISE EXCEPTION 'COLLECTION_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_collection_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_collection_audit()`);
    try{await expect(payments.recordCollection(creationReceipt,id())).rejects.toThrow("COLLECTION_AUDIT_FAILURE");
      expect((await owner.query("SELECT a.evidence_snapshot FROM payments.payment_attempts a JOIN payments.payment_groups g ON g.collection_subject_id=$1 JOIN payments.payments p ON p.payment_group_id=g.id AND a.payment_id=p.id",[cr.id])).rows[0].evidence_snapshot).toBeNull();
    }finally{await owner.query("DROP TRIGGER reject_collection_audit ON audit.audit_events; DROP FUNCTION public.reject_collection_audit()");}
    await expect(payments.recordCollection(creationReceipt,id())).rejects.toThrow("COLLECTION_RECEIPT_REQUIRED");
    const creations=await Promise.all([verifier.prepareCollection(cr.id,30),verifier.prepareCollection(cr.id,30)]);
    const readiness=await Promise.all(creations.map(e=>payments.recordCollection(e,id())));
    expect(readiness.filter(e=>!e.idempotent)).toHaveLength(1);expect(readiness.every(e=>e.state==="PENDING")).toBe(true);
    const credentialFile=join(dir,"custody.json"),provisionFile=join(dir,"collections.json");
    const binding={tenantId:merchant.tenantId,companyId:merchant.companyId,integrationId:merchant.integrationId,credentialReference:"temporary-reference",
      generation:1,environment:"SANDBOX",providerAccountReference:"TEST_RECEIVER_ACCOUNT"};
    const secretFile={profile:"CAMACHO_FACTUS_PAY_API_CUSTODY_V1",credentials:[{binding,accessToken:"TEST_ONLY_PROVIDER_TOKEN",expiresAt:new Date(Date.now()+60000).toISOString()}]};
    await writeFile(credentialFile,JSON.stringify(secretFile),{mode:0o600});
    const provision={profile:"CAMACHO_FACTUS_PAY_COLLECTIONS_V1",policy_reference:"TEST_ONLY_NO_PRODUCTION_APPROVAL",environment:"SANDBOX",
      merchant:{...merchant,branchId},approved_quote_policies:[{policy_reference:"TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION",tax_policy_reference:"TEST_TAX_RESULT",support_policy_reference:"TEST_SUPPORT_TERMS"}],
      migrations:{"019_subscription_quotes":createHash("sha256").update(await sql("019_subscription_quotes.up.sql")).digest("hex"),
        "020_subscription_payments":createHash("sha256").update(await sql("020_subscription_payments.up.sql")).digest("hex")},credentials_file:credentialFile,
      poll_interval_ms:1000,batch_size:100,collection_expiration_seconds:30,request_timeout_ms:5000,maximum_response_bytes:16384,
      evidence_lifetime_ms:5000,lock_timeout_ms:1000,statement_timeout_ms:3000};
    await writeFile(provisionFile,JSON.stringify(provision),{mode:0o600});
    // Remove unrelated failed-reservation quote: quotes alone must not dispatch.
    const errors:string[]=[];
    await writeFile(provisionFile,JSON.stringify({...provision,migrations:{...provision.migrations,"020_subscription_payments":"0".repeat(64)}}));
    await expect(prepareSubscriptionCollectionRuntime({pool:runtime,provisionFile,transport})).rejects.toThrow("REGISTERED_SCHEMA_REQUIRED");
    await writeFile(provisionFile,JSON.stringify({...provision,approved_quote_policies:[{...provision.approved_quote_policies[0],tax_policy_reference:"UNAPPROVED"}]}));
    const blocked=await prepareSubscriptionCollectionRuntime({pool:runtime,provisionFile,transport,onError:e=>errors.push(e)});
    const beforePolicy=calls;await blocked.tick();expect(calls).toBe(beforePolicy);expect(errors.pop()).toBe("COLLECTIONS_APPROVED_QUOTE_POLICY_REQUIRED");await blocked.stop();
    await writeFile(provisionFile,JSON.stringify(provision));
    const runtimeQuote=request(creationOffer);await service.issue(globalSession,runtimeQuote);await payments.reserve(runtimeQuote.id,id());
    const runtimeReference=(await owner.query("SELECT provider_reference FROM subscriptions.license_quotes WHERE id=$1",[runtimeQuote.id])).rows[0].provider_reference;
    collections.set(runtimeReference,{reference_code:runtimeReference,amount:1151.23,status:"ready",qr});
    const beforeRuntimePosts=posted.length;
    const live=await prepareSubscriptionCollectionRuntime({pool:runtime,provisionFile,transport,onError:e=>errors.push(e)});
    await Promise.all([live.tick(),live.tick()]);expect(errors).toEqual([]);
    expect(posted.length-beforeRuntimePosts).toBe(1);expect(posted.at(-1)!.reference_code).toBe(runtimeReference);
    const runtimePayment=(await owner.query("SELECT p.id,p.status FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id WHERE g.collection_subject_id=$1",[cr.id])).rows[0];
    expect(runtimePayment.status).toBe("PENDING");await live.stop();await expect(async()=>live.tick()).rejects.toThrow("RUNTIME_STOPPED");
    // Fresh runtime/custody objects recover only durable state. Wrong custody
    // binding rejects before HTTP; then an authenticated GET confirms the money.
    await writeFile(credentialFile,JSON.stringify({...secretFile,credentials:[{...secretFile.credentials[0],binding:{...binding,companyId:buyer.company}}]}));
    const restored=await prepareSubscriptionCollectionRuntime({pool:runtime,provisionFile,transport,onError:e=>errors.push(e)});
    const beforeCustody=calls;await restored.tick();expect(calls).toBe(beforeCustody);expect(errors.at(-1)).toBe("FACTUS_API_VERIFICATION_FAILED");
    await writeFile(credentialFile,JSON.stringify(secretFile));data={...data,status:"paid"};
    await restored.tick();await restored.tick();
    expect((await owner.query("SELECT status FROM payments.payments WHERE id=$1",[runtimePayment.id])).rows[0].status).toBe("CONFIRMED");
    expect(errors.length).toBe(2);expect(errors.every(e=>e==="FACTUS_API_VERIFICATION_FAILED")).toBe(true);
    await restored.stop();
    expect((await owner.query("SELECT count(*)::int AS n FROM audit.audit_events WHERE resource_id=$1 AND action_code='SUBSCRIPTION_PAYMENT_CONFIRMED'",[runtimePayment.id])).rows[0].n).toBe(1);
    const shortPolicy=policy(),shortQuotes=new SubscriptionQuotes(runtime,{...shortPolicy,resolveTerms:args=>({...shortPolicy.resolveTerms(args)!,
      expires_at:new Date(args.now.getTime()+1000).toISOString()})},limits),expiringQuote=request(creationOffer);
    await shortQuotes.issue(globalSession,expiringQuote);await payments.reserve(expiringQuote.id,id());
    await expect(payments.reviewExpired(expiringQuote.id,id())).rejects.toThrow("EXPIRED_INTENT_REQUIRED");
    await new Promise(yes=>setTimeout(yes,1100));
    const reviews=await Promise.all([payments.reviewExpired(expiringQuote.id,id()),payments.reviewExpired(expiringQuote.id,id())]);
    expect(reviews.filter(e=>!e.idempotent)).toHaveLength(1);expect(reviews.every(e=>e.state==="REVIEW_REQUIRED")).toBe(true);
    expect((await owner.query("SELECT count(*)::int AS n FROM sync.sync_operations WHERE operation_type='SUBSCRIPTION_PAYMENT_REVIEW_REQUIRED' AND payload->>'quote_id'=$1",[expiringQuote.id])).rows[0].n).toBe(1);
    reference=row.provider_reference;data={reference_code:reference,amount:151.23,status:"paid"};
    const heldReceipt=await verifier.verifyQuote(r.id);
    beforeReply=async()=>{
      await owner.query("UPDATE integrations.external_integrations SET status='CREDENTIAL_ROTATION_REQUIRED',updated_at=now(),version=version+1 WHERE id=$1",[merchant.integrationId]);
      await owner.query("UPDATE integrations.integration_credential_bindings SET status='REVOKED',revoked_at=now(),version=version+1 WHERE integration_id=$1 AND status='ACTIVE'",[merchant.integrationId]);
    };
    await expect(verifier.verifyQuote(r.id)).rejects.toThrow("MERCHANT_BINDING_REQUIRED");
    let cachedUsed=false;
    await expect(verifier.consume(heldReceipt,async()=>{cachedUsed=true;})).rejects.toThrow("MERCHANT_BINDING_REQUIRED");
    expect(cachedUsed).toBe(false);
    // Restore through canonical states for the next quote test, never disable a guard.
    beforeReply=undefined;const replacement=id();
    await owner.query(`INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,generation,status,created_at)
      VALUES($1,$2,$3,$4,'temporary-replacement-reference','PROVIDER_API',2,'PENDING',now())`,[replacement,merchant.tenantId,merchant.companyId,merchant.integrationId]);
    await owner.query("UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=now() WHERE id=$1",[replacement]);
    for(const state of ["AUTHENTICATED","DISCOVERING","DISCOVERY_COMPLETE","READY_FOR_REVIEW","ACTIVE"])
      await owner.query("UPDATE integrations.external_integrations SET status=$2,updated_at=now(),version=version+1 WHERE id=$1",[merchant.integrationId,state]);
    expect((await owner.query("SELECT count(*)::int AS n FROM licensing.licenses")).rows[0].n).toBe(0);
    const audited=(await owner.query("SELECT new_value FROM audit.audit_events WHERE action_code='FACTUS_PAY_QUOTE_API_VERIFIED'")).rows;
    expect(audited.length).toBeGreaterThan(0);expect(JSON.stringify(audited)).not.toContain("TEST_ONLY_PROVIDER_TOKEN");
  }finally{
    if(api){api.closeAllConnections();await new Promise<void>(yes=>api!.close(()=>yes()));}
    if(dir){if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("pos-factus-api-"))throw Error("CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});}
  }
},30000);

it.runIf(Boolean(server))("GLOBAL: real password/WebAuthn to canonical cookie, purpose isolation, live permissions, recovery and logout",async()=>{
  const u=new URL(server!);u.pathname="/"+db;u.username="pos_migrator";u.password="";
  const migrate=()=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts","--license-catalog"],{cwd:tool,windowsHide:true,encoding:"utf8",env:{...process.env,
    POSTGRES_MIGRATOR_URL:u.href,POSTGRES_EXPECTED_DATABASE:db,REPOSITORY_COMMIT:execFileSync("git",["rev-parse","HEAD"],{cwd:tool,encoding:"utf8",windowsHide:true}).trim(),
    POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"}}));
  expect(migrate().some((r:{status:string;migrationId:string})=>r.migrationId==="023_license_offer_terms"&&r.status==="APPLIED")).toBe(true);
  expect(migrate().every((r:{status:string})=>r.status==="ALREADY_APPLIED")).toBe(true);
  const password=randomBytes(24).toString("base64url"),origin="https://global.example.test",rpId="global.example.test";
  const rejectionVerifier=await createPlatformPasswordVerifier(randomBytes(24).toString("hex"),"owasp-19m-t2-p1");
  const verifier=await createPlatformPasswordVerifier(password,"owasp-19m-t2-p1");
  const key=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),jwk=key.publicKey.export({format:"jwk"});
  const cose=Buffer.concat([Buffer.from("a5010203262001215820","hex"),Buffer.from(jwk.x!,"base64url"),Buffer.from("225820","hex"),Buffer.from(jwk.y!,"base64url")]);
  const factor=id(),material=id(),credentialId=randomBytes(32).toString("base64url"),credential=id();
  // The fixture user already has an actual platform assignment and grant. No
  // role is invented by the session authority or copied from BUSINESS.
  await owner.query("INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at) VALUES($1,$2,'PASSWORD',$3,'ACTIVE',now())",[credential,user,verifier]);
  await owner.query("INSERT INTO identity.mfa_factors(id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at) VALUES($1,$2,'WEBAUTHN',$3,'ACTIVE',now(),now())",[factor,user,"webauthn:v1:"+material]);
  await owner.query("INSERT INTO identity.webauthn_credential_material(id,factor_id,credential_id,public_key_cose_base64url) VALUES($1,$2,$3,$4)",[material,factor,credentialId,cose.toString("base64url")]);
  const p={mode:"ISOLATED_VALIDATION" as const,origin,rpId,policyReference:"TEST_ONLY_NOT_PRODUCTION",rejectionVerifier,challengeLifetimeMs:60000,sessionLifetimeMs:60000,maximumMfaAgeMs:10000,
    maximumReauthenticationAgeMs:60000,browserLifetimeMs:60000,idleTimeoutMs:60000,lockTimeoutMs:1000,statementTimeoutMs:10000};
  const sessions=new GlobalAdministrationSessions(runtime,p),login={email:"quote-test@example.invalid",password,factorId:factor,correlationId:id()};
  expect(await sessions.begin({...login,password:"wrong"})).toBeNull();
  const business=new BusinessInitialMfaFlow(runtime,{rpId,origin,rejectionVerifier,challengeLifetimeMs:60000});
  const proof=(challenge:string,counter:number)=>{
    const data=Buffer.from(JSON.stringify({type:"webauthn.get",challenge,origin,crossOrigin:false})),auth=Buffer.alloc(37);
    createHash("sha256").update(rpId).digest().copy(auth);auth[32]=0x05;auth.writeUInt32BE(counter,33);
    return {id:credentialId,rawId:credentialId,type:"public-key" as const,clientExtensionResults:{},response:{clientDataJSON:data.toString("base64url"),
      authenticatorData:auth.toString("base64url"),signature:sign("sha256",Buffer.concat([auth,createHash("sha256").update(data).digest()]),key.privateKey).toString("base64url")}};
  };
  const first=(await sessions.begin(login))!;
  const completion={email:login.email,password,challenge:first.challenge,response:proof(first.challenge,1)};
  expect(await business.complete(completion)).toBeNull();
  const established=await sessions.complete(completion);expect(established).not.toBeNull();expect(await sessions.complete(completion)).toBeNull();
  expect(established!.setCookie).toContain("Secure; HttpOnly; SameSite=Strict");
  const browserRequest={cookie:established!.setCookie.split(";",1)[0]!,origin,csrfToken:established!.csrfToken,fetchSite:"same-origin",method:"POST"};
  const sid=await sessions.authorize(browserRequest,"LICENSE_PLAN_MANAGE");expect(sid).not.toBeNull();
  const businessCookies=new DurableBrowserSessionStore(runtime,origin,{mode:"CANONICAL",lifetimeMs:60000,idleTimeoutMs:60000,maximumReauthenticationAgeMs:60000});
  expect(await businessCookies.inspect({...browserRequest,cookie:browserRequest.cookie.replace("__Host-camacho_platform=","__Host-camacho_business=")})).toBeNull();
  expect((await owner.query("SELECT tenant_id,tenant_membership_id,device_id,mfa_status FROM identity.sessions WHERE id=$1",[sid])).rows[0])
    .toEqual({tenant_id:null,tenant_membership_id:null,device_id:null,mfa_status:"SATISFIED"});
  expect(await sessions.authorize({...browserRequest,csrfToken:"a".repeat(43)},"LICENSE_PLAN_MANAGE")).toBeNull();
  expect(await sessions.authorize({...browserRequest,origin:"https://evil.invalid"},"LICENSE_PLAN_MANAGE")).toBeNull();
  expect(await sessions.authorize({...browserRequest,cookie:"__Host-camacho_business="+established!.setCookie.split("=")[1]},"LICENSE_PLAN_MANAGE")).toBeNull();
  expect(await sessions.authorize(browserRequest,"FISCAL_DOCUMENT_ISSUE")).toBeNull();
  const restored=new GlobalAdministrationSessions(runtime,p);expect(await restored.authorize(browserRequest,"LICENSE_PLAN_MANAGE")).toBe(sid);
  expect(await restored.close(browserRequest)).toBe(sid);
  expect(await sessions.authorize(browserRequest,"LICENSE_PLAN_MANAGE")).toBeNull();
  expect((await owner.query("SELECT revoked_at IS NOT NULL AS revoked FROM identity.sessions WHERE id=$1",[sid])).rows[0].revoked).toBe(true);
  const budget={windowMs:60000,maximumPerAddress:1,maximumPerAccount:1};
  expect(await sessions.spendLoginBudget("TEST_BUDGET_ADDRESS","budget@example.invalid",budget)).toBe(true);
  expect(await restored.spendLoginBudget("TEST_BUDGET_ADDRESS","budget@example.invalid",budget)).toBe(false);
  let dir:string|undefined,tls:Server|undefined;
  try{
    dir=await mkdtemp(join(tmpdir(),"pos-global-api-"));
    execFileSync("C:/Program Files/Git/usr/bin/openssl.exe",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN="+rpId,
      "-addext","subjectAltName=DNS:"+rpId,"-keyout",join(dir,"tls.key"),"-out",join(dir,"tls.crt")],{stdio:"ignore",windowsHide:true});
    const cert=await readFile(join(dir,"tls.crt")),httpLimits={maximumBodyBytes:16384,maximumPendingFlows:10,requestsPerWindow:100,maximumBuckets:10,
      requestWindowMs:60000,loginWindowMs:60000,maximumLoginPerAddress:20,maximumLoginPerAccount:20};
    let handler=createGlobalAdministrationHandler({pool:runtime,policy:p,limits:httpLimits});
    let browserHandler:ReturnType<typeof createGlobalAdministrationHandler>|undefined;
    let assets:ReturnType<typeof createGlobalAdministrationAssets>|undefined;
    let pricing:ReturnType<typeof createGlobalAdministrationAssets>|undefined;
    let catalog:ReturnType<typeof createPublicLicenseCatalog>|undefined;
    tls=createServer({key:await readFile(join(dir,"tls.key")),cert},(req,res)=>{
      if(req.url==="/v1/licensing/offers"){void catalog!(req,res);return;}
      if(req.url?.startsWith("/pricing")){void pricing!(req,res);return;}
      if(req.url?.startsWith("/platform")){void assets!(req,res);return;}
      void (req.headers.host===rpId?handler:browserHandler!)(req,res);
    });
    await new Promise<void>(yes=>tls!.listen(0,"127.0.0.1",yes));
    const browserOrigin=origin+":"+(tls.address() as {port:number}).port;
    browserHandler=createGlobalAdministrationHandler({pool:runtime,policy:{...p,origin:browserOrigin},limits:httpLimits,preproductionCatalogEnabled:true});
    assets=createGlobalAdministrationAssets({directory:resolve("../pos-desktop/dist/renderer"),origin:browserOrigin,maximumAssetBytes:2000000});
    pricing=createGlobalAdministrationAssets({directory:resolve("../pos-desktop/dist/renderer"),origin:browserOrigin,maximumAssetBytes:2000000,page:"pricing"});
    catalog=createPublicLicenseCatalog(new LicenseOfferDrafts(runtime,60000),browserOrigin,{requests:100,buckets:10,windowMs:60000});
    const asset=(path:string,method="GET",host=new URL(browserOrigin).host)=>new Promise<{status:number;csp:string|undefined}>((yes,no)=>{
      const req=httpsRequest({host:"127.0.0.1",port:(tls!.address() as {port:number}).port,servername:rpId,ca:cert,agent:false,path,method,headers:{host}},res=>{
        res.resume();res.on("end",()=>yes({status:res.statusCode!,csp:res.headers["content-security-policy"] as string|undefined}));
      });req.on("error",no);req.end();
    });
    expect(await asset("/platform/")).toMatchObject({status:200,csp:expect.stringContaining("frame-ancestors 'none'")});
    for(const path of ["/platform/assets/../platform.html","/platform/assets/%2e%2e/secret.js","/platform/assets/preload.cjs","/platform/assets/main.js.map","/platform/config.json"])
      expect((await asset(path)).status).toBe(404);
    expect((await asset("/platform/","POST")).status).toBe(403);
    expect((await asset("/platform/","GET","evil.invalid")).status).toBe(403);
    const call=(path:string,payload:unknown,cookie?:string,csrf?:string,requestOrigin=origin)=>new Promise<{status:number;body:any;cookies:string[]}>((yes,no)=>{
      const body=JSON.stringify(payload),req=httpsRequest({host:"127.0.0.1",port:(tls!.address() as {port:number}).port,servername:rpId,ca:cert,agent:false,
        path:"/v1/platform/"+path,method:"POST",headers:{host:rpId,origin:requestOrigin,"sec-fetch-site":"same-origin","content-type":"application/json",
          "content-length":Buffer.byteLength(body),...(cookie?{cookie}:{}),...(csrf?{"x-csrf-token":csrf}:{})}},res=>{
        const chunks:Buffer[]=[];res.on("data",b=>chunks.push(Buffer.from(b)));res.on("end",()=>yes({status:res.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString("utf8")),cookies:res.headers["set-cookie"]??[]}));
      });req.on("error",no);req.end(body);
    });
    const beginBody={email:login.email,password,factorId:factor};
    expect((await call("login/begin",beginBody,undefined,undefined,"https://evil.invalid")).status).toBe(403);
    expect((await call("login/begin",{...beginBody,password:"wrong"})).status).toBe(401);
    const started=await call("login/begin",beginBody);expect(started.status).toBe(200);
    const completeBody={email:login.email,password,challenge:started.body.challenge,response:proof(started.body.challenge,2)};
    const authenticated=await call("login/complete",completeBody,started.cookies[0]!.split(";",1)[0],started.body.csrfToken);
    expect(authenticated.status).toBe(200);expect(authenticated.body).toMatchObject({authenticated:true,scope:"GLOBAL"});
    expect((await call("login/complete",completeBody,started.cookies[0]!.split(";",1)[0],started.body.csrfToken)).status).toBe(401);
    const cookie=authenticated.cookies.find(s=>s.startsWith("__Host-camacho_platform="))!.split(";",1)[0]!,csrf=authenticated.body.csrfToken;
    expect((await call("license-offers/initialize-preproduction",{},cookie,csrf)).status).toBe(403); // No production seed switch.
    expect((await call("license-offers/list",{},cookie,csrf)).body.offers.length).toBeGreaterThan(0);
    expect((await call("license-offers/list",{sessionId:globalSession},cookie,csrf)).status).toBe(400);
    const offer={...offers[0]!,id:id(),code:"TEST_GLOBAL_HTTP_PRICE",price_minor:220000};
    expect((await call("license-offers/save",{offer,expectedVersion:0,correlationId:id()},cookie,csrf)).body).toMatchObject({planId:offer.id,version:1});
    expect((await call("license-offers/catalog",{},cookie,csrf)).body.offers.find((o:any)=>o.id===offer.id)).toMatchObject({status:"DRAFT",version:1,price_minor:220000});
    expect((await call("license-offers/list",{},cookie,csrf)).body.offers.find((o:any)=>o.id===offer.id)).toBeUndefined();
    expect((await call("license-offers/publish",{planId:offer.id,expectedVersion:1,correlationId:id()},cookie,csrf)).status).toBe(200);
    expect((await call("license-offers/list",{},cookie,csrf)).body.offers.find((o:any)=>o.id===offer.id).price_minor).toBe(220000);
    expect((await call("quotes/issue",request(),cookie,csrf)).status).toBe(409); // No production fiscal/terms provider.
    const paid=(await owner.query("SELECT id FROM payments.payments WHERE status='CONFIRMED' ORDER BY id LIMIT 1")).rows[0];
    if(!paid)throw Error("GLOBAL_FULFILLMENT_TEST_RUN_WITH_FACTUS_API_SCENARIO");
    expect((await call("licenses/issue",{paymentId:paid.id,correlationId:id()},cookie,csrf)).status).toBe(401); // Plan management is not issuance.
    const issuePermission=id(),issueGrant=id(),roleId=(await owner.query('SELECT role_id FROM "authorization".role_permission_grants WHERE id=$1',[grant])).rows[0].role_id;
    await owner.query('INSERT INTO "authorization".permissions(id,code,module,description,status,created_at) VALUES($1,\'LICENSE_ISSUE\',\'LICENSING\',\'Explicit test-only D1 issuance\',\'ACTIVE\',now())',[issuePermission]);
    await owner.query('INSERT INTO "authorization".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES($1,$2,$3,1,\'ACTIVE\',now(),now())',[issueGrant,roleId,issuePermission]);
    expect((await call("licenses/issue",{paymentId:paid.id,correlationId:id()},cookie,csrf)).status).toBe(409); // Policies still absent.
    const approved=[{policy_reference:"TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION",tax_policy_reference:"TEST_TAX_RESULT",support_policy_reference:"TEST_SUPPORT_TERMS"}];
    handler=createGlobalAdministrationHandler({pool:runtime,policy:p,limits:httpLimits,fulfillmentPolicies:approved});
    const currentRequest={...browserRequest,cookie,csrfToken:csrf};
    const issuanceSession=await sessions.authorize(currentRequest,"LICENSE_ISSUE");expect(issuanceSession).not.toBeNull();
    const issuer=new SubscriptionLicenseContracts(runtime,approved,{...limits,lockTimeoutMs:5000});
    await expect(issuer.issue(issuanceSession!,id(),id())).rejects.toThrow("CONFIRMED_QUOTE_PAYMENT_REQUIRED");
    const pendingPayment=(await owner.query("SELECT id FROM payments.payments WHERE status='PENDING' LIMIT 1")).rows[0];
    expect(pendingPayment).toBeDefined();await expect(issuer.issue(issuanceSession!,pendingPayment.id,id())).rejects.toThrow("CONFIRMED_QUOTE_PAYMENT_REQUIRED");
    await owner.query(`CREATE FUNCTION public.reject_license_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action_code='PAID_SUBSCRIPTION_LICENSE_ISSUED' THEN RAISE EXCEPTION 'LICENSE_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_license_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_license_audit()`);
    try{await expect(issuer.issue(issuanceSession!,paid.id,id())).rejects.toThrow("LICENSE_AUDIT_FAILURE");
      expect((await owner.query("SELECT 1 FROM licensing.licenses WHERE commercial_reference=$1",["SUBSCRIPTION_PAYMENT:"+paid.id])).rowCount).toBe(0);
      expect((await owner.query("SELECT 1 FROM sync.sync_operations WHERE operation_type='LICENSE_CONTRACT_ISSUED'")).rowCount).toBe(0);
    }finally{await owner.query("DROP TRIGGER reject_license_audit ON audit.audit_events; DROP FUNCTION public.reject_license_audit()");}
    const issued=await Promise.all([issuer.issue(issuanceSession!,paid.id,id()),issuer.issue(issuanceSession!,paid.id,id())]);
    expect(issued.filter(e=>!e.idempotent)).toHaveLength(1);expect(issued.every(e=>e.activationStatus==="NOT_ACTIVATED")).toBe(true);
    expect(issued[0]!.licenseId).toBe(issued[1]!.licenseId);
    expect((await call("licenses/issue",{paymentId:paid.id,correlationId:id()},cookie,csrf)).body).toMatchObject({licenseId:issued[0]!.licenseId,idempotent:true,activationStatus:"NOT_ACTIVATED"});
    expect((await owner.query("SELECT count(*)::int AS n FROM sync.sync_operations WHERE operation_type='LICENSE_CONTRACT_ISSUED'")).rows[0].n).toBe(1);
    handler=createGlobalAdministrationHandler({pool:runtime,policy:p,limits:httpLimits});
    expect((await call("session",{},cookie,csrf)).body).toMatchObject({authenticated:true,scope:"GLOBAL",permissions:["LICENSE_PLAN_MANAGE"]});
    expect((await call("session",{},cookie,"a".repeat(43))).status).toBe(401);
    const planCode="CAMACHO_MONTHLY";
    const observed=await exercisePlatformAdministrationBrowser({origin:browserOrigin,fingerprint:new X509Certificate(cert).fingerprint256,
      email:login.email,password,credentialId:Buffer.from(credentialId,"base64url").toString("base64"),
      privateKey:key.privateKey.export({format:"der",type:"pkcs8"}).toString("base64"),counter:2,planCode});
    expect(observed).toMatchObject({platformUi:true,draftRecovered:true,published:true,dynamicPrice:true,publicUnauthenticated:true,noRecompile:true,logout:true,storage:{local:0,session:0,preload:"undefined"}});
    expect(observed.consoleErrors,JSON.stringify(observed.consoleErrors)).toEqual([]);
    expect((await owner.query("SELECT status,version::int,price_minor::int,included_registers,additional_register_price_minor::int,support_price_minor::int FROM licensing.plans WHERE code=$1 ORDER BY version",[planCode])).rows)
      .toEqual([{status:"RETIRED",version:1,price_minor:4990000,included_registers:1,additional_register_price_minor:1990000,support_price_minor:1490000},
        {status:"ACTIVE",version:2,price_minor:5990000,included_registers:1,additional_register_price_minor:1990000,support_price_minor:1490000}]);
    const browserRows=await owner.query("SELECT s.revoked_at IS NOT NULL AS revoked FROM identity.sessions s JOIN identity.browser_sessions b ON b.session_id=s.id WHERE b.origin=$1",[browserOrigin]);
    expect(browserRows.rows).toHaveLength(2);expect(browserRows.rows.every(r=>r.revoked)).toBe(true);
    await owner.query("UPDATE identity.user_credentials SET status='REVOKED',revoked_at=clock_timestamp(),version=version+1 WHERE id=$1",[credential]);
    expect((await call("session",{},cookie,csrf)).status).toBe(401);
    expect((await call("logout",{},cookie,csrf)).body.closed).toBe(true); // Must close even after credential revocation.
    expect((await call("session",{},cookie,csrf)).status).toBe(401);
  }finally{
    if(tls){tls.closeAllConnections();await new Promise<void>(yes=>tls!.close(()=>yes()));}
    if(dir){if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("pos-global-api-"))throw Error("CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});}
  }
},90000);

it.runIf(Boolean(server))("pricing V2: runner 023, reversible empty schema, immutable quotes, stale/concurrent edits and publication rollback",async()=>{
  const u=new URL(server!);u.pathname="/"+db;u.username="pos_migrator";u.password="";
  const migrate=()=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts","--license-catalog"],{cwd:tool,encoding:"utf8",windowsHide:true,
    env:{...process.env,POSTGRES_MIGRATOR_URL:u.href,POSTGRES_EXPECTED_DATABASE:db,REPOSITORY_COMMIT:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",windowsHide:true}).trim(),
      POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"}}));
  migrate();expect(migrate().every((r:{status:string})=>r.status==='ALREADY_APPLIED')).toBe(true);
  const existingV2=Number((await owner.query("SELECT count(*) AS n FROM licensing.plans WHERE offer_profile='CAMACHO_LICENSE_OFFER_V2'")).rows[0].n);
  // Physical down/up, rolled back as one transaction: runner ledger is untouched.
  const c=await owner.connect();try{await c.query("BEGIN");await c.query("SET LOCAL ROLE pos_schema_owner");if(existingV2===0){
    await c.query(await sql("023_license_offer_terms.down.sql"));
    expect((await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='licensing' AND table_name='plans' AND column_name='currency_exponent'")).rowCount).toBe(0);
    await c.query(await sql("023_license_offer_terms.up.sql"));}await c.query("ROLLBACK");
  }finally{c.release();}
  // A preceding provider test may revoke its own temporary merchant credential.
  if((await owner.query("SELECT status FROM integrations.external_integrations WHERE id=$1",[merchant.integrationId])).rows[0].status==='CREDENTIAL_ROTATION_REQUIRED'){
    const credential=id();await owner.query(`INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,generation,status,created_at)
      VALUES($1,$2,$3,$4,'TEST_REPLACEMENT_ONLY','PROVIDER_API',2,'PENDING',now())`,[credential,merchant.tenantId,merchant.companyId,merchant.integrationId]);
    await owner.query("UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=now() WHERE id=$1",[credential]);
    for(const status of ['AUTHENTICATED','DISCOVERING','DISCOVERY_COMPLETE','READY_FOR_REVIEW','ACTIVE'])await owner.query("UPDATE integrations.external_integrations SET status=$2,version=version+1,updated_at=now() WHERE id=$1",[merchant.integrationId,status]);
  }
  const legacyService=new SubscriptionQuotes(runtime,policy(),limits),legacy=request();await legacyService.issue(globalSession,legacy);
  const history=(await owner.query("SELECT pricing_snapshot,quote_checksum FROM subscriptions.license_quotes WHERE id=$1",[legacy.id])).rows[0];
  const drafts=new LicenseOfferDrafts(runtime,60000);
  const existingCodes=(await drafts.administrativeCatalog(globalSession)).filter(p=>p.code.startsWith('CAMACHO_'));
  expect((await drafts.initializePreproduction(globalSession)).created).toHaveLength(existingCodes.length?0:3);
  expect((await drafts.initializePreproduction(globalSession)).created).toHaveLength(0);
  const initial:Array<LicenseOfferDraft&{version:number}>=[];
  for(const template of (await drafts.administrativeCatalog(globalSession)).filter(p=>"profile" in p&&p.code.startsWith('CAMACHO_')&&p.status==='ACTIVE'||"profile" in p&&p.code.startsWith('CAMACHO_')&&p.status==='DRAFT')){
    if(initial.some(p=>p.billing_model===template.billing_model))continue;
    const {version:_,status:__,published_at:___,...base}=template,p={...base,id:id(),code:'TEST_PRICE_V2_'+base.billing_model,price_minor:(base.billing_model==='MONTHLY'?49900:base.billing_model==='ANNUAL'?499000:1490000)*100};
    await drafts.save(globalSession,p,0,id());await drafts.publish(globalSession,p.id,1,id());initial.push({...p,version:1});
  }
  const regular=policy();const calendar:SubscriptionQuotePolicy={...regular,resolveTerms:args=>{
    const t=regular.resolveTerms(args)!;return {...t,service_until:args.pricing.billing_model==='PERPETUAL'?null:addLicenseCalendarMonths(t.service_from,args.pricing.billing_model==='MONTHLY'?1:12),
      support_until:args.supportSelected?addLicenseCalendarMonths(t.service_from,args.pricing.billing_model==='MONTHLY'?1:12):null};}};
  const service=new SubscriptionQuotes(runtime,calendar,limits),monthly={...initial.find(p=>p.billing_model==='MONTHLY')!,price_minor:4990000};
  const r={...request(monthly),selection:{additional_registers:0,support:false}};await service.issue(globalSession,r);
  const oldQuote=(await owner.query("SELECT * FROM subscriptions.license_quotes WHERE id=$1",[r.id])).rows[0];
  expect(oldQuote.total_minor).toBe("4990123"); // Test-only explicit tax result 123; never a production default.
  const updated={...monthly,id:id(),price_minor:5990000};const {version:_,...input}=updated;
  await drafts.save(globalSession,input,1,id());expect((await drafts.published()).find(p=>p.code===monthly.code)?.price_minor).toBe(4990000);
  await drafts.publish(globalSession,input.id,2,id());expect((await drafts.publish(globalSession,input.id,2,id())).idempotent).toBe(true);
  const next=await service.issue(globalSession,{...request(input),plan_version:2,selection:{additional_registers:0,support:false}});expect(next.totalMinor).toBe("5990123");
  await expect(service.issue(globalSession,{...request(monthly),id:id()})).rejects.toThrow();
  const raced=await Promise.allSettled([drafts.save(globalSession,{...input,id:id(),price_minor:6990000},2,id()),drafts.save(globalSession,{...input,id:id(),price_minor:7990000},2,id())]);
  expect(raced.filter(p=>p.status==='fulfilled')).toHaveLength(1);
  await expect(drafts.publish(globalSession,monthly.id,1,id())).rejects.toThrow("STALE_PUBLICATION");
  const pending=(await drafts.administrativeCatalog(globalSession)).find(p=>p.code===monthly.code&&p.status==='DRAFT')!;
  await owner.query(`CREATE FUNCTION public.reject_price_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action_code='LICENSE_OFFER_PUBLISHED' THEN RAISE EXCEPTION 'PRICE_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_price_publish BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_price_publish()`);
  try{await expect(drafts.publish(globalSession,pending.id,3,id())).rejects.toThrow("PRICE_AUDIT_FAILURE");}
  finally{await owner.query("DROP TRIGGER reject_price_publish ON audit.audit_events; DROP FUNCTION public.reject_price_publish()");}
  expect((await drafts.published()).find(p=>p.code===monthly.code)).toMatchObject({id:input.id,version:2,price_minor:5990000});
  expect((await owner.query("SELECT pricing_snapshot,quote_checksum FROM subscriptions.license_quotes WHERE id=$1",[legacy.id])).rows[0]).toEqual(history);
  expect((await owner.query("SELECT * FROM subscriptions.license_quotes WHERE id=$1",[r.id])).rows[0]).toEqual(oldQuote);
  await expect(owner.query("UPDATE licensing.plans SET currency_exponent=0 WHERE id=$1",[input.id])).rejects.toThrow();
  const down=await owner.connect();try{await down.query("BEGIN");await expect(down.query(await sql("023_license_offer_terms.down.sql"))).rejects.toThrow("Retained V2");await down.query("ROLLBACK");}finally{down.release();}
},60000);

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

it.runIf(Boolean(server))("capacity: canonical GLOBAL allocation, paid quota, DeviceProof, audit rollback and real Windows SQLite gate",async()=>{
  await exerciseLicenseCapacity({owner,runtime,user,grant,db,server:server!,buyer});
},60000);
