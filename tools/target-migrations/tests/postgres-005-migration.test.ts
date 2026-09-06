import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG_005_RLS_TABLES, CATALOG_TABLES } from "../src/contract.js";
import { postgresDatabase, queryRows } from "../src/database.js";
import { validatePostgres005Catalog, validatePostgresCatalog } from "../src/postgres-introspection.js";
import { applyPostgres001, applyPostgres005, downPostgres001, downPostgres005 } from "../src/postgres.js";

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES = [
  "target_005_fresh",
  "target_005_dependency",
  "target_005_failure",
  "target_005_started",
  "target_005_commit",
  "target_005_checksum",
  "target_005_down",
  "target_005_concurrent",
  "target_005_up_down_race",
] as const;
const url = (name: string) => { const value = new URL(SERVER_URL); value.pathname = `/${name}`; return value.toString(); };

async function recreate(): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try { for (const name of DATABASES) { await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await pool.query(`CREATE DATABASE "${name}"`); } }
  finally { await pool.end(); }
}
async function drop(): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try { for (const name of DATABASES) await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
  finally { await pool.end(); }
}

describe("005_catalog_foundation", () => {
  const facts: Record<string, unknown> = {};

  beforeAll(async () => {
    await recreate();

    const fresh = url("target_005_fresh");
    await applyPostgres001({ adminUrl: fresh });
    const first = await applyPostgres005({ adminUrl: fresh });
    const second = await applyPostgres005({ adminUrl: fresh });
    facts.firstNoOp = first.noOp;
    facts.secondNoOp = second.noOp;
    facts.sameExecution = first.executionId === second.executionId;

    const db = postgresDatabase(fresh, 1);
    try {
      await validatePostgresCatalog(db); facts.validator001 = true;
      await validatePostgres005Catalog(db); facts.validator005 = true;
      facts.tables = (await queryRows<{ name: string }>(db, "SELECT tablename AS name FROM pg_tables WHERE schemaname='catalog' ORDER BY 1")).map((row) => row.name);
      facts.rls = await queryRows<{ name: string; enabled: boolean; forced: boolean }>(
        db,
        "SELECT c.relname AS name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='catalog' AND c.relrowsecurity ORDER BY 1",
      );
      facts.ledger = await queryRows<{ migration_id: string; status: string }>(db, "SELECT migration_id,status FROM platform.target_migration_executions WHERE status='APPLIED' ORDER BY migration_id");
      facts.reportingGrants = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='catalog' AND grantee='pos_reporting'"))[0]!.count);
      facts.adminMutations = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='catalog' AND grantee='pos_platform_admin' AND privilege_type<>'SELECT'"))[0]!.count);
      facts.dangerousGrants = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='catalog' AND grantee IN ('pos_app','pos_worker','pos_platform_admin') AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')"))[0]!.count);
      facts.seeds = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM catalog.products"))[0]!.count);
    } finally {
      await db.destroy();
    }

    const dependency = url("target_005_dependency");
    try { await applyPostgres005({ adminUrl: dependency }); } catch (error) { facts.missingDependency = error instanceof Error && error.message.includes("requires approved 001"); }

    const failure = url("target_005_failure");
    await applyPostgres001({ adminUrl: failure });
    try { await applyPostgres005({ adminUrl: failure, injectBodyFailure: true }); } catch { facts.bodyFailure = true; }
    const failureDb = postgresDatabase(failure, 1);
    try {
      facts.failureState = (await queryRows<{ status: string; body: boolean; schema: boolean }>(
        failureDb,
        "SELECT e.status,e.body_committed_at IS NOT NULL AS body,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='catalog') AS schema FROM platform.target_migration_executions e WHERE migration_id='005_catalog_foundation'",
      ))[0];
    } finally { await failureDb.destroy(); }
    facts.failureRetry = !(await applyPostgres005({ adminUrl: failure })).noOp;

    const started = url("target_005_started");
    await applyPostgres001({ adminUrl: started });
    try { await applyPostgres005({ adminUrl: started, simulateCrashAfterStarted: true }); } catch { facts.startedCrash = true; }
    facts.startedRecovered = (await applyPostgres005({ adminUrl: started })).noOp === false;
    const startedDb = postgresDatabase(started, 1);
    try { facts.startedStatuses = (await queryRows<{ status: string }>(startedDb, "SELECT status FROM platform.target_migration_executions WHERE migration_id='005_catalog_foundation' ORDER BY started_at")).map((row) => row.status); }
    finally { await startedDb.destroy(); }

    const commit = url("target_005_commit");
    await applyPostgres001({ adminUrl: commit });
    try { await applyPostgres005({ adminUrl: commit, simulateCrashAfterBodyCommit: true }); } catch { facts.commitCrash = true; }
    facts.commitRecovered = (await applyPostgres005({ adminUrl: commit })).reconciled;

    const checksum = url("target_005_checksum");
    await applyPostgres001({ adminUrl: checksum });
    await applyPostgres005({ adminUrl: checksum });
    const checksumPool = new Pool({ connectionString: checksum });
    try {
      await checksumPool.query(
        "INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,finished_at,runner_version,error_code) VALUES ('018f5000-0000-7000-8000-000000000001','005_catalog_foundation','POSTGRESQL',1,decode(repeat('00',32),'hex'),'FAILED',clock_timestamp(),clock_timestamp(),'test','MISMATCH')",
      );
    } finally { await checksumPool.end(); }
    try { await applyPostgres005({ adminUrl: checksum }); } catch (error) { facts.checksumRejected = error instanceof Error && error.message.includes("checksum mismatch"); }

    const concurrent = url("target_005_concurrent");
    await applyPostgres001({ adminUrl: concurrent });
    const concurrentResults = await Promise.all([applyPostgres005({ adminUrl: concurrent }), applyPostgres005({ adminUrl: concurrent })]);
    facts.concurrentOneApply = concurrentResults.filter((result) => !result.noOp).length;
    facts.concurrentOneNoOp = concurrentResults.filter((result) => result.noOp).length;

    const upDownRace = url("target_005_up_down_race");
    await applyPostgres001({ adminUrl: upDownRace });
    const upDownResults = await Promise.allSettled([applyPostgres005({ adminUrl: upDownRace }), downPostgres001({ adminUrl: upDownRace })]);
    facts.upDownRaceFulfilled = upDownResults.filter((result) => result.status === "fulfilled").length;
    facts.upDownRaceRejected = upDownResults.filter((result) => result.status === "rejected").length;

    const down = url("target_005_down");
    await applyPostgres001({ adminUrl: down });
    await applyPostgres005({ adminUrl: down });
    try { await downPostgres001({ adminUrl: down }); } catch (error) { facts.down001Rejected = error instanceof Error && error.message.includes("005"); }
    await downPostgres005({ adminUrl: down });
    await downPostgres005({ adminUrl: down });
    facts.repeatedDown = true;
    const downDb = postgresDatabase(down, 1);
    try {
      facts.downSchema = Number((await queryRows<{ count: string }>(downDb, "SELECT count(*)::text AS count FROM pg_namespace WHERE nspname='catalog'"))[0]!.count);
      facts.downLedger = (await queryRows<{ status: string }>(downDb, "SELECT status FROM platform.target_migration_executions WHERE migration_id='005_catalog_foundation'"))[0]!.status;
      await validatePostgresCatalog(downDb); facts.down001Intact = true;
    } finally { await downDb.destroy(); }

    // UP -> introspect -> DOWN -> verify absence -> UP again -> introspect (B24-B §18 precedent, reused for B29)
    const reapply = url("target_005_down"); // reuse the same database, already rolled back above
    const reapplied = await applyPostgres005({ adminUrl: reapply });
    facts.reappliedAfterDown = reapplied.noOp === false;
    const reapplyDb = postgresDatabase(reapply, 1);
    try { await validatePostgres005Catalog(reapplyDb); facts.reapplyValidatorPasses = true; }
    finally { await reapplyDb.destroy(); }
  }, 180_000);
  afterAll(drop);

  it("fresh 001 to 005 succeeds", () => expect(facts.firstNoOp).toBe(false));
  it("repeat up is a no-op", () => expect(facts.secondNoOp).toBe(true));
  it("repeat up preserves execution", () => expect(facts.sameExecution).toBe(true));
  it("validator 001 passes after 005", () => expect(facts.validator001).toBe(true));
  it("validator 005 passes", () => expect(facts.validator005).toBe(true));
  it("has exactly 6 catalog tables", () => expect(facts.tables).toEqual([...CATALOG_TABLES].sort()));
  it("has exactly 6 RLS tables (all of them)", () => expect((facts.rls as unknown[]).length).toBe(6));
  it("RLS set is exact", () => expect((facts.rls as Array<{ name: string }>).map((row) => row.name)).toEqual([...CATALOG_005_RLS_TABLES].sort()));
  it("all RLS tables are ENABLE/FORCE", () => expect((facts.rls as Array<{ enabled: boolean; forced: boolean }>).every((row) => row.enabled && row.forced)).toBe(true));
  it("ledger orders 001 then 005 as APPLIED", () => expect(facts.ledger).toEqual([
    { migration_id: "001_central_foundation", status: "APPLIED" },
    { migration_id: "005_catalog_foundation", status: "APPLIED" },
  ]));
  it("pos_reporting has no grants", () => expect(facts.reportingGrants).toBe(0));
  it("admin is read-only", () => expect(facts.adminMutations).toBe(0));
  it("runtime has no destructive grants", () => expect(facts.dangerousGrants).toBe(0));
  it("creates zero seed rows", () => expect(facts.seeds).toBe(0));
  it("missing 001 dependency fails closed", () => expect(facts.missingDependency).toBe(true));
  it("body failure is observed", () => expect(facts.bodyFailure).toBe(true));
  it("body failure rolls back schema and records FAILED", () => expect(facts.failureState).toEqual({ status: "FAILED", body: false, schema: false }));
  it("body failure can retry", () => expect(facts.failureRetry).toBe(true));
  it("STARTED interruption is observed", () => expect(facts.startedCrash).toBe(true));
  it("STARTED recovery produces FAILED then APPLIED", () => expect(facts.startedStatuses).toEqual(["FAILED", "APPLIED"]));
  it("STARTED recovery succeeds", () => expect(facts.startedRecovered).toBe(true));
  it("post-body interruption is observed", () => expect(facts.commitCrash).toBe(true));
  it("committed body is reconciled", () => expect(facts.commitRecovered).toBe(true));
  it("checksum mismatch is rejected", () => expect(facts.checksumRejected).toBe(true));
  it("concurrent up serializes to one apply", () => expect(facts.concurrentOneApply).toBe(1));
  it("concurrent up serializes to one no-op", () => expect(facts.concurrentOneNoOp).toBe(1));
  it("concurrent 005 up and 001 down serialize one operation", () => expect(facts.upDownRaceFulfilled).toBe(1));
  it("concurrent 005 up and 001 down reject the incompatible operation", () => expect(facts.upDownRaceRejected).toBe(1));
  it("down 001 is rejected while 005 applied", () => expect(facts.down001Rejected).toBe(true));
  it("repeated down is safe", () => expect(facts.repeatedDown).toBe(true));
  it("down removes only catalog schema", () => expect(facts.downSchema).toBe(0));
  it("down records ROLLED_BACK", () => expect(facts.downLedger).toBe("ROLLED_BACK"));
  it("down leaves 001 validator passing", () => expect(facts.down001Intact).toBe(true));
  it("UP after DOWN reapplies for real (not a no-op)", () => expect(facts.reappliedAfterDown).toBe(true));
  it("validator passes again after reapply", () => expect(facts.reapplyValidatorPasses).toBe(true));
});
