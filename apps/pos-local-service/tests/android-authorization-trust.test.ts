import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { unsignedAuthorizationTrustBytes, type AuthorizationTrustClaims } from "@pos-platform/contracts";
import { verifyAndroidAuthorizationTrust } from "../src/android/android-authorization-trust.js";
const id="11111111-1111-4111-8111-111111111111";
const recipient={tenant_id:id,company_id:id,branch_id:id,installation_id:id,device_id:id};
const root=generateKeyPairSync("ed25519"), operational=generateKeyPairSync("ed25519");
const pem=(key:typeof root.publicKey)=>key.export({type:"spki",format:"pem"}).toString();
const policy={rootPublicKeyPem:pem(root.publicKey),rootSpkiSha256:createHash("sha256").update(root.publicKey.export({type:"spki",format:"der"})).digest("hex"),issuer:"https://central.camachoposcolombia.com",authorityId:"CENTRAL",environment:"PRODUCTION" as const,recipient};
const claims:AuthorizationTrustClaims={schema_version:1,purpose:"AUTHORIZATION_SNAPSHOT",issuer:policy.issuer,authority_id:policy.authorityId,generation:1,complete:true,issued_at:"2026-01-01T00:00:00.000Z",valid_from:"2026-01-01T00:00:00.000Z",valid_until:"2027-01-01T00:00:00.000Z",profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",environment:"PRODUCTION",recipient,keys:[{key_id:"SAS",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:pem(operational.publicKey),status:"ACTIVE",version:1,valid_from:"2026-01-01T00:00:00.000Z",valid_until:"2027-02-01T00:00:00.000Z"}]};
const signed={claims,signature:sign(null,unsignedAuthorizationTrustBytes(claims),root.privateKey).toString("base64url")};
const now=new Date("2026-06-01T00:00:00.000Z");
describe("Android deployment SAS trust",()=>{
 it("accepts signed recipient and bounds keys to bundle lifetime",()=>expect(verifyAndroidAuthorizationTrust(signed,policy,now).keys.get("SAS")?.validUntil).toBe(claims.valid_until));
 it("rejects modified generation",()=>expect(()=>verifyAndroidAuthorizationTrust({...signed,claims:{...claims,generation:2}},policy,now)).toThrow());
 it("rejects another recipient",()=>expect(()=>verifyAndroidAuthorizationTrust(signed,{...policy,recipient:{...recipient,device_id:"22222222-2222-4222-8222-222222222222"}},now)).toThrow());
 it("rejects expired bundle",()=>expect(()=>verifyAndroidAuthorizationTrust(signed,policy,new Date(claims.valid_until))).toThrow());
});
