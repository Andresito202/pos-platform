import {Pool} from "pg";
import {randomBytes} from "node:crypto";
import {afterEach,it,expect} from "vitest";
import {applyCommercialMigrations,COMMERCIAL_MIGRATIONS,commercialMigrationManifest} from "../src/postgres-commercial-runner.js";
import {readArtifact,sha256,uuidV7} from "../src/shared.js";
const server=process.env.POSTGRES_TEST_URL;
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(seed=true){
  const url=new URL(server!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!=="55433")throw Error("TEMPORARY_POSTGRES_ONLY");
  const admin=new Pool({connectionString:url.href,max:2}),db="pos_commercial_runner_test_"+randomBytes(8).toString("hex");
  if((await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pos_schema_owner'")).rowCount!==1){await admin.end();throw Error("TEMPORARY_CANONICAL_ROLES_REQUIRED");}
  await admin.query(`CREATE DATABASE "${db}"`);await admin.query(`GRANT CREATE ON DATABASE "${db}" TO pos_schema_owner`);
  url.pathname="/"+db;const owner=new Pool({connectionString:url.href,max:2});
  cleanup.push(async()=>{await owner.end();await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",[db]);await admin.query(`DROP DATABASE "${db}"`);await admin.end();});
  await owner.query(await readArtifact("postgres/bootstrap.sql"));
  const c=await owner.connect();try{await c.query("SET ROLE pos_schema_owner");
    for(const path of ["001_central_foundation","004_device_trust","006_licensing_foundation","007_password_recovery"])await c.query(await readArtifact(`postgres/${path}.up.sql`));
    if(seed)await c.query(`INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,body_committed_at,smoke_verified_at,applied_at,finished_at,runner_version)
      VALUES($1,'007_password_recovery','POSTGRESQL',1,$2,'APPLIED',clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),'TEMPORARY_FIXTURE_PREDECESSOR')`,[uuidV7(),sha256(await readArtifact("postgres/007_password_recovery.up.sql"))]);
  }finally{await c.query("RESET ROLE");c.release();}
  url.username="pos_migrator";url.password="";
  return {owner,db,input:{migratorUrl:url.href,expectedDatabase:db,repositoryCommit:"a2d858c9cb58ad7693a513268f864446cb4349d5",lockTimeoutMs:5000,statementTimeoutMs:20000}};
}
it.runIf(Boolean(server))("commercial runner: serializes apply/idempotency and enforces SQL least privilege and mandatory timeout",async()=>{
  const f=await fixture();const results=await Promise.all([applyCommercialMigrations(f.input),applyCommercialMigrations(f.input)]);
  expect(results.flat().filter(r=>r.status==="APPLIED")).toHaveLength(COMMERCIAL_MIGRATIONS.length);
  expect(results.flat().filter(r=>r.status==="ALREADY_APPLIED")).toHaveLength(COMMERCIAL_MIGRATIONS.length);
  const url=new URL(f.input.migratorUrl);url.username="pos_platform_app";const runtime=new Pool({connectionString:url.href,max:1});cleanup.push(()=>runtime.end());
  const c=await runtime.connect();try{
    await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true)",[uuidV7()]);
    await expect(c.query('SELECT "authorization".lock_sas_sources_for_read()')).rejects.toThrow("nonzero lock_timeout");await c.query("ROLLBACK");
    await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','250ms',true)",[uuidV7()]);
    await c.query('SELECT "authorization".lock_sas_sources_for_read()');await c.query("ROLLBACK");
    for(const table of ["roles","permissions","role_permission_grants"])
      expect((await c.query("SELECT has_any_column_privilege(current_user,$1,'UPDATE') AS granted",[`authorization.${table}`])).rows[0].granted).toBe(false);
  }finally{c.release();}
},60_000);
it.runIf(Boolean(server))("commercial runner: rejects missing predecessor and never applies a proposal directly",async()=>{
  const f=await fixture(false);await expect(applyCommercialMigrations(f.input)).rejects.toThrow("predecessor mismatch");
  expect((await f.owner.query("SELECT to_regclass('authorization.snapshot_sequences') AS object")).rows[0].object).toBeNull();
  expect(COMMERCIAL_MIGRATIONS.every(d=>!d.upArtifact.includes("proposals/"))).toBe(true);
},60_000);
it.runIf(Boolean(server))("commercial runner: DDL failure records FAILED and rolls back only that migration",async()=>{
  const f=await fixture();await f.owner.query("CREATE TABLE identity.webauthn_challenges(conflicting_fixture text)");
  await expect(applyCommercialMigrations(f.input)).rejects.toThrow();
  expect((await f.owner.query("SELECT status FROM platform.target_migration_executions WHERE migration_id='009_webauthn_challenges'")).rows[0].status).toBe("FAILED");
  expect((await f.owner.query("SELECT to_regclass('identity.webauthn_credential_material') AS object")).rows[0].object).toBeNull();
},60_000);
async function licensingFoundation(f:Awaited<ReturnType<typeof fixture>>){
  await f.owner.query(`INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,body_committed_at,smoke_verified_at,applied_at,finished_at,runner_version)
    VALUES($1,'006_licensing_foundation','POSTGRESQL',1,$2,'APPLIED',clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),'TEMPORARY_FIXTURE_PREDECESSOR')`,[uuidV7(),sha256(await readArtifact("postgres/006_licensing_foundation.up.sql"))]);
}
it.runIf(Boolean(server))("factus successor: refuses missing 003 before commercial DDL without changing authentication or pricing manifests",async()=>{
  const f=await fixture();await licensingFoundation(f);
  await expect(applyCommercialMigrations({...f.input,target:"FACTUS_PAY"})).rejects.toThrow("Factus Pay 003 predecessor mismatch");
  expect((await f.owner.query("SELECT to_regclass('identity.webauthn_challenges') AS object")).rows[0].object).toBeNull();
  expect(Object.keys(await commercialMigrationManifest())).toHaveLength(9);
  expect(Object.keys(await commercialMigrationManifest("LICENSING"))).toHaveLength(10);
  expect(Object.keys(await commercialMigrationManifest("FACTUS_PAY"))).toHaveLength(11);
},60000);
it.runIf(Boolean(server))("licensing successor: applies 017 once concurrently and preserves legacy prices and authentication manifest",async()=>{
  const f=await fixture();await licensingFoundation(f);const planId=uuidV7();
  await f.owner.query("INSERT INTO licensing.plans(id,code,name,billing_model,deployment_mode,currency_code,price_minor,status,version,created_at,updated_at) VALUES($1,'LEGACY_PRICE','Legacy','MONTHLY','HYBRID','COP',12345,'DRAFT',1,clock_timestamp(),clock_timestamp())",[planId]);
  const before=(await f.owner.query("SELECT row_to_json(p) AS value FROM licensing.plans p WHERE id=$1",[planId])).rows[0].value;
  const results=await Promise.all([applyCommercialMigrations({...f.input,target:"LICENSING"}),applyCommercialMigrations({...f.input,target:"LICENSING"})]);
  expect(results.flat().filter(r=>r.migrationId==="017_license_offer_pricing"&&r.status==="APPLIED")).toHaveLength(1);
  expect(results.flat().filter(r=>r.migrationId==="017_license_offer_pricing"&&r.status==="ALREADY_APPLIED")).toHaveLength(1);
  const after=(await f.owner.query("SELECT row_to_json(p) AS value FROM licensing.plans p WHERE id=$1",[planId])).rows[0].value;for(const [key,value] of Object.entries(before))expect(after[key]).toEqual(value);
  expect(after.offer_profile).toBeNull();expect(after.included_registers).toBeNull();
  expect(Object.keys(await commercialMigrationManifest())).toHaveLength(9);
  expect(Object.keys(await commercialMigrationManifest("LICENSING"))).toHaveLength(10);
  const checksum=(await f.owner.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id='017_license_offer_pricing' AND status='APPLIED'")).rows[0].checksum;
  expect(checksum).toBe((await commercialMigrationManifest("LICENSING"))["017_license_offer_pricing"]);
},60000);
it.runIf(Boolean(server))("licensing successor: missing 006 ledger rejects before DDL and 017 failure rolls its columns back",async()=>{
  const f=await fixture();await expect(applyCommercialMigrations({...f.input,target:"LICENSING"})).rejects.toThrow("Licensing 006 predecessor mismatch");
  expect((await f.owner.query("SELECT to_regclass('identity.webauthn_challenges') AS object")).rows[0].object).toBeNull();
  await licensingFoundation(f);await f.owner.query("ALTER TABLE licensing.plans ADD COLUMN included_registers text");
  await expect(applyCommercialMigrations({...f.input,target:"LICENSING"})).rejects.toThrow();
  expect((await f.owner.query("SELECT status FROM platform.target_migration_executions WHERE migration_id='017_license_offer_pricing'")).rows[0].status).toBe("FAILED");
  expect((await f.owner.query("SELECT 1 FROM pg_attribute WHERE attrelid='licensing.plans'::regclass AND attname='offer_profile' AND NOT attisdropped")).rowCount).toBe(0);
},60000);
