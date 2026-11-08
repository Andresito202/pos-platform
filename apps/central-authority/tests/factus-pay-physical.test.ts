import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgresPool, PostgresFactusPayWebhookInboxRepository, type Pool } from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/contracts";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename, dirname } from "node:path";
import { createServer, request, type Server } from "node:https";
import { prepareFactusPayRuntime } from "../src/factus-pay-runtime.js";
import { normalizeFactusPayCollectionWebhook } from "../src/factus-pay-collection-event.js";

const url=process.env.POSTGRES_TEST_URL,db="pos_factus_ingress_test_"+randomBytes(8).toString("hex");
const sqlRoot=new URL("../../../tools/target-migrations/sql/postgres/",import.meta.url),tool=resolve("../../tools/target-migrations");
const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
let admin:Pool,owner:Pool,runtime:Pool,server:Server,dir:string,created=false,cert:Buffer;
let a:{tenant:string;company:string;integration:string;binding:string;keyId:string;secret:string};
let b:typeof a,repo:PostgresFactusPayWebhookInboxRepository;
const host="factus-ingress.test";
const sql=(name:string)=>readFile(new URL(name,sqlRoot),"utf8");
async function seed(provider:string,adapter:string){
  const s={tenant:uuidV7(),company:uuidV7(),integration:uuidV7(),binding:uuidV7(),keyId:uuidV7(),secret:randomBytes(32).toString("base64url")};
  await owner.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Temporary','ACTIVE',now(),now())",[s.tenant]);
  await owner.query("INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES($1,$2,'Temporary','America/Bogota','COP','ACTIVE',now(),now())",[s.company,s.tenant]);
  await owner.query(`INSERT INTO integrations.external_integrations(id,tenant_id,company_id,provider_id,provider_code_snapshot,provider_adapter_version_id,
    environment,status,configuration_version,created_at,updated_at) VALUES($1,$2,$3,$4,'FACTUS_PAY',$5,'SANDBOX','CREDENTIALS_CONFIGURED',1,now(),now())`,[s.integration,s.tenant,s.company,provider,adapter]);
  await owner.query(`INSERT INTO integrations.integration_credential_bindings(id,tenant_id,company_id,integration_id,credential_reference,credential_kind,
    generation,status,created_at) VALUES($1,$2,$3,$4,'temporary-reference','PROVIDER_API',1,'PENDING',now())`,[s.binding,s.tenant,s.company,s.integration]);
  await owner.query("UPDATE integrations.integration_credential_bindings SET status='ACTIVE',activated_at=now() WHERE id=$1",[s.binding]);
  for(const state of ["AUTHENTICATED","DISCOVERING","DISCOVERY_COMPLETE","READY_FOR_REVIEW","ACTIVE"])
    await owner.query("UPDATE integrations.external_integrations SET status=$2,updated_at=now(),version=version+1 WHERE id=$1",[s.integration,state]);
  await owner.query(`INSERT INTO integrations.factus_pay_webhook_keys(id,tenant_id,company_id,integration_id,secret_sha256,status,created_at)
    VALUES($1,$2,$3,$4,$5,'ACTIVE',now())`,[s.keyId,s.tenant,s.company,s.integration,sha(s.secret)]);return s;
}

