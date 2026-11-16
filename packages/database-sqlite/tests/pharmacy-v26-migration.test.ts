import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase, LATEST_LOCAL_SCHEMA_VERSION } from "../src/index.js";

const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("additive local v26 pharmacy migration", () => {
  it("upgrades a disposable v25 fixture without mutating pre-existing operations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-v26-upgrade-"));
    temp.push(dir);
    const old = LocalDatabase.open({ dataDirectory: dir });
    const id = "018f0000-0000-7000-8000-000000000899";
    old.native.prepare(`INSERT INTO runtime_operations(
      operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at
    ) VALUES(?,?,?,'SUCCEEDED','POSTED',?,?)`).run(
      id, "legacy:v25", "c".repeat(64), "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
    old.close();

    const raw = new Database(join(dir, "pos-local.db"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
            DROP TRIGGER IF EXISTS bakery_production_recipe_deviation_no_update;
      DROP TRIGGER IF EXISTS bakery_production_recipe_deviation_no_delete;
      DROP TABLE IF EXISTS bakery_production_recipe_deviation;
      DROP TRIGGER IF EXISTS inventory_lot_acquisition_cost_no_update;
      DROP TRIGGER IF EXISTS inventory_lot_acquisition_cost_no_delete;
      DROP TABLE IF EXISTS inventory_lot_acquisition_cost;
      DROP TRIGGER IF EXISTS bakery_production_direct_cost_no_update;
      DROP TRIGGER IF EXISTS bakery_production_direct_cost_no_delete;
      DROP TABLE IF EXISTS bakery_production_direct_cost;
      DROP TRIGGER IF EXISTS bakery_production_consumption_no_update;
      DROP TRIGGER IF EXISTS bakery_production_consumption_no_delete;
      DROP TABLE IF EXISTS bakery_production_consumption;
      DROP TRIGGER IF EXISTS bakery_production_order_no_delete;
      DROP INDEX IF EXISTS bakery_production_order_status_idx;
      DROP TABLE IF EXISTS bakery_production_order;
      DROP TRIGGER IF EXISTS bakery_recipe_line_no_update;
      DROP TRIGGER IF EXISTS bakery_recipe_line_no_delete;
      DROP TABLE IF EXISTS bakery_recipe_line;
      DROP TRIGGER IF EXISTS bakery_recipe_no_delete;
      DROP INDEX IF EXISTS bakery_recipe_finished_idx;
      DROP TABLE IF EXISTS bakery_recipe;
      DROP TABLE IF EXISTS catalog_bakery_finished_policy;
      DROP TABLE IF EXISTS catalog_bakery_ingredient_profile;
      DROP TRIGGER IF EXISTS pharmacy_controlled_ledger_no_update;
      DROP TRIGGER IF EXISTS pharmacy_controlled_ledger_no_delete;
      DROP TABLE IF EXISTS pharmacy_controlled_ledger;
      DROP TRIGGER IF EXISTS pharmacy_sanitary_alert_no_update;
      DROP TRIGGER IF EXISTS pharmacy_sanitary_alert_no_delete;
      DROP TABLE IF EXISTS pharmacy_sanitary_alert;
      DROP TRIGGER IF EXISTS pharmacy_dispensation_no_update;
      DROP TRIGGER IF EXISTS pharmacy_dispensation_no_delete;
      DROP INDEX IF EXISTS pharmacy_dispensation_sale_idx;
      DROP TABLE IF EXISTS pharmacy_dispensation;
      DROP TRIGGER IF EXISTS pharmacy_technical_receipt_no_update;
      DROP TRIGGER IF EXISTS pharmacy_technical_receipt_no_delete;
      DROP TABLE IF EXISTS pharmacy_technical_receipt;
      DROP TRIGGER IF EXISTS pharmacy_prescription_no_delete;
      DROP INDEX IF EXISTS pharmacy_prescription_product_idx;
      DROP TABLE IF EXISTS pharmacy_prescription;
      DROP TABLE IF EXISTS catalog_pharmacy_profile;
      DROP TABLE IF EXISTS company_pharmacy_establishment;
      DROP TRIGGER local_schema_migrations_no_delete;
      DELETE FROM local_schema_migrations WHERE version IN (26, 27, 28);
      CREATE TRIGGER local_schema_migrations_no_delete
      BEFORE DELETE ON local_schema_migrations
      BEGIN SELECT RAISE(ABORT,'local migration ledger is immutable'); END;
    `);
    expect(raw.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
      .toEqual({ v: 25 });
    raw.close();

    const upgraded = LocalDatabase.open({ dataDirectory: dir });
    expect(upgraded.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
      .toEqual({ v: LATEST_LOCAL_SCHEMA_VERSION });
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(26);
    expect(upgraded.native.prepare("SELECT count(*) AS n FROM runtime_operations").get())
      .toEqual({ n: 1 });
    expect(upgraded.native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_pharmacy_profile'"
    ).get()).toEqual({ name: "catalog_pharmacy_profile" });
    expect(upgraded.native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='company_pharmacy_establishment'"
    ).get()).toEqual({ name: "company_pharmacy_establishment" });
    upgraded.assertIntegrity();
    upgraded.close();
  });
});
