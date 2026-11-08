import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {Pool} from "pg";
import {readArtifact} from "../src/shared.js";

const connection=process.env.POSTGRES_QR001_URL;
const test=connection?it:it.skip;
let pool:Pool;
beforeAll(async()=>{
 if(!connection)return;
 pool=new Pool({connectionString:connection,max:2});
 await pool.query(`
   CREATE ROLE pos_schema_owner NOLOGIN;
   CREATE ROLE pos_platform_app NOLOGIN;
   CREATE ROLE pos_app NOLOGIN;
   CREATE ROLE pos_worker NOLOGIN;
   CREATE ROLE pos_reporting NOLOGIN;
   CREATE SCHEMA platform AUTHORIZATION pos_schema_owner;
   CREATE SCHEMA organization AUTHORIZATION pos_schema_owner;
   CREATE SCHEMA identity AUTHORIZATION pos_schema_owner;
   CREATE SCHEMA audit AUTHORIZATION pos_schema_owner;
   CREATE SCHEMA payments AUTHORIZATION pos_schema_owner;
   SET ROLE pos_schema_owner;
   CREATE FUNCTION platform.is_uuid_v7(value uuid) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS 'SELECT substring(value::text,15,1) = ''7''';
   CREATE FUNCTION audit.reject_append_only_mutation() RETURNS trigger
      LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''immutable''; END';
   CREATE TABLE organization.companies(
     tenant_id uuid NOT NULL,id uuid NOT NULL, PRIMARY KEY(tenant_id,id)
   );
   CREATE TABLE identity.device_registry(
     installation_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,
     company_id uuid NOT NULL,status text NOT NULL
   );
   INSERT INTO organization.companies(tenant_id,id) VALUES
     ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'),
     ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444');
   RESET ROLE;
 `);
 await pool.query("SET ROLE pos_schema_owner");
 try{await pool.query(await readArtifact("postgres/024_merchant_payment_destinations.up.sql"));}
 finally{await pool.query("RESET ROLE");}
});
afterAll(async()=>{if(connection)await pool?.end();});

describe("QR-001 PostgreSQL 16.14 physical DDL, tenant isolation and DB protections",()=>{
 test("creates all six RLS-forced tables with expected owner",async()=>{
  const r=await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='payments' AND c.relname LIKE 'merchant_%' AND c.relkind='r'`);
  expect(r.rows).toHaveLength(6);
  for(const row of r.rows){
    expect(row.relrowsecurity).toBe(true);
    expect(row.relforcerowsecurity).toBe(true);
    expect(row.owner).toBe("pos_schema_owner");
  }
 });
 test("enforces tenant+company RLS for app role and prevents cross-tenant SELECT",async()=>{
  const client=await pool.connect();
  const a="11111111-1111-4111-8111-111111111111";
  const b="22222222-2222-4222-8222-222222222222";
  const ca="33333333-3333-4333-8333-333333333333";
  const cb="44444444-4444-4444-8444-444444444444";
  const sha="a".repeat(64);
  try{
   await client.query("SET ROLE pos_platform_app");
   await client.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.company_id',$2,false)",[a,ca]);
   await client.query(`INSERT INTO payments.merchant_qr_assets
     (id,tenant_id,company_id,sha256,png_bytes,content_type,created_by,created_at)
     VALUES($1,$2,$3,$4,$5,'image/png',$6,now())`,[
       "01900000-0000-7000-8000-000000000001",a,ca,sha,Buffer.alloc(57),
       "01900000-0000-7000-8000-000000000002",
     ]);
   expect((await client.query("SELECT count(*)::int n FROM payments.merchant_qr_assets")).rows[0].n).toBe(1);
   await expect(client.query(`INSERT INTO payments.merchant_qr_assets
      (id,tenant_id,company_id,sha256,png_bytes,content_type,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,'image/png',$6,now())`,[
       "01900000-0000-7000-8000-000000000003",b,cb,sha,Buffer.alloc(57),
       "01900000-0000-7000-8000-000000000002",
      ])).rejects.toThrow();
   await client.query("SELECT set_config('app.tenant_id',$1,false),set_config('app.company_id',$2,false)",[b,cb]);
   expect((await client.query("SELECT count(*)::int n FROM payments.merchant_qr_assets")).rows[0].n).toBe(0);
   await client.query("RESET ROLE");
  } finally {await client.query("RESET ROLE").catch(()=>undefined);client.release();}
 });
 test("denies DELETE to app and all table access to POS local role",async()=>{
  const local=await pool.query(`SELECT has_table_privilege('pos_app','payments.merchant_qr_assets','SELECT') r,
     has_table_privilege('pos_app','payments.merchant_destinations','INSERT') i,
     has_table_privilege('pos_platform_app','payments.merchant_qr_assets','DELETE') d`);
  expect(local.rows[0]).toEqual({r:false,i:false,d:false});
 });
 test("database registers enabled immutable evidence guard and denies app DELETE",async()=>{
  const triggers=await pool.query(`SELECT tgname,tgenabled FROM pg_trigger
    WHERE tgrelid='payments.merchant_qr_assets'::regclass
      AND tgname='merchant_asset_immutable'`);
  expect(triggers.rows).toEqual([{tgname:"merchant_asset_immutable",tgenabled:"O"}]);
  const client=await pool.connect();
  try{
   await client.query("SET ROLE pos_platform_app");
   await expect(client.query("DELETE FROM payments.merchant_qr_assets")).rejects.toThrow();
  }finally{await client.query("RESET ROLE");client.release();}
 });
});
