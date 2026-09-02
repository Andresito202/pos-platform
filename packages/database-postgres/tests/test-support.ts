import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

/**
 * Bloque 24-B: applies the real, already-materialized migration artifacts
 * (`tools/target-migrations/sql/postgres/{bootstrap,001,004}...sql`) via raw
 * file reads + `pg`, not by importing `applyPostgres001`/`applyPostgres004`
 * — `database-postgres` cannot depend on `tools/target-migrations` (not a
 * registered project in `module-boundaries.json`, and adapters don't depend
 * on other tooling). The SQL text itself is the same artifact
 * `postgres-004-migration.test.ts` already proved applies correctly, real
 * roles/RLS/checksums included — this just runs it directly for adapter
 * tests, skipping the ledger/advisory-lock governance layer that's
 * irrelevant to testing the adapter's own read/write behavior.
 */
const SQL_ROOT = fileURLToPath(new URL("../../../tools/target-migrations/sql/postgres/", import.meta.url));

async function readSql(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, `file://${SQL_ROOT}`), "utf8");
}

export const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";

export function databaseUrl(name: string): string {
  const value = new URL(SERVER_URL);
  value.pathname = `/${name}`;
  return value.toString();
}

export function roleUrl(adminUrl: string, role: string): string {
  const value = new URL(adminUrl);
  value.username = role;
  value.password = "";
  return value.toString();
}

export async function recreateDatabase(name: string): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try {
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await pool.query(`CREATE DATABASE "${name}"`);
  } finally {
    await pool.end();
  }
}

export async function dropDatabase(name: string): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try {
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
}

// Same 7 roles `ensureRoles` (tools/target-migrations/src/postgres.ts, not importable across
// this module boundary) creates before any migration body runs — duplicated here for the same
// reason as cash-policy-sentinel.ts's constants: a physical-layer detail, not shared domain code.
const ROLE_DDL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_schema_owner') THEN
    CREATE ROLE pos_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_migrator') THEN
    CREATE ROLE pos_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_worker') THEN
    CREATE ROLE pos_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_platform_app') THEN
    CREATE ROLE pos_platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_platform_admin') THEN
    CREATE ROLE pos_platform_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_reporting') THEN
    CREATE ROLE pos_reporting NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member
    WHERE parent.rolname = 'pos_schema_owner' AND member.rolname = 'pos_migrator'
  ) THEN
    GRANT pos_schema_owner TO pos_migrator;
  END IF;
END $$;
`;

export async function applyCashSchema(dbUrl: string): Promise<void> {
  const bootstrap = await readSql("bootstrap.sql");
  const foundation = await readSql("001_central_foundation.up.sql");
  const cash = await readSql("004_cash_foundation.up.sql");
  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(ROLE_DDL);
    // pos_schema_owner is a fresh, empty role — it has no CREATE privilege on this database
    // until granted one, same grant `ensureRoles` (tools/target-migrations) issues for real.
    const database = await pool.query<{ name: string }>("SELECT current_database() AS name");
    await pool.query(`GRANT CREATE ON DATABASE "${database.rows[0]!.name}" TO pos_schema_owner`);
    await pool.query("SET ROLE pos_schema_owner");
    await pool.query(bootstrap);
    await pool.query(foundation);
    await pool.query(cash);
  } finally {
    await pool.end();
  }
}
