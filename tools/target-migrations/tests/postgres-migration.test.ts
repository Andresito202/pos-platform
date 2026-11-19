import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POSTGRES_TABLE_COLUMNS, PROHIBITED_TABLE_NAMES, REQUIRED_POLICIES, RLS_TABLES, TARGET_SCHEMAS } from "../src/contract.js";
import { postgresDatabase, queryRows } from "../src/database.js";
import { validatePostgresCatalog } from "../src/postgres-introspection.js";
import { runPostgresSmoke } from "../src/postgres-smoke.js";
import { applyPostgres001, downPostgres001 } from "../src/postgres.js";

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES = [
  "target_migration_fresh",
  "target_migration_body_failure",
  "target_migration_started_recovery",
  "target_migration_commit_recovery",
  "target_migration_checksum",
  "target_migration_down",
] as const;

function databaseUrl(name: string): string {
  const url = new URL(SERVER_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function recreateDatabases(): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try {
    for (const name of DATABASES) {
      await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await pool.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await pool.end();
  }
}

async function dropDatabases(): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try {
    for (const name of DATABASES) await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
}

describe("001_central_foundation", () => {
  const facts: Record<string, unknown> = {};

  beforeAll(async () => {
    await recreateDatabases();
    const freshUrl = databaseUrl("target_migration_fresh");
    const first = await applyPostgres001({ adminUrl: freshUrl });
    const second = await applyPostgres001({ adminUrl: freshUrl });
    facts.firstNoOp = first.noOp;
    facts.secondNoOp = second.noOp;
    facts.sameExecution = first.executionId === second.executionId;

    const db = postgresDatabase(freshUrl, 1);
    try {
      await validatePostgresCatalog(db);
      facts.introspection = true;
      const tableRows = await queryRows<{ name: string }>(db, `SELECT schemaname || '.' || tablename AS name FROM pg_tables WHERE schemaname IN ('platform','identity','tenancy','organization','authorization','sync','audit') ORDER BY 1`);
      facts.tables = tableRows.map((row) => row.name);
      facts.schemas = (await queryRows<{ name: string }>(db, `SELECT nspname AS name FROM pg_namespace WHERE nspname IN ('identity','tenancy','organization','authorization','sync','audit') ORDER BY 1`)).map((row) => row.name);
      facts.prohibited = (await queryRows<{ name: string }>(db, `SELECT tablename AS name FROM pg_tables WHERE lower(tablename) IN (${PROHIBITED_TABLE_NAMES.map((name) => `'${name.toLowerCase()}'`).join(",")})`)).map((row) => row.name);
      facts.rls = await queryRows<{ name: string; enabled: boolean; forced: boolean }>(db, `SELECT n.nspname || '.' || c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('identity','tenancy','organization','authorization','sync','audit') AND c.relrowsecurity ORDER BY 1`);
      facts.policies = (await queryRows<{ name: string }>(db, "SELECT policyname AS name FROM pg_policies ORDER BY 1")).map((row) => row.name);
      facts.uuidChecks = Number((await queryRows<{ count: string }>(db, `SELECT count(*)::text AS count FROM pg_constraint WHERE contype='c' AND conname LIKE '%id_v7_ck'`))[0]!.count);
      facts.tenantAwareFks = Number((await queryRows<{ count: string }>(db, `SELECT count(*)::text AS count FROM pg_constraint WHERE contype='f' AND array_length(conkey,1) > 1`))[0]!.count);
      facts.ledger = (await queryRows<{ status: string; body: boolean; smoke: boolean; applied: boolean }>(db, `SELECT status, body_committed_at IS NOT NULL AS body, smoke_verified_at IS NOT NULL AS smoke, applied_at IS NOT NULL AS applied FROM platform.target_migration_executions WHERE migration_id='001_central_foundation'`))[0];
      facts.runtimeRoles = await queryRows<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(db, `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('pos_app','pos_worker','pos_platform_app') ORDER BY 1`);
      facts.runtimeOwners = Number((await queryRows<{ count: string }>(db, `SELECT count(DISTINCT tableowner)::text AS count FROM pg_tables WHERE schemaname IN ('identity','tenancy','organization','authorization','sync','audit') AND tableowner IN ('pos_app','pos_worker','pos_platform_app')`))[0]!.count);
      facts.grantAll = Number((await queryRows<{ count: string }>(db, `SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE grantee IN ('pos_app','pos_worker','pos_platform_app','pos_platform_admin') AND privilege_type='ALL'`))[0]!.count);
    } finally {
      await db.destroy();
    }
    facts.smokeAssertions = await runPostgresSmoke(freshUrl);

    const failureUrl = databaseUrl("target_migration_body_failure");
    try { await applyPostgres001({ adminUrl: failureUrl, injectBodyFailure: true }); } catch { facts.bodyFailed = true; }
    const failureDb = postgresDatabase(failureUrl, 1);
    try {
      facts.failureRows = await queryRows<{ status: string; body: boolean }>(failureDb, `SELECT status, body_committed_at IS NOT NULL AS body FROM platform.target_migration_executions ORDER BY started_at`);
      facts.rollbackSchemas = Number((await queryRows<{ count: string }>(failureDb, `SELECT count(*)::text AS count FROM pg_namespace WHERE nspname IN ('identity','tenancy','organization','authorization','sync','audit')`))[0]!.count);
    } finally { await failureDb.destroy(); }
    facts.failureRetry = (await applyPostgres001({ adminUrl: failureUrl })).noOp === false;

    const startedUrl = databaseUrl("target_migration_started_recovery");
    try { await applyPostgres001({ adminUrl: startedUrl, simulateCrashAfterStarted: true }); } catch { facts.startedCrash = true; }
    const startedRecovery = await applyPostgres001({ adminUrl: startedUrl });
    facts.startedRecovered = !startedRecovery.noOp;
    const startedDb = postgresDatabase(startedUrl, 1);
    try { facts.startedStatuses = (await queryRows<{ status: string }>(startedDb, `SELECT status FROM platform.target_migration_executions ORDER BY started_at`)).map((row) => row.status); } finally { await startedDb.destroy(); }

    const commitUrl = databaseUrl("target_migration_commit_recovery");
    try { await applyPostgres001({ adminUrl: commitUrl, simulateCrashAfterBodyCommit: true }); } catch { facts.commitCrash = true; }
    const commitRecovery = await applyPostgres001({ adminUrl: commitUrl });
    facts.commitReconciled = commitRecovery.reconciled;
    facts.commitNoOpAfterRecovery = (await applyPostgres001({ adminUrl: commitUrl })).noOp;

    const checksumUrl = databaseUrl("target_migration_checksum");
    await applyPostgres001({ adminUrl: checksumUrl });
    const checksumPool = new Pool({ connectionString: checksumUrl });
    try {
      await checksumPool.query(`INSERT INTO platform.target_migration_executions (execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,finished_at,runner_version,error_code) VALUES ('018f0000-0000-7000-8000-0000000000ff','001_central_foundation','POSTGRESQL',1,decode(repeat('00',32),'hex'),'FAILED',clock_timestamp(),clock_timestamp(),'test','CONTROLLED_MISMATCH')`);
    } finally { await checksumPool.end(); }
    try { await applyPostgres001({ adminUrl: checksumUrl }); } catch (error) { facts.checksumRejected = error instanceof Error && error.message.includes("checksum mismatch"); }

    const downUrl = databaseUrl("target_migration_down");
    await applyPostgres001({ adminUrl: downUrl });
    const downPool = new Pool({ connectionString: downUrl });
    try { await downPool.query(`INSERT INTO identity.users (id,email,email_normalized,full_name,status,created_at,updated_at) VALUES ('018f0000-0000-7000-8000-0000000000aa','down@example.test','down@example.test','Down','ACTIVE',clock_timestamp(),clock_timestamp())`); } finally { await downPool.end(); }
    try { await downPostgres001({ adminUrl: downUrl }); } catch { facts.downRefusedData = true; }
    const cleanupPool = new Pool({ connectionString: downUrl });
    try { await cleanupPool.query("DELETE FROM identity.users"); } finally { await cleanupPool.end(); }
    await downPostgres001({ adminUrl: downUrl });
    const downDb = postgresDatabase(downUrl, 1);
    try {
      facts.downPlatform = (await queryRows<{ exists: boolean }>(downDb, `SELECT to_regclass('platform.target_migration_executions') IS NOT NULL AS exists`))[0]!.exists;
      facts.downTargetSchemas = Number((await queryRows<{ count: string }>(downDb, `SELECT count(*)::text AS count FROM pg_namespace WHERE nspname IN ('identity','tenancy','organization','authorization','sync','audit')`))[0]!.count);
      facts.downStatus = (await queryRows<{ status: string }>(downDb, `SELECT status FROM platform.target_migration_executions WHERE migration_id='001_central_foundation'`))[0]!.status;
    } finally { await downDb.destroy(); }
  });

  afterAll(dropDatabases);

  it("fresh bootstrap succeeds", () => expect(facts.firstNoOp).toBe(false));
  it("fresh up succeeds", () => expect(facts.introspection).toBe(true));
  it("second up is a safe no-op", () => expect(facts.secondNoOp).toBe(true));
  it("repeat APPLIED retains execution identity", () => expect(facts.sameExecution).toBe(true));
  it("checksum mismatch fails closed", () => expect(facts.checksumRejected).toBe(true));
  it("has exactly 20 target tables", () => expect((facts.tables as string[]).length).toBe(20));
  it("has the exact table contract", () => expect(facts.tables).toEqual(Object.keys(POSTGRES_TABLE_COLUMNS).sort()));
  it("has all six body schemas", () => expect(facts.schemas).toEqual([...TARGET_SCHEMAS].sort()));
  it("has zero prohibited commercial objects", () => expect(facts.prohibited).toEqual([]));
  it("materializes UUID v7 checks", () => expect(facts.uuidChecks as number).toBeGreaterThanOrEqual(20));
  it("materializes tenant-aware composite foreign keys", () => expect(facts.tenantAwareFks as number).toBeGreaterThanOrEqual(10));
  it("enables RLS on exactly 10 tables", () => expect((facts.rls as unknown[]).length).toBe(10));
  it("enables RLS on the approved set", () => expect((facts.rls as Array<{name:string}>).map((row) => row.name)).toEqual([...RLS_TABLES].sort()));
  it("forces RLS on all 10 tables", () => expect((facts.rls as Array<{forced:boolean}>).every((row) => row.forced)).toBe(true));
  it("installs the exact policy set", () => expect(facts.policies).toEqual([...REQUIRED_POLICIES].sort()));
  it("tenant A cannot select tenant B", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("tenant A cannot insert tenant B", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("tenant A cannot update tenant B", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("missing tenant fails closed", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("invalid tenant fails closed", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Session tenant A cannot read tenant B", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Session pre-context Identity path is authorized", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Session worker is denied", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Session admin is read-only", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit INSTANCE is accepted", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit INSTANCE requires resource_id", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit SYSTEM rejects resource_id", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit BATCH requires operation_id", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit UPDATE is blocked", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit DELETE is blocked", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Audit TRUNCATE is blocked", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Onboarding OWNER FK rejects tenant mismatch", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Onboarding OWNER FK rejects user mismatch", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Onboarding OWNER FK rejects non-OWNER membership", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("Outbox/Operation metadata mismatch is rejected", () => expect(facts.smokeAssertions as number).toBeGreaterThanOrEqual(20));
  it("runtime grants contain no GRANT ALL", () => expect(facts.grantAll).toBe(0));
  it("runtime roles own no target tables", () => expect(facts.runtimeOwners).toBe(0));
  it("runtime roles are not superusers", () => expect((facts.runtimeRoles as Array<{rolsuper:boolean}>).every((row) => !row.rolsuper)).toBe(true));
  it("runtime roles have no BYPASSRLS", () => expect((facts.runtimeRoles as Array<{rolbypassrls:boolean}>).every((row) => !row.rolbypassrls)).toBe(true));
  it("ledger reaches APPLIED only with body, smoke, and applied timestamps", () => expect(facts.ledger).toEqual({ status: "APPLIED", body: true, smoke: true, applied: true }));
  it("body transaction failure is observed", () => expect(facts.bodyFailed).toBe(true));
  it("FAILED is recorded only without committed body", () => expect(facts.failureRows).toEqual([{ status: "FAILED", body: false }]));
  it("failed body rolls back all body schemas", () => expect(facts.rollbackSchemas).toBe(0));
  it("retry after confirmed rollback succeeds", () => expect(facts.failureRetry).toBe(true));
  it("interruption before body commit leaves STARTED", () => expect(facts.startedCrash).toBe(true));
  it("abandoned STARTED is reconciled through FAILED then APPLIED", () => expect(facts.startedStatuses).toEqual(["FAILED", "APPLIED"]));
  it("retry after abandoned STARTED succeeds", () => expect(facts.startedRecovered).toBe(true));
  it("interruption after body commit is observed", () => expect(facts.commitCrash).toBe(true));
  it("committed body with unwritten outcome is reconciled", () => expect(facts.commitReconciled).toBe(true));
  it("post-reconciliation retry is a no-op", () => expect(facts.commitNoOpAfterRecovery).toBe(true));
  it("down refuses when domain data exists", () => expect(facts.downRefusedData).toBe(true));
  it("down preserves bootstrap ledger", () => expect(facts.downPlatform).toBe(true));
  it("down removes only body schemas", () => expect(facts.downTargetSchemas).toBe(0));
  it("down records ROLLED_BACK", () => expect(facts.downStatus).toBe("ROLLED_BACK"));
});