beforeAll(async()=>{
  if(!url)return;const u=new URL(url);
  if(!["127.0.0.1","localhost"].includes(u.hostname)||u.port!=="55433")throw Error("TEMPORARY_POSTGRES_ONLY");
  admin=createPostgresPool(url,2,"factus-temp-admin");
  await admin.query(`CREATE DATABASE "${db}"`);created=true;
  u.pathname="/"+db;
  execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",
    "const {applyPostgres001}=await import('./src/postgres.ts');await applyPostgres001({adminUrl:process.env.FIXTURE_DATABASE_URL})"],
    {cwd:tool,windowsHide:true,env:{...process.env,FIXTURE_DATABASE_URL:u.href},stdio:"pipe"});
  owner=createPostgresPool(u.href,2,"factus-temp-owner");
  const c=await owner.connect();try{await c.query("SET ROLE pos_schema_owner");await c.query("CREATE EXTENSION btree_gist");
    for(const name of ["002_external_integrations_foundation","003_fiscal_electronic_invoicing_foundation",
      "004_device_trust","006_licensing_foundation","007_password_recovery"])await c.query(await sql(name+".up.sql"));
    for(const name of ["003_fiscal_electronic_invoicing_foundation","006_licensing_foundation","007_password_recovery"])
      await c.query(`INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,body_committed_at,
        smoke_verified_at,applied_at,finished_at,runner_version) VALUES($1,$2,'POSTGRESQL',1,$3,'APPLIED',now(),now(),now(),now(),now(),'TEMPORARY_FIXTURE_PREDECESSOR')`,
        [uuidV7(),name,Buffer.from(sha(await sql(name+".up.sql")),"hex")]);
  }finally{await c.query("RESET ROLE");c.release();}
  u.username="pos_migrator";u.password="";
  const env={...process.env,POSTGRES_MIGRATOR_URL:u.href,POSTGRES_EXPECTED_DATABASE:db,
    REPOSITORY_COMMIT:execFileSync("git",["rev-parse","HEAD"],{cwd:tool,encoding:"utf8",windowsHide:true}).trim(),
    POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"};
  const cli=(args:string[])=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts",...args],{cwd:tool,windowsHide:true,env,encoding:"utf8"}));
  const first=cli(["--factus-pay"]),again=cli(["--factus-pay"]);
  expect(first.filter((r:{status:string})=>r.status==="APPLIED")).toHaveLength(11);
  expect(again.every((r:{status:string})=>r.status==="ALREADY_APPLIED")).toBe(true);
  expect(Object.keys(cli(["--manifest"]))).toHaveLength(9);
  const manifest=cli(["--factus-pay","--manifest"]);
  // Revalidate the closed 003 catalog with only the named successor extension allowed.
  const code="const {postgresDatabase}=await import('./src/database.ts');const {validatePostgres003Catalog}=await import('./src/postgres-003-introspection.ts');const d=postgresDatabase(process.env.CATALOG_URL);try{await validatePostgres003Catalog(d)}finally{await d.destroy()}";
  u.username="postgres";execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",code],{cwd:tool,windowsHide:true,env:{...env,CATALOG_URL:u.href},stdio:"pipe"});
  u.username="pos_platform_app";runtime=createPostgresPool(u.href,5,"factus-temp-runtime");
  repo=new PostgresFactusPayWebhookInboxRepository({pool:runtime,lockTimeoutMs:1000,statementTimeoutMs:5000});
  const provider=uuidV7(),adapter=uuidV7();
  await owner.query(`INSERT INTO integrations.provider_registry(provider_id,provider_code,display_name,integration_class,status,created_at,updated_at)
    VALUES($1,'FACTUS_PAY','Temporary Factus','OTHER_REVIEW_REQUIRED','ACTIVE',now(),now())`,[provider]);
  await owner.query(`INSERT INTO integrations.provider_adapter_versions(provider_adapter_version_id,provider_id,adapter_code,adapter_version,contract_version,
    implementation_status,verification_status,created_at) VALUES($1,$2,'FACTUS_PAY','TEST',1,'IMPLEMENTED','MOCK_TESTED',now())`,[adapter,provider]);
  a=await seed(provider,adapter);b=await seed(provider,adapter);
  dir=await mkdtemp(join(tmpdir(),"pos-factus-ingress-"));
  execFileSync("C:/Program Files/Git/usr/bin/openssl.exe",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN="+host,"-addext","subjectAltName=DNS:"+host,"-keyout",join(dir,"tls.key"),"-out",join(dir,"tls.crt")],{stdio:"ignore",windowsHide:true});
  const provision=join(dir,"ingress.json");await writeFile(provision,JSON.stringify({profile:"CAMACHO_FACTUS_PAY_INGRESS_V1",policy_reference:"TEMPORARY_TEST_ONLY",
    migration_checksum:manifest["018_factus_pay_webhook_inbox"],max_body_bytes:16384,lock_timeout_ms:1000,statement_timeout_ms:5000,rate_limit:{maximum:100,buckets:10,window_ms:60000}}));
  cert=await readFile(join(dir,"tls.crt"));server=createServer({key:await readFile(join(dir,"tls.key")),cert},await prepareFactusPayRuntime(runtime,provision));
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
},60000);
afterAll(async()=>{
  if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  await runtime?.end();await owner?.end();if(created)await admin.query(`DROP DATABASE "${db}"`);await admin?.end();
  if(dir){if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("pos-factus-ingress-"))throw Error("CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});}
});
function post(secret:string,reference:string,amount=150000,extra:Record<string,unknown>={}){
  const body=JSON.stringify({data:{reference_code:reference,amount,status:"paid",...extra}});
  return new Promise<number>((yes,no)=>{
    const req=request({host:"127.0.0.1",port:(server.address() as {port:number}).port,servername:host,ca:cert,agent:false,
      path:"/v1/webhooks/factus-pay/collections?key="+encodeURIComponent(secret),method:"POST",headers:{"content-type":"application/json","content-length":Buffer.byteLength(body)}},
      res=>{res.resume();res.on("end",()=>yes(res.statusCode!));});req.on("error",no);req.end(body);
  });
}
it.runIf(Boolean(url))("Factus physical: HTTPS → registered 018 → durable inbox, RLS, concurrency and rollback without license activation",async()=>{
  expect(await post("wrong","A")).toBe(401);
  expect(await post(a.secret,"A",150000,{tenant_id:b.tenant,company_id:b.company})).toBe(204);
  expect(await Promise.all(Array.from({length:5},()=>post(a.secret,"A")))).toEqual([204,204,204,204,204]);
  expect(await post(a.secret,"A",150001)).toBe(503);
  expect(await post(b.secret,"A")).toBe(204);
  const rows=(await owner.query("SELECT tenant_id,company_id,amount::text FROM integrations.factus_pay_webhook_inbox ORDER BY tenant_id")).rows;
  expect(rows).toHaveLength(2);expect(rows.find(r=>r.tenant_id===a.tenant)?.company_id).toBe(a.company);
  expect(rows.every(r=>r.amount==="150000.000000")).toBe(true);
  await expect(runtime.query("UPDATE integrations.factus_pay_webhook_inbox SET amount=1")).rejects.toThrow("permission denied");
  await expect(owner.query("UPDATE integrations.factus_pay_webhook_inbox SET amount=1")).rejects.toThrow("immutable columns");
  expect((await owner.query("SELECT count(*)::int AS n FROM audit.audit_events WHERE action_code='FACTUS_PAY_COLLECTION_OBSERVED'")).rows[0].n).toBe(2);
  await owner.query(`CREATE FUNCTION public.reject_factus_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action_code='FACTUS_PAY_COLLECTION_OBSERVED' THEN RAISE EXCEPTION 'temporary audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_factus_audit BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_factus_audit()`);
  expect(await post(a.secret,"ROLLBACK")).toBe(503);
  expect((await owner.query("SELECT 1 FROM integrations.factus_pay_webhook_inbox WHERE external_transaction_id='ROLLBACK'")).rowCount).toBe(0);
  await owner.query("DROP TRIGGER reject_factus_audit ON audit.audit_events; DROP FUNCTION public.reject_factus_audit()");
  expect(await post(a.secret,"ROLLBACK")).toBe(204);
  const context=(await repo.resolveKey(a.secret))!;
  const obs=normalizeFactusPayCollectionWebhook({data:{reference_code:"REVOKED",amount:150000,status:"paid"}});
  await owner.query("UPDATE integrations.external_integrations SET status='DISABLED',disabled_at=now(),updated_at=now(),version=version+1 WHERE id=$1",[a.integration]);
  await owner.query("UPDATE integrations.integration_credential_bindings SET status='REVOKED',revoked_at=now() WHERE id=$1",[a.binding]);
  await expect(repo.persistVerifiedObservation(obs,context,"FACTUS_PAY:REVOKED")).rejects.toThrow("REVOKED");
  expect(await post(a.secret,"AFTER_REVOKE")).toBe(401);
  await owner.query("UPDATE integrations.factus_pay_webhook_keys SET status='REVOKED',revoked_at=now() WHERE id=$1",[b.keyId]);
  expect(await post(b.secret,"AFTER_KEY_REVOKE")).toBe(401);
  const down=await owner.connect();try{await down.query("BEGIN");await down.query("SET LOCAL ROLE pos_schema_owner");
    await expect(down.query(await sql("018_factus_pay_webhook_inbox.down.sql"))).rejects.toThrow("018 down refused");
  }finally{await down.query("ROLLBACK");down.release();}
  expect((await owner.query("SELECT count(*)::int AS n FROM licensing.licenses")).rows[0].n).toBe(0);
  expect((await owner.query("SELECT has_table_privilege('pos_app','integrations.factus_pay_webhook_inbox','SELECT') AS allowed")).rows[0].allowed).toBe(false);
},60000);
