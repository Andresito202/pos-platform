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
     DELETE FROM local_schema_migrations WHERE version=22;
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
