import {mkdtemp} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {rmSync} from "node:fs";
import Database from "better-sqlite3";
import {afterEach,describe,expect,it} from "vitest";
import {LocalDatabase,LATEST_LOCAL_SCHEMA_VERSION} from "../src/index.js";

const directories:string[]=[];
afterEach(()=>{for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
async function temporary(){
 const dir=await mkdtemp(join(tmpdir(),"pos-inventory-batch-migration-"));
 directories.push(dir);return dir;
}
function insertLegacy(db:LocalDatabase,id:string){
 db.native.prepare(`INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,
   status,result_code,created_at,updated_at) VALUES(?,?,?,'SUCCEEDED','POSTED',?,?)`).run(
  id,"legacy:"+id,"a".repeat(64),"2026-09-01T10:00:00Z","2026-09-01T10:00:00Z");
}
describe("SQLite v22 shared batch schema migration",()=>{
 it("upgrades a disposable v21 database without altering the existing operation book",async()=>{
   const dir=await temporary();
   const earlier=LocalDatabase.open({dataDirectory:dir});
   insertLegacy(earlier,"018f0000-0000-7000-8000-000000000111");
   earlier.close();
   // Produce an authentic pre-v22 *test fixture*. Never change an operational DB.
   const raw=new Database(join(dir,"pos-local.db"));
   raw.pragma("foreign_keys = OFF");
   raw.exec(`
     DROP TRIGGER IF EXISTS inventory_transform_line_no_update;
     DROP TRIGGER IF EXISTS inventory_transform_line_no_delete;
     DROP INDEX IF EXISTS inventory_transform_line_lot_idx;
     DROP TABLE IF EXISTS inventory_transform_line;
     DROP TRIGGER IF EXISTS inventory_transform_order_no_update;
     DROP TRIGGER IF EXISTS inventory_transform_order_no_delete;
     DROP TABLE IF EXISTS inventory_transform_order;
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
     DROP TRIGGER inventory_conversion_event_no_update;
     DROP TRIGGER inventory_conversion_event_no_delete;
     DROP TABLE inventory_conversion_event;
     DROP TRIGGER inventory_conversion_rule_same_product;
     DROP TRIGGER inventory_conversion_rule_no_update;
     DROP TRIGGER inventory_conversion_rule_no_delete;
     DROP TABLE inventory_conversion_rule;
     DROP TRIGGER inventory_lot_status_event_no_update;
     DROP TRIGGER inventory_lot_status_event_no_delete;
     DROP TABLE inventory_lot_status_event;
     DROP TRIGGER inventory_lot_movement_no_update;
     DROP TRIGGER inventory_lot_movement_no_delete;
     DROP TABLE inventory_lot_movement;
     DROP TRIGGER inventory_lot_no_delete;
     DROP TABLE inventory_lot;
     DROP TABLE inventory_lot_tracking;
     DROP TRIGGER local_schema_migrations_no_delete;
     DELETE FROM local_schema_migrations WHERE version IN (22,23,24,25,26,27,28,29);
     CREATE TRIGGER local_schema_migrations_no_delete
       BEFORE DELETE ON local_schema_migrations
       BEGIN SELECT RAISE(ABORT,'local migration ledger is immutable'); END;
   `);
   expect(raw.prepare("SELECT max(version) AS v FROM local_schema_migrations").get()).toEqual({v:21});
   raw.close();
   const upgraded=LocalDatabase.open({dataDirectory:dir});
   expect(upgraded.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get())
     .toEqual({v:LATEST_LOCAL_SCHEMA_VERSION});
   expect(upgraded.native.prepare("SELECT count(*) AS n FROM runtime_operations").get()).toEqual({n:1});
   expect(upgraded.native.prepare("SELECT name FROM sqlite_master WHERE name='inventory_lot'").get())
     .toEqual({name:"inventory_lot"});
   upgraded.assertIntegrity();
   upgraded.close();
 });
 it("preserves the original ledger and verified backup restoration semantics",async()=>{
   const dir=await temporary();
   const database=LocalDatabase.open({dataDirectory:dir});
   insertLegacy(database,"018f0000-0000-7000-8000-000000000111");
   const backup=database.createVerifiedBackup();
   insertLegacy(database,"018f0000-0000-7000-8000-000000000222");
   database.close();
   LocalDatabase.restoreFromBackup({dataDirectory:dir},backup);
   const restored=LocalDatabase.open({dataDirectory:dir});
   expect(restored.native.prepare("SELECT count(*) AS n FROM runtime_operations").get()).toEqual({n:1});
   expect(restored.native.prepare("SELECT count(*) AS n FROM inventory_lot").get()).toEqual({n:0});
   restored.assertIntegrity();restored.close();
 });
});
