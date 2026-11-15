import {describe,expect,it} from "vitest";
import {applyVerifiedDestinationSnapshot,visibleCompanyDestination,visibleCompanyDestinations,DestinationSnapshotSchema} from "../src/merchant-destination-snapshot.js";
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const C="33333333-3333-4333-8333-333333333333",D="44444444-4444-4444-8444-444444444444";
const scope={tenantId:A,companyId:C};
const at="2026-11-07T12:00:00.000Z";
const snapshot=(sequence=1, destination:any={kind:"NEQUI_NUMBER",label:"Local",destination_reference:"3001234567",qr_asset_id:null,qr_sha256:null,version:1})=>({
 tenant_id:A,company_id:C,sequence,issued_at:"2026-11-07T11:00:00.000Z",expires_at:"2026-11-08T11:00:00.000Z",destination
});
describe("QR-001 company projection",()=>{
 it("shows same published destination to four cash registers without exposing author details",()=>{
  const state=applyVerifiedDestinationSnapshot(null,snapshot(),scope,at);
  const views=Array.from({length:4},()=>visibleCompanyDestination(state,scope,at));
  expect(views.every(view=>JSON.stringify(view)===JSON.stringify(views[0]))).toBe(true);
  expect(views[0]?.destination_reference).toBe("3001234567");
  expect("tenant_id" in (views[0]??{})).toBe(false);
 });
 it("fails closed across tenants and companies",()=>{
  expect(()=>applyVerifiedDestinationSnapshot(null,{...snapshot(),tenant_id:B},scope,at)).toThrow("WRONG_SCOPE");
  expect(visibleCompanyDestination(applyVerifiedDestinationSnapshot(null,snapshot(),scope,at),{tenantId:A,companyId:D},at)).toBeNull();
 });
 it("does not regress or replay snapshots",()=>{
  const state=applyVerifiedDestinationSnapshot(null,snapshot(2),scope,at);
  expect(()=>applyVerifiedDestinationSnapshot(state,snapshot(2),scope,at)).toThrow("OBSOLETE_OR_REPLAYED_SEQUENCE");
  expect(()=>applyVerifiedDestinationSnapshot(state,snapshot(1),scope,at)).toThrow("OBSOLETE_OR_REPLAYED_SEQUENCE");
 });
 it("replaces QR with a revocation that hides it in all registers",()=>{
  const state=applyVerifiedDestinationSnapshot(null,snapshot(1),scope,at);
  const next=applyVerifiedDestinationSnapshot(state,snapshot(2,null),scope,at);
  expect(visibleCompanyDestination(next,scope,at)).toBeNull();
  expect(visibleCompanyDestination(state,scope,at)).not.toBeNull();
 });
 it("hides expired snapshots offline",()=>{
  const state=applyVerifiedDestinationSnapshot(null,snapshot(),scope,at);
  expect(visibleCompanyDestination(state,scope,"2026-11-08T11:00:00.000Z")).toBeNull();
  expect(()=>applyVerifiedDestinationSnapshot(null,snapshot(),scope,"2026-11-08T12:00:00.000Z")).toThrow("EXPIRED_SNAPSHOT");
 });
 it("rejects a snapshot from the future",()=>{
  expect(()=>applyVerifiedDestinationSnapshot(null,{...snapshot(),issued_at:"2026-11-09T10:00:00.000Z",expires_at:"2026-11-10T10:00:00.000Z"},scope,at)).toThrow("FUTURE_SNAPSHOT");
 });
});


it("presents multiple independently configured methods to the same four registers",()=>{
 const first={kind:"NEQUI_NUMBER" as const,label:"Nequi",destination_reference:"3001234567",
   qr_asset_id:null,qr_sha256:null,version:1};
 const second={kind:"BREB_KEY" as const,label:"Llave",destination_reference:"@comercio",
   qr_asset_id:null,qr_sha256:null,version:1};
 const proposed={...snapshot(4,first),destinations:[first,second]};
 const state=applyVerifiedDestinationSnapshot(null,proposed,scope,at);
 const all=Array.from({length:4},()=>visibleCompanyDestinations(state,scope,at));
 expect(all.every(value=>JSON.stringify(value)===JSON.stringify(all[0]))).toBe(true);
 expect(all[0]?.map(x=>x.kind)).toEqual(["NEQUI_NUMBER","BREB_KEY"]);
 expect(DestinationSnapshotSchema.safeParse({...proposed,destinations:[first,first]}).success).toBe(false);
});

it("accepts a lightweight primary with image only in the signed method array",()=>{
 const core={kind:"NEQUI_BUSINESS_QR" as const,label:"QR Nequi",destination_reference:"@commerce",
   qr_asset_id:"77777777-7777-4777-8777-777777777777",qr_sha256:"a".repeat(64),version:2};
 const image=Buffer.alloc(60).toString("base64");
 const proposed={...snapshot(9,core),destinations:[{...core,qr_png_base64:image}]};
 expect(DestinationSnapshotSchema.safeParse(proposed).success).toBe(true);
 const state=applyVerifiedDestinationSnapshot(null,proposed,scope,at);
 expect(visibleCompanyDestinations(state,scope,at)[0]?.qr_png_base64).toBe(image);
 expect(visibleCompanyDestination(state,scope,at)?.qr_png_base64).toBeUndefined();
 expect(DestinationSnapshotSchema.safeParse({
   ...proposed,destination:{...core,destination_reference:"@attacker"},
 }).success).toBe(false);
 expect(DestinationSnapshotSchema.safeParse({
   ...proposed,destination:{...core,qr_png_base64:Buffer.alloc(60,1).toString("base64")},
 }).success).toBe(false);
});
