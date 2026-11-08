import {describe, expect, it} from "vitest";
import {MerchantDestinationDraftSchema, MerchantDestinationRevisionSchema} from "../src/merchant-destination.js";
import {publishDestination, readCashierDestination, revokeDestination, type MerchantDestinationAccess} from "../src/merchant-destination-policy.js";

const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222";
const COMPANY="33333333-3333-4333-8333-333333333333", OTHER_COMPANY="44444444-4444-4444-8444-444444444444";
const USER="55555555-5555-4555-8555-555555555555", ID="66666666-6666-4666-8666-666666666666";
const QR="77777777-7777-4777-8777-777777777777";
const digest="a".repeat(64);
const now="2026-11-07T18:00:00.000Z";
const admin: MerchantDestinationAccess={tenantId:A,companyId:COMPANY,userId:USER,canConfigure:true};
const cashier: MerchantDestinationAccess={...admin,canConfigure:false};
const draft={kind:"NEQUI_BUSINESS_QR" as const,label:"Caja principal",destination_reference:"@negocio",qr_asset_id:QR,qr_sha256:digest};
const initial=()=>({
 id:ID,tenant_id:A,company_id:COMPANY,version:1,status:"DRAFT" as const,
 ...draft,created_by_user_id:USER,published_at:null,revoked_at:null,
});
describe("QR-001 isolation and immutable transitions",()=>{
 it("validates official QR payload metadata",()=>{
   expect(MerchantDestinationDraftSchema.safeParse(draft).success).toBe(true);
   expect(MerchantDestinationDraftSchema.safeParse({...draft,qr_sha256:null}).success).toBe(false);
   expect(MerchantDestinationDraftSchema.safeParse({...draft,qr_asset_id:null,qr_sha256:null}).success).toBe(false);
   expect(MerchantDestinationDraftSchema.safeParse({kind:"NEQUI_NUMBER",label:"A",destination_reference:"0000",qr_asset_id:null,qr_sha256:null}).success).toBe(false);
 });
 it("publishes one immutable version and allows four registers to read same projection",()=>{
   const original=initial();
   const published=publishDestination(original,admin,1,now);
   expect(original.status).toBe("DRAFT");
   expect(published.version).toBe(2);
   expect(published.status).toBe("PUBLISHED");
   const devices=Array.from({length:4},()=>readCashierDestination(published,cashier));
   expect(devices.every(x=>JSON.stringify(x)===JSON.stringify(devices[0]))).toBe(true);
   expect(devices[0]?.qr_asset_id).toBe(QR);
   expect("created_by_user_id" in (devices[0]??{})).toBe(false);
 });
 it("denies cashier writes even when invoking the policy directly",()=>{
   expect(()=>publishDestination(initial(),cashier,1,now)).toThrow("FORBIDDEN");
 });
 it("denies cross tenant or company reads and writes",()=>{
   expect(readCashierDestination(initial(),{...cashier,tenantId:B})).toBeNull();
   expect(readCashierDestination(initial(),{...cashier,companyId:OTHER_COMPANY})).toBeNull();
   expect(()=>publishDestination(initial(),{...admin,tenantId:B},1,now)).toThrow("NOT_FOUND");
   expect(()=>publishDestination(initial(),{...admin,companyId:OTHER_COMPANY},1,now)).toThrow("NOT_FOUND");
 });
 it("rejects stale write and duplicate publication",()=>{
   const published=publishDestination(initial(),admin,1,now);
   expect(()=>revokeDestination(published,admin,1,now)).toThrow("VERSION_CONFLICT");
   expect(()=>publishDestination(published,admin,2,now)).toThrow("INVALID_TRANSITION");
 });
 it("revokes and prevents QR display on all registers",()=>{
   const published=publishDestination(initial(),admin,1,now);
   const revoked=revokeDestination(published,admin,2,now);
   expect(revoked.status).toBe("REVOKED");
   expect(revoked.version).toBe(3);
   expect(readCashierDestination(revoked,cashier)).toBeNull();
   expect(readCashierDestination(published,cashier)?.qr_asset_id).toBe(QR);
 });
 it("validates stored data before any transition",()=>{
   expect(()=>publishDestination({...initial(),version:0},admin,0,now)).toThrow();
   expect(MerchantDestinationRevisionSchema.safeParse(initial()).success).toBe(true);
 });
});
