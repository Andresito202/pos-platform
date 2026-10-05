import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readArtifact } from "../src/shared.js";
import { applyPostgres001 } from "../src/postgres.js";

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "target_005_onboarding_rls";

function databaseUrl(): string { const url = new URL(SERVER_URL); url.pathname = "/" + DATABASE; return url.toString(); }
function roleUrl(base: string, role: string): string { const url = new URL(base); url.username = role; url.password = ""; return url.toString(); }

describe("005 onboarding bootstrap hardening physical RLS", () => {
  beforeAll(async () => {
    const admin = new Pool({ connectionString: SERVER_URL });
    try {
      await admin.query('DROP DATABASE IF EXISTS "' + DATABASE + '" WITH (FORCE)');
      await admin.query('CREATE DATABASE "' + DATABASE + '"');
    } finally { await admin.end(); }

    const url = databaseUrl();
    await applyPostgres001({ adminUrl: url });

    const owner = new Pool({ connectionString: roleUrl(url, "pos_migrator") });
    try {
      const sql = await readArtifact("postgres/005_onboarding_bootstrap_hardening.up.sql");
      const client = await owner.connect();
      try {
        await client.query("SET ROLE pos_schema_owner");
        await client.query(sql);
      } finally { client.release(); }
    } finally { await owner.end(); }
  });

  afterAll(async () => {
    const admin = new Pool({ connectionString: SERVER_URL });
    try { await admin.query('DROP DATABASE IF EXISTS "' + DATABASE + '" WITH (FORCE)'); } finally { await admin.end(); }
  });

  it("isolates pre-tenant onboarding rows by authenticated actor", async () => {
    const pool = new Pool({ connectionString: roleUrl(databaseUrl(), "pos_platform_app") });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_id',$1,true)", ["01890f5a-0000-7000-8000-000000000001"]);
      await client.query(
        `INSERT INTO tenancy.onboarding_operations
          (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
         VALUES ($1,'PLATFORM_ACCOUNT',$2,'key-a',$3,$4,'COMM-005','IN_PROGRESS',clock_timestamp(),clock_timestamp(),1)`,
        ["01890f5a-0000-7000-8000-000000000010","01890f5a-0000-7000-8000-000000000001","a".repeat(64),"01890f5a-0000-7000-8000-000000000011"],
      );
      const visible = await client.query("SELECT id::text FROM tenancy.onboarding_operations");
      expect(visible.rows).toHaveLength(1);
      await client.query("SELECT set_config('app.actor_id',$1,true)", ["01890f5a-0000-7000-8000-000000000002"]);
      expect((await client.query("SELECT id::text FROM tenancy.onboarding_operations")).rows).toHaveLength(0);
      await client.query("ROLLBACK");
    } finally { client.release(); await pool.end(); }
  });

  it("rejects cross-actor bootstrap insert and enforces commercial reference uniqueness", async () => {
    const pool = new Pool({ connectionString: roleUrl(databaseUrl(), "pos_platform_app") });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_id',$1,true)", ["01890f5a-0000-0000-0000-000000000002"]);
      await client.query(
        `INSERT INTO tenancy.onboarding_operations
          (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
         VALUES ($1,'PLATFORM_ACCOUNT',$2,'key-b',$3,$4,'COMM-005','IN_PROGRESS',clock_timestamp(),clock_timestamp(),1)`,
        ["01890f5a-0000-0000-0000-000000000012","01890f5a-0000-0000-0000-000000000002","b".repeat(64),"01890f5a-0000-0000-0000-000000000013"],
      );
      await client.query("COMMIT");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_id',$1,true)", ["01890f5a-0000-0000-0000-000000000002"]);
      await expect(client.query(
        `INSERT INTO tenancy.onboarding_operations
          (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
         VALUES ($1,'PLATFORM_ACCOUNT',$2,'key-c',$3,$4,'COMM-005','IN_PROGRESS',clock_timestamp(),clock_timestamp(),1)`,
        ["01890f5a-0000-0000-0000-000000000014","01890f5a-0000-0000-0000-000000000002","c".repeat(64),"01890f5a-0000-0000-0000-000000000015"],
      )).rejects.toThrow();
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor_id',$1,true)", ["01890f5a-0000-0000-0000-000000000002"]);
      await expect(client.query(
        `INSERT INTO tenancy.onboarding_operations
          (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
         VALUES ($1,'PLATFORM_ACCOUNT',$2,'key-d',$3,$4,'COMM-006','IN_PROGRESS',clock_timestamp(),clock_timestamp(),1)`,
        ["01890f5a-0000-0000-0000-000000000016","01890f5a-0000-0000-0000-000000000003","d".repeat(64),"01890f5a-0000-0000-0000-000000000017"],
      )).rejects.toThrow();
      await client.query("ROLLBACK");
    } finally { client.release(); await pool.end(); }
  });;
});
