import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {TrustedClockGuard} from "../src/security/trusted-clock.js";
import {
  MERCHANT_DESTINATION_KEY_PURPOSE,MerchantDestinationSnapshotVerifier,
  unsignedMerchantDestinationBytes,
} from "../src/security/merchant-destination-snapshot-verifier.js";
import {MerchantDestinationActivationService} from "../src/payments/merchant-destination-activation.js";
import {SqliteMerchantDestinationProjectionStore} from "../src/payments/sqlite-merchant-destination-projection-store.js";
const tenant="11111111-1111-4111-8111-111111111111",company="33333333-3333-4333-8333-333333333333";
const scope={tenantId:tenant,companyId:company,environment:"SANDBOX" as const};
const now="2026-11-07T18:00:00.000Z";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const keys=new Map([["merchant",{key:publicKey,purpose:MERCHANT_DESTINATION_KEY_PURPOSE,status:"ACTIVE" as const}]]);
const folders:string[]=[];
function create(){
 const directory=mkdtempSync(join(tmpdir(),"qr001-activate-"));folders.push(directory);
 const db=LocalDatabase.open({dataDirectory:directory});
 const store=new SqliteMerchantDestinationProjectionStore(db);
 const verifier=new MerchantDestinationSnapshotVerifier(keys,new TrustedClockGuard(db),()=>new Date(now));
 return {db,store,service:new MerchantDestinationActivationService(verifier,store)};
}
function signed(sequence:number, destination:unknown={
 kind:"NEQUI_NUMBER",label:"Principal",destination_reference:"3001234567",qr_asset_id:null,qr_sha256:null,version:1,
}){
 const claims={
  schema_version:1 as const,key_id:"merchant",environment:"SANDBOX" as const,
  snapshot:{tenant_id:tenant,company_id:company,sequence,
   issued_at:"2026-11-07T17:00:00.000Z",expires_at:"2026-11-08T17:00:00.000Z",
   destination,
  },
 };
 return {claims,signature:sign(null,unsignedMerchantDestinationBytes(claims as Parameters<typeof unsignedMerchantDestinationBytes>[0]),privateKey).toString("base64url")};
}
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
describe("QR-001 signed snapshot to real SQLite projection",()=>{
 it("accepts real signature then makes company destination visible",()=>{
   const {db,store,service}=create();
   try{
     expect(service.acceptSigned(signed(1),scope)).toEqual({kind:"ACTIVATED",sequence:1});
     expect(store.display(scope,now)?.destination_reference).toBe("3001234567");
     expect(store.display({tenantId:tenant,companyId:"44444444-4444-4444-8444-444444444444"},now)).toBeNull();
   }finally{db.close();}
 });
 it("never writes a forged or replayed configuration",()=>{
   const {db,store,service}=create();
   try{
     expect(service.acceptSigned(signed(2),scope).kind).toBe("ACTIVATED");
     const forged={...signed(3),signature:signed(2).signature};
     expect(service.acceptSigned(forged,scope)).toEqual({kind:"REJECTED",reason:"INVALID_SIGNATURE"});
     expect(service.acceptSigned(signed(2),scope)).toEqual({kind:"REJECTED",reason:"OBSOLETE_OR_REPLAYED_SEQUENCE"});
     expect(store.load(scope)?.snapshot.sequence).toBe(2);
   }finally{db.close();}
 });
 it("accepts signed company revocation and hides QR on every register",()=>{
   const {db,store,service}=create();
   try{
     expect(service.acceptSigned(signed(1),scope).kind).toBe("ACTIVATED");
     expect(service.acceptSigned(signed(2,null),scope).kind).toBe("ACTIVATED");
     for(let i=0;i<4;i++)expect(store.display(scope,now)).toBeNull();
   }finally{db.close();}
 });
});
