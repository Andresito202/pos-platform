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
 test("physically shares one renewal sequence across four reads and rotates only after TTL margin",async()=>{
  // Executable PostgreSQL counterpart of the publisher's CTE. The table
  // trigger MUST permit a fresh no-op SELECT and a monotonic aged renewal.
  const client=await pool.connect();
  const selectGeneration=`WITH renewed AS (
       UPDATE payments.merchant_destination_sequences
       SET sequence=sequence+1,updated_at=clock_timestamp()
       WHERE tenant_id=$1 AND company_id=$2
         AND updated_at<=clock_timestamp()-(($3::integer-900000)*interval '1 millisecond')
       RETURNING sequence::text AS sequence
     )
     SELECT sequence,clock_timestamp() AS now FROM renewed
     UNION ALL
     SELECT sequence::text AS sequence,clock_timestamp() AS now
       FROM payments.merchant_destination_sequences
       WHERE tenant_id=$1 AND company_id=$2 AND NOT EXISTS(SELECT 1 FROM renewed)`;
  const cases=[
   {tenant:"11111111-1111-4111-8111-111111111111",company:"33333333-3333-4333-8333-333333333333",ageMinutes:0,expected:4},
   {tenant:"22222222-2222-4222-8222-222222222222",company:"44444444-4444-4444-8444-444444444444",ageMinutes:46,expected:5},
  ];
  try{
   await client.query("SET ROLE pos_platform_app");
   for(const item of cases){
    await client.query("BEGIN");
    try{
     await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)",
       [item.tenant,item.company]);
     await client.query(`INSERT INTO payments.merchant_destination_sequences
       (tenant_id,company_id,sequence,updated_at)
       VALUES($1,$2,4,clock_timestamp()-($3::integer*interval '1 minute'))`,
       [item.tenant,item.company,item.ageMinutes]);
     for(let register=0;register<4;register++){
       const current=await client.query(selectGeneration,[item.tenant,item.company,3600000]);
       expect(current.rowCount).toBe(1);
       expect(Number(current.rows[0]?.sequence)).toBe(item.expected);
       expect(current.rows[0]?.now).toBeInstanceOf(Date);
     }
     await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
   }
  }finally{await client.query("RESET ROLE").catch(()=>undefined);client.release();}
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
 test("QR-002 migration 025 gates SMS evidence by tenant consent, active device, immutable status and revocation",async()=>{
  // Migration 025 runs after every 024 test against the same disposable database.
  await pool.query("SET ROLE pos_schema_owner");
  try{
   await pool.query(await readArtifact("postgres/025_merchant_payment_notifications.up.sql"));
   await pool.query(`INSERT INTO identity.device_registry(installation_id,tenant_id,company_id,status)
    VALUES('55555555-5555-4555-8555-555555555555',
           '11111111-1111-4111-8111-111111111111',
           '33333333-3333-4333-8333-333333333333','ACTIVE')`);
  }finally{await pool.query("RESET ROLE");}
  const r=await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='payments' AND c.relname IN
      ('merchant_notification_bridge_consents','merchant_payment_notification_inbox')`);
  expect(r.rows).toHaveLength(2);
  for(const row of r.rows){expect(row.relrowsecurity).toBe(true);expect(row.relforcerowsecurity).toBe(true);}
  const privileges=await pool.query(`SELECT
    has_table_privilege('pos_platform_app','payments.merchant_payment_notification_inbox','UPDATE') AS can_update,
    has_table_privilege('pos_platform_app','payments.merchant_payment_notification_inbox','DELETE') AS can_delete,
    has_table_privilege('pos_app','payments.merchant_payment_notification_inbox','SELECT') AS local_read`);
  expect(privileges.rows[0]).toEqual({can_update:false,can_delete:false,local_read:false});
  const client=await pool.connect();
  const a="11111111-1111-4111-8111-111111111111";
  const ca="33333333-3333-4333-8333-333333333333";
  const b="22222222-2222-4222-8222-222222222222";
  const cb="44444444-4444-4444-8444-444444444444";
  const installation="55555555-5555-4555-8555-555555555555";
  try{
   await client.query("SET ROLE pos_platform_app");
   await client.query("BEGIN");
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)",[a,ca]);
   await expect(client.query(`INSERT INTO payments.merchant_payment_notification_inbox
      (id,tenant_id,company_id,source_installation_id,message_sha256,
       observed_at,received_at,sender_label)
      VALUES($1,$2,$3,$4,$5,now(),now(),'SMS Negocios')`,
      ["01900000-0000-7000-8000-000000000031",a,ca,"66666666-6666-4666-8666-666666666666","a".repeat(64)]))
     .rejects.toThrow();
   await client.query("ROLLBACK");
   await client.query("BEGIN");
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)",[a,ca]);
   await client.query(`INSERT INTO payments.merchant_notification_bridge_consents
     (tenant_id,company_id,installation_id,granted_by)
     VALUES($1,$2,$3,$4)`,[a,ca,installation,"77777777-7777-4777-8777-777777777777"]);
   await client.query(`INSERT INTO payments.merchant_payment_notification_inbox
      (id,tenant_id,company_id,source_installation_id,message_sha256,
       observed_at,received_at,sender_label)
      VALUES($1,$2,$3,$4,$5,now(),now(),'SMS Negocios')`,
      ["01900000-0000-7000-8000-000000000032",a,ca,installation,"b".repeat(64)]);
   expect((await client.query("SELECT count(*)::integer AS n FROM payments.merchant_payment_notification_inbox")).rows[0].n).toBe(1);
   await client.query("COMMIT");
   await client.query("BEGIN");
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)",[b,cb]);
   expect((await client.query("SELECT count(*)::integer AS n FROM payments.merchant_payment_notification_inbox")).rows[0].n).toBe(0);
   await client.query("COMMIT");
   await client.query("BEGIN");
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)",[a,ca]);
   await client.query(`UPDATE payments.merchant_notification_bridge_consents
      SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND company_id=$2 AND installation_id=$3`,
      [a,ca,installation]);
   await client.query("COMMIT");
   await client.query("BEGIN");
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)",[a,ca]);
   await expect(client.query(`INSERT INTO payments.merchant_payment_notification_inbox
      (id,tenant_id,company_id,source_installation_id,message_sha256,
       observed_at,received_at,sender_label)
      VALUES($1,$2,$3,$4,$5,now(),now(),'SMS Negocios')`,
      ["01900000-0000-7000-8000-000000000033",a,ca,installation,"c".repeat(64)])).rejects.toThrow();
   await client.query("ROLLBACK");
  }finally{await client.query("RESET ROLE").catch(()=>undefined);client.release();}
  // A full-schema-owner read must see existing evidence despite FORCE RLS.
  // Otherwise the DOWN guard could destroy an invisible merchant's records.
  await pool.query("SET ROLE pos_schema_owner");
  try{
   await expect(pool.query(await readArtifact("postgres/025_merchant_payment_notifications.down.sql")))
     .rejects.toThrow("QR-002 cannot downgrade");
  }finally{await pool.query("RESET ROLE");}
 });

});
