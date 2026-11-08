import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { TrustedClockGuard } from "../src/security/trusted-clock.js";
import {
  MERCHANT_DESTINATION_KEY_PURPOSE, MerchantDestinationSnapshotVerifier,
  unsignedMerchantDestinationBytes,
} from "../src/security/merchant-destination-snapshot-verifier.js";

const tenant="11111111-1111-4111-8111-111111111111";
const company="33333333-3333-4333-8333-333333333333";
const other="44444444-4444-4444-8444-444444444444";
const now="2026-11-07T18:00:00.000Z";
const scope={tenantId:tenant,companyId:company,environment:"SANDBOX" as const};
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const destination={kind:"NEQUI_NUMBER" as const,label:"Comercio",destination_reference:"3001234567",qr_asset_id:null,qr_sha256:null,version:1};
const baseClaims={
  schema_version:1 as const,key_id:"merchant-key-1",environment:"SANDBOX" as const,
  snapshot:{tenant_id:tenant,company_id:company,sequence:1,
    issued_at:"2026-11-07T17:00:00.000Z",expires_at:"2026-11-08T17:00:00.000Z",
    destination},
};
function signed(claims:typeof baseClaims=baseClaims){
 return {claims,signature:sign(null,unsignedMerchantDestinationBytes(claims),privateKey).toString("base64url")};
}
const folders:string[]=[];
function setup(keyPurpose:string=MERCHANT_DESTINATION_KEY_PURPOSE,status:"ACTIVE"|"VERIFY_ONLY"|"REVOKED"="ACTIVE",clock=now,validFrom?:string){
 const folder=mkdtempSync(join(tmpdir(),"qr001-signed-")); folders.push(folder);
 const db=LocalDatabase.open({dataDirectory:folder});
 const keys=new Map([["merchant-key-1",{key:publicKey,purpose:keyPurpose,status,validFrom}]]);
 const verifier=new MerchantDestinationSnapshotVerifier(keys,new TrustedClockGuard(db),()=>new Date(clock));
 return {db,verifier};
}
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
describe("QR-001 signed projection trust",()=>{
 it("verifies a genuine signed company snapshot",()=>{
  const {db,verifier}=setup();
  try{const result=verifier.verify(signed(),scope);
    expect(result.decision).toBe("VALID");
    expect(result.snapshot?.destination?.destination_reference).toBe("3001234567");
  }finally{db.close();}
 });
 it("rejects tampering without accepting the changed destination",()=>{
  const {db,verifier}=setup();
  try{const forged={...signed(),claims:{...baseClaims,snapshot:{...baseClaims.snapshot,
    destination:{...destination,destination_reference:"3000000000"}}}};
   expect(verifier.verify(forged,scope).decision).toBe("INVALID_SIGNATURE");
  }finally{db.close();}
 });
 it("rejects a foreign tenant/company and wrong environment",()=>{
  const {db,verifier}=setup();
  try{
   expect(verifier.verify(signed(),{...scope,companyId:other}).decision).toBe("WRONG_SCOPE");
   expect(verifier.verify(signed(),{...scope,environment:"PRODUCTION"}).decision).toBe("WRONG_ENVIRONMENT");
  }finally{db.close();}
 });
 it("rejects a key with another purpose or revoked status",()=>{
  const a=setup("MASTER_SNAPSHOT");
  try{expect(a.verifier.verify(signed(),scope).decision).toBe("WRONG_KEY_PURPOSE");}finally{a.db.close();}
  const b=setup(MERCHANT_DESTINATION_KEY_PURPOSE,"REVOKED");
  try{expect(b.verifier.verify(signed(),scope).decision).toBe("REVOKED_KEY");}finally{b.db.close();}
 });
 it("rejects expired and future-dated snapshots",()=>{
  const a=setup(MERCHANT_DESTINATION_KEY_PURPOSE,"ACTIVE","2026-11-09T18:00:00.000Z");
  try{expect(a.verifier.verify(signed(),scope).decision).toBe("EXPIRED");}finally{a.db.close();}
  const b=setup(MERCHANT_DESTINATION_KEY_PURPOSE,"ACTIVE","2026-11-06T18:00:00.000Z");
  try{expect(b.verifier.verify(signed(),scope).decision).toBe("NOT_YET_VALID");}finally{b.db.close();}
 });
 it("fails closed on malformed key validity window",()=>{
  const {db,verifier}=setup(MERCHANT_DESTINATION_KEY_PURPOSE,"ACTIVE",now,"not-a-date");
  try{ expect(verifier.verify(signed(),scope).decision).toBe("KEY_OUTSIDE_LIFECYCLE"); }
  finally{db.close();}
 });
 it("rejects unknown key and invalid outer schema",()=>{
  const {db,verifier}=setup();
  try{
   expect(verifier.verify({...signed(),claims:{...baseClaims,key_id:"unknown"}},scope).decision).toBe("UNKNOWN_KEY");
   expect(verifier.verify({...signed(),untrusted:true},scope).decision).toBe("INVALID_SCHEMA");
  }finally{db.close();}
 });
});
