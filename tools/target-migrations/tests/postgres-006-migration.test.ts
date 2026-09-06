import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVENTORY_006_RLS_TABLES, INVENTORY_TABLES } from "../src/contract.js";
import { postgresDatabase, queryRows } from "../src/database.js";
import { validatePostgres005Catalog, validatePostgres006Inventory, validatePostgresCatalog } from "../src/postgres-introspection.js";
import { applyPostgres001, applyPostgres005, applyPostgres006, downPostgres001, downPostgres005, downPostgres006 } from "../src/postgres.js";

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES = [
  "target_006_fresh",
  "target_006_dependency_001",
  "target_006_dependency_005",
  "target_006_failure",
  "target_006_started",
  "target_006_commit",
  "target_006_checksum",
  "target_006_down",
  "target_006_concurrent",
  "target_006_up_down_race",
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

describe("006_inventory_foundation", () => {
  const facts: Record<string, unknown> = {};

  beforeAll(async () => {
    await recreate();

    const fresh = url("target_006_fresh");
    await applyPostgres001({ adminUrl: fresh });
    await applyPostgres005({ adminUrl: fresh });
    const first = await applyPostgres006({ adminUrl: fresh });
    const second = await applyPostgres006({ adminUrl: fresh });
    facts.firstNoOp = first.noOp;
    facts.secondNoOp = second.noOp;
    facts.sameExecution = first.executionId === second.executionId;

    const db = postgresDatabase(fresh, 1);
    try {
      await validatePostgresCatalog(db); facts.validator001 = true;
      await validatePostgres005Catalog(db); facts.validator005 = true;
      await validatePostgres006Inventory(db); facts.validator006 = true;
      facts.tables = (await queryRows<{ name: string }>(db, "SELECT tablename AS name FROM pg_tables WHERE schemaname='inventory' ORDER BY 1")).map((row) => row.name);
      facts.rls = await queryRows<{ name: string; enabled: boolean; forced: boolean }>(
        db,
        "SELECT c.relname AS name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='inventory' AND c.relrowsecurity ORDER BY 1",
      );
      facts.ledger = await queryRows<{ migration_id: string; status: string }>(db, "SELECT migration_id,status FROM platform.target_migration_executions WHERE status='APPLIED' ORDER BY migration_id");
      facts.reportingGrants = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='inventory' AND grantee='pos_reporting'"))[0]!.count);
      facts.adminMutations = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='inventory' AND grantee='pos_platform_admin' AND privilege_type<>'SELECT'"))[0]!.count);
      facts.dangerousGrants = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM information_schema.role_table_grants WHERE table_schema='inventory' AND grantee IN ('pos_app','pos_worker','pos_platform_admin') AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER')"))[0]!.count);
      facts.seeds = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM inventory.movements"))[0]!.count);
      facts.hasStockBalanceTable = Number((await queryRows<{ count: string }>(db, "SELECT count(*)::text AS count FROM pg_tables WHERE schemaname='inventory' AND tablename='stock_balances'"))[0]!.count);
    } finally {
      await db.destroy();
    }

    const dependency001 = url("target_006_dependency_001");
    try { await applyPostgres006({ adminUrl: dependency001 }); } catch (error) { facts.missingDependency001 = error instanceof Error && error.message.includes("requires approved 001_central_foundation"); }

    const dependency005 = url("target_006_dependency_005");
    await applyPostgres001({ adminUrl: dependency005 });
    try { await applyPostgres006({ adminUrl: dependency005 }); } catch (error) { facts.missingDependency005 = error instanceof Error && error.message.includes("requires approved 005_catalog_foundation"); }

    const failure = url("target_006_failure");
    await applyPostgres001({ adminUrl: failure });
    await applyPostgres005({ adminUrl: failure });
    try { await applyPostgres006({ adminUrl: failure, injectBodyFailure: true }); } catch { facts.bodyFailure = true; }
    const failureDb = postgresDatabase(failure, 1);
    try {
      facts.failureState = (await queryRows<{ status: string; body: boolean; schema: boolean }>(
        failureDb,
        "SELECT e.status,e.body_committed_at IS NOT NULL AS body,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='inventory') AS schema FROM platform.target_migration_executions e WHERE migration_id='006_inventory_foundation'",
      ))[0];
    } finally { await failureDb.destroy(); }
    facts.failureRetry = !(await applyPostgres006({ adminUrl: failure })).noOp;

    const started = url("target_006_started");
    await applyPostgres001({ adminUrl: started });
    await applyPostgres005({ adminUrl: started });
    try { await applyPostgres006({ adminUrl: started, simulateCrashAfterStarted: true }); } catch { facts.startedCrash = true; }
    facts.startedRecovered = (await applyPostgres006({ adminUrl: started })).noOp === false;
    const startedDb = postgresDatabase(started, 1);
    try { facts.startedStatuses = (await queryRows<{ status: string }>(startedDb, "SELECT status FROM platform.target_migration_executions WHERE migration_id='006_inventory_foundation' ORDER BY started_at")).map((row) => row.status); }
    finally { await startedDb.destroy(); }

    const commit = url("target_006_commit");
    await applyPostgres001({ adminUrl: commit });
    await applyPostgres005({ adminUrl: commit });
    try { await applyPostgres006({ adminUrl: commit, simulateCrashAfterBodyCommit: true }); } catch { facts.commitCrash = true; }
    facts.commitRecovered = (await applyPostgres006({ adminUrl: commit })).reconciled;

    const checksum = url("target_006_checksum");
    await applyPostgres001({ adminUrl: checksum });
    await applyPostgres005({ adminUrl: checksum });
    await applyPostgres006({ adminUrl: checksum });
    const checksumPool = new Pool({ connectionString: checksum });
    try {
      await checksumPool.query(
        "INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,finished_at,runner_version,error_code) VALUES ('018f6000-0000-7000-8000-000000000001','006_inventory_foundation','POSTGRESQL',1,decode(repeat('00',32),'hex'),'FAILED',clock_timestamp(),clock_timestamp(),'test','MISMATCH')",
      );
    } finally { await checksumPool.end(); }
    try { await applyPostgres006({ adminUrl: checksum }); } catch (error) { facts.checksumRejected = error instanceof Error && error.message.includes("checksum mismatch"); }

    const concurrent = url("target_006_concurrent");
    await applyPostgres001({ adminUrl: concurrent });
    await applyPostgres005({ adminUrl: concurrent });
    const concurrentResults = await Promise.all([applyPostgres006({ adminUrl: concurrent }), applyPostgres006({ adminUrl: concurrent })]);
    facts.concurrentOneApply = concurrentResults.filter((result) => !result.noOp).length;
    facts.concurrentOneNoOp = concurrentResults.filter((result) => result.noOp).length;

    // Concurrent 006 up vs 005 down — the cross-dependency race specific to 006 (unlike
    // 005, whose own race was against 001 down).
    const upDownRace = url("target_006_up_down_race");
    await applyPostgres001({ adminUrl: upDownRace });
    await applyPostgres005({ adminUrl: upDownRace });
    const upDownResults = await Promise.allSettled([applyPostgres006({ adminUrl: upDownRace }), downPostgres005({ adminUrl: upDownRace })]);
    facts.upDownRaceFulfilled = upDownResults.filter((result) => result.status === "fulfilled").length;
    facts.upDownRaceRejected = upDownResults.filter((result) => result.status === "rejected").length;

    const down = url("target_006_down");
    await applyPostgres001({ adminUrl: down });
    await applyPostgres005({ adminUrl: down });
    await applyPostgres006({ adminUrl: down });
    try { await downPostgres001({ adminUrl: down }); } catch (error) { facts.down001Rejected = error instanceof Error && error.message.includes("006"); }
    try { await downPostgres005({ adminUrl: down }); } catch (error) { facts.down005Rejected = error instanceof Error && error.message.includes("006_inventory_foundation"); }
    await downPostgres006({ adminUrl: down });
    await downPostgres006({ adminUrl: down });
    facts.repeatedDown = true;
    const downDb = postgresDatabase(down, 1);
    try {
      facts.downSchema = Number((await queryRows<{ count: string }>(downDb, "SELECT count(*)::text AS count FROM pg_namespace WHERE nspname='inventory'"))[0]!.count);
      facts.downLedger = (await queryRows<{ status: string }>(downDb, "SELECT status FROM platform.target_migration_executions WHERE migration_id='006_inventory_foundation'"))[0]!.status;
      await validatePostgres005Catalog(downDb); facts.down005Intact = true;
    } finally { await downDb.destroy(); }

    // UP -> introspect -> DOWN -> verify absence -> UP again -> introspect (B24-B §18 / B29 precedent, reused for B33)
    const reapply = url("target_006_down"); // reuse the same database, already rolled back above
    const reapplied = await applyPostgres006({ adminUrl: reapply });
    facts.reappliedAfterDown = reapplied.noOp === false;
    const reapplyDb = postgresDatabase(reapply, 1);
    try { await validatePostgres006Inventory(reapplyDb); facts.reapplyValidatorPasses = true; }
    finally { await reapplyDb.destroy(); }

    // Down 006 must be rejected while it still has data (data-loss safety, same posture as 005/004).
    // Reuses target_006_dependency_005 (has 001 applied, 005 was never successfully applied to
    // it above since that scenario intentionally left it missing) — apply 005 now, then 006.
    const dataGuard = url("target_006_dependency_005");
    await applyPostgres005({ adminUrl: dataGuard });
    await applyPostgres006({ adminUrl: dataGuard });
    const dataGuardPool = new Pool({ connectionString: dataGuard });
    try {
      await dataGuardPool.query(`
        INSERT INTO catalog.products(id,tenant_id,company_id,internal_code,name,category_id,product_type,stock_controlled,lot_controlled,expiration_controlled,serial_controlled,base_unit_id,variant_policy,status,version)
        VALUES ('018f6000-0000-7000-8000-000000000010','018f6000-0000-7000-8000-000000000011','018f6000-0000-7000-8000-000000000012','SKU-DATA-GUARD','Data guard','018f6000-0000-7000-8000-000000000013','STANDARD',true,false,false,false,'018f6000-0000-7000-8000-000000000014','NO_VARIANTS','ACTIVE',1);
        INSERT INTO catalog.product_presentations(id,tenant_id,company_id,product_id,name,unit_id,contained_quantity,variable_quantity,sales_enabled,purchasing_enabled,breakable,stock_mode,status,version,idempotency_key)
        VALUES ('018f6000-0000-7000-8000-000000000015','018f6000-0000-7000-8000-000000000011','018f6000-0000-7000-8000-000000000012','018f6000-0000-7000-8000-000000000010','unidad','018f6000-0000-7000-8000-000000000014',1,false,true,true,false,'INDEPENDENT','ACTIVE',1,'data-guard:1');
        INSERT INTO inventory.movements(id,tenant_id,company_id,branch_id,inventory_location_id,presentation_id,movement_type,direction,quantity,status,occurred_at,idempotency_key)
        VALUES ('018f6000-0000-7000-8000-000000000016','018f6000-0000-7000-8000-000000000011','018f6000-0000-7000-8000-000000000012','018f6000-0000-7000-8000-000000000017','018f6000-0000-7000-8000-000000000018','018f6000-0000-7000-8000-000000000015','POSITIVE_ADJUSTMENT','IN',5,'POSTED',clock_timestamp(),'data-guard:1');
      `);
    } finally { await dataGuardPool.end(); }
    try { await downPostgres006({ adminUrl: dataGuard }); } catch (error) { facts.downRejectedWithData = error instanceof Error && error.message.includes("inventory data exists"); }
  }, 240_000);
  afterAll(drop);

  it("fresh 001+005 to 006 succeeds", () => expect(facts.firstNoOp).toBe(false));
  it("repeat up is a no-op", () => expect(facts.secondNoOp).toBe(true));
  it("repeat up preserves execution", () => expect(facts.sameExecution).toBe(true));
  it("validator 001 passes after 006", () => expect(facts.validator001).toBe(true));
  it("validator 005 passes after 006", () => expect(facts.validator005).toBe(true));
  it("validator 006 passes", () => expect(facts.validator006).toBe(true));
  it("has exactly 6 inventory tables", () => expect(facts.tables).toEqual([...INVENTORY_TABLES].sort()));
  it("StockBalance is NOT a table (B32 kept it a pure computed value)", () => expect(facts.hasStockBalanceTable).toBe(0));
  it("has exactly 6 RLS tables (all of them)", () => expect((facts.rls as unknown[]).length).toBe(6));
  it("RLS set is exact", () => expect((facts.rls as Array<{ name: string }>).map((row) => row.name)).toEqual([...INVENTORY_006_RLS_TABLES].sort()));
  it("all RLS tables are ENABLE/FORCE", () => expect((facts.rls as Array<{ enabled: boolean; forced: boolean }>).every((row) => row.enabled && row.forced)).toBe(true));
  it("ledger orders 001, 005, then 006 as APPLIED", () => expect(facts.ledger).toEqual([
    { migration_id: "001_central_foundation", status: "APPLIED" },
    { migration_id: "005_catalog_foundation", status: "APPLIED" },
    { migration_id: "006_inventory_foundation", status: "APPLIED" },
  ]));
  it("pos_reporting has no grants", () => expect(facts.reportingGrants).toBe(0));
  it("admin is read-only", () => expect(facts.adminMutations).toBe(0));
  it("runtime has no destructive grants", () => expect(facts.dangerousGrants).toBe(0));
  it("creates zero seed rows", () => expect(facts.seeds).toBe(0));
  it("missing 001 dependency fails closed", () => expect(facts.missingDependency001).toBe(true));
  it("missing 005 dependency fails closed even with 001 applied", () => expect(facts.missingDependency005).toBe(true));
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
  it("concurrent 006 up and 005 down serialize one operation", () => expect(facts.upDownRaceFulfilled).toBe(1));
  it("concurrent 006 up and 005 down reject the incompatible operation", () => expect(facts.upDownRaceRejected).toBe(1));
  it("down 001 is rejected while 006 applied", () => expect(facts.down001Rejected).toBe(true));
  it("down 005 is rejected while 006 applied", () => expect(facts.down005Rejected).toBe(true));
  it("repeated down is safe", () => expect(facts.repeatedDown).toBe(true));
  it("down removes only inventory schema", () => expect(facts.downSchema).toBe(0));
  it("down records ROLLED_BACK", () => expect(facts.downLedger).toBe("ROLLED_BACK"));
  it("down leaves 005 validator passing", () => expect(facts.down005Intact).toBe(true));
  it("UP after DOWN reapplies for real (not a no-op)", () => expect(facts.reappliedAfterDown).toBe(true));
  it("validator passes again after reapply", () => expect(facts.reapplyValidatorPasses).toBe(true));
  it("down 006 is rejected while inventory data exists", () => expect(facts.downRejectedWithData).toBe(true));
});
