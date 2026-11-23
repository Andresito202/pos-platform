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

describe("additive local v28 bakery integrity migration", () => {
  it("upgrades a disposable v26 fixture through v27/v28 without mutating prior ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-v28-upgrade-"));
    temp.push(dir);
    const old = LocalDatabase.open({ dataDirectory: dir });
    const id = "018f0000-0000-7000-8000-000000000898";
    old.native.prepare(`INSERT INTO runtime_operations(
      operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at
    ) VALUES(?,?,?,'SUCCEEDED','POSTED',?,?)`).run(
      id, "legacy:v26-for-v28", "d".repeat(64), "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
    old.close();

    const raw = new Database(join(dir, "pos-local.db"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
            DROP TRIGGER IF EXISTS bakery_production_deviation_approval_no_delete;
      DROP INDEX IF EXISTS bakery_deviation_approval_order_idx;
      DROP TABLE IF EXISTS bakery_production_deviation_approval;
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
      DROP TRIGGER local_schema_migrations_no_delete;
      DROP INDEX IF EXISTS catalog_media_company_idx;
      DROP TABLE IF EXISTS catalog_media;
      ALTER TABLE catalog_product DROP COLUMN description;
      ALTER TABLE catalog_product DROP COLUMN brand;
      ALTER TABLE catalog_product DROP COLUMN category;
      ALTER TABLE catalog_product DROP COLUMN primary_media_id;
      ALTER TABLE catalog_presentation DROP COLUMN version;
      DELETE FROM local_schema_migrations WHERE version IN (27, 28, 29, 30, 31);
      CREATE TRIGGER local_schema_migrations_no_delete
      BEFORE DELETE ON local_schema_migrations
      BEGIN SELECT RAISE(ABORT,'local migration ledger is immutable'); END;
    `);
    expect(raw.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
      .toEqual({ v: 26 });
    raw.close();

    const upgraded = LocalDatabase.open({ dataDirectory: dir });
    expect(upgraded.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
      .toEqual({ v: LATEST_LOCAL_SCHEMA_VERSION });
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(28);
    const cols = upgraded.native.prepare(`PRAGMA table_info(bakery_production_order)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "actual_net_mass_quantity")).toBe(true);
    const consumptionCols = upgraded.native.prepare(`PRAGMA table_info(bakery_production_consumption)`).all() as Array<{ name: string }>;
    expect(consumptionCols.some((c) => c.name === "deviation_kind")).toBe(true);
    expect(upgraded.native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='bakery_production_recipe_deviation'",
    ).get()).toEqual({ name: "bakery_production_recipe_deviation" });
    expect(upgraded.native.prepare("SELECT count(*) AS n FROM runtime_operations").get())
      .toEqual({ n: 1 });
    upgraded.assertIntegrity();
    upgraded.close();
  });
});
