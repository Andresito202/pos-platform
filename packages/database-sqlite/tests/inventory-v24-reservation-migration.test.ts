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

describe("additive local v24 reservation migration", () => {
  it("upgrades a disposable v23 fixture without mutating pre-existing operations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pos-v24-upgrade-"));
    temp.push(dir);
    const old = LocalDatabase.open({ dataDirectory: dir });
    const id = "018f0000-0000-7000-8000-000000000899";
    old.native.prepare(`INSERT INTO runtime_operations(
      operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at
    ) VALUES(?,?,?,'SUCCEEDED','POSTED',?,?)`).run(
      id, "legacy:v23", "b".repeat(64), "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
    old.close();

    // Disposable fixture only: not an operational rollback command.
    const raw = new Database(join(dir, "pos-local.db"));
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DROP TRIGGER IF EXISTS inventory_transform_line_no_update;
      DROP TRIGGER IF EXISTS inventory_transform_line_no_delete;
      DROP INDEX IF EXISTS inventory_transform_line_lot_idx;
      DROP TABLE IF EXISTS inventory_transform_line;
      DROP TRIGGER IF EXISTS inventory_transform_order_no_update;
      DROP TRIGGER IF EXISTS inventory_transform_order_no_delete;
      DROP TABLE IF EXISTS inventory_transform_order;
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
      DROP TABLE IF EXISTS catalog_food_policy;
      DROP TRIGGER IF EXISTS inventory_reservation_lot_no_update;
      DROP TRIGGER IF EXISTS inventory_reservation_lot_no_delete;
      DROP TABLE IF EXISTS inventory_reservation_lot;
      DROP TRIGGER IF EXISTS inventory_reservation_no_delete;
      DROP INDEX IF EXISTS inventory_reservation_availability_idx;
      DROP INDEX IF EXISTS inventory_reservation_reference_idx;
      DROP TABLE IF EXISTS inventory_reservation;
      DROP TRIGGER local_schema_migrations_no_delete;
      DELETE FROM local_schema_migrations WHERE version IN (24,25,26);
      CREATE TRIGGER local_schema_migrations_no_delete
      BEFORE DELETE ON local_schema_migrations
      BEGIN SELECT RAISE(ABORT,'local migration ledger is immutable'); END;
    `);
    expect(raw.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
      .toEqual({ v: 23 });
    raw.close();

    const upgraded = LocalDatabase.open({ dataDirectory: dir });
    expect(upgraded.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
      .toEqual({ v: LATEST_LOCAL_SCHEMA_VERSION });
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(24);
    expect(upgraded.native.prepare("SELECT count(*) AS n FROM runtime_operations").get())
      .toEqual({ n: 1 });
    expect(upgraded.native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_reservation'"
    ).get()).toEqual({ name: "inventory_reservation" });
    upgraded.assertIntegrity();
    upgraded.close();
  });
});
