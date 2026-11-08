import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { SqliteMerchantDestinationProjectionStore } from "../src/payments/sqlite-merchant-destination-projection-store.js";

const TENANT="11111111-1111-4111-8111-111111111111";
const COMPANY="33333333-3333-4333-8333-333333333333";
const OTHER="44444444-4444-4444-8444-444444444444";
const scope={tenantId:TENANT,companyId:COMPANY};
const date="2026-11-07T12:00:00.000Z";
const item={kind:"NEQUI_NUMBER" as const,label:"Negocio A",destination_reference:"3001234567",qr_asset_id:null,qr_sha256:null,version:1};
const make=(sequence:number,destination:typeof item|null=item)=>({
 tenant_id:TENANT,company_id:COMPANY,sequence,
 issued_at:"2026-11-07T11:00:00.000Z",expires_at:"2026-11-08T11:00:00.000Z",
 destination,
});
const folders:string[]=[];
function open() {
 const dir=mkdtempSync(join(tmpdir(),"camacho-qr001-")); folders.push(dir);
 const db=LocalDatabase.open({dataDirectory:dir});
 return {db, store:new SqliteMerchantDestinationProjectionStore(db)};
}
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{force:true,recursive:true});});
describe("SQLite QR-001 projection on LocalDatabase",()=>{
 it("activates a snapshot and shares the same company value with four registers",()=>{
   const {db,store}=open();
   try {
     store.activatePreverified(scope,make(1),date);
     for(let i=0;i<4;i++)expect(store.display(scope,date)?.destination_reference).toBe("3001234567");
     expect(store.display({tenantId:TENANT,companyId:OTHER},date)).toBeNull();
   } finally {db.close();}
 });
 it("rejects stale, repeated and foreign-company activation",()=>{
   const {db,store}=open();
   try{
     store.activatePreverified(scope,make(2),date);
     expect(()=>store.activatePreverified(scope,make(2),date)).toThrow("OBSOLETE_OR_REPLAYED_SEQUENCE");
     expect(()=>store.activatePreverified(scope,make(1),date)).toThrow("OBSOLETE_OR_REPLAYED_SEQUENCE");
     expect(()=>store.activatePreverified({tenantId:TENANT,companyId:OTHER},make(3),date)).toThrow("WRONG_SCOPE");
     expect(store.load(scope)?.snapshot.sequence).toBe(2);
   } finally {db.close();}
 });
 it("activates revocation, hides expired data, persists across reopening",()=>{
   const {db,store}=open();
   try {
     store.activatePreverified(scope,make(1),date);
     store.activatePreverified(scope,make(2,null),date);
     expect(store.display(scope,date)).toBeNull();
     expect(store.load(scope)?.snapshot.sequence).toBe(2);
     expect(store.display(scope,"2026-11-08T11:00:00.000Z")).toBeNull();
   } finally {db.close();}
 });
 it("rejects forged row metadata and direct deletion",()=>{
   const {db,store}=open();
   try {
     store.activatePreverified(scope,make(1),date);
     expect(()=>db.native.prepare("DELETE FROM local_merchant_payment_destination_snapshot").run()).toThrow();
     db.native.prepare("UPDATE local_merchant_payment_destination_snapshot SET issued_at=? WHERE tenant_id=? AND company_id=?")
       .run("2026-11-07T09:00:00.000Z",TENANT,COMPANY);
     expect(()=>store.load(scope)).toThrow("DESTINATION_SNAPSHOT_CORRUPTED");
   } finally {db.close();}
 });
});
