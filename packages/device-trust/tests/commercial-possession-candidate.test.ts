import {generateKeyPairSync,randomUUID,randomBytes,sign} from "node:crypto";
import {it,expect} from "vitest";
import {commercialPossessionCandidateChallenge,verifyCommercialPossessionCandidateSignature,
  createDeviceRequestAuthorization,parseDeviceRequestAuthorization,type CommercialPossessionCandidateContext} from "../src/index.js";
function fixture(){
  const keys=generateKeyPairSync("ed25519"),now=new Date("2026-10-25T12:00:00.000Z");
  const context:CommercialPossessionCandidateContext={mode:"ISOLATED_VALIDATION",operation:"AUTHORIZATION_SNAPSHOT",origin:"https://business.example.test",
    audience:"central-lab",clientId:"windows-lab",tenantId:randomUUID(),installationId:randomUUID(),deviceId:randomUUID(),credentialId:randomUUID(),
    token:randomBytes(48).toString("base64url"),requestId:randomUUID(),correlationId:randomUUID(),body:'{"session_id":"laboratory-only-vector"}'};
  const freshness={credentialId:context.credentialId,timestamp:now.toISOString(),nonce:randomBytes(32).toString("base64url")};
  const proof={...freshness,signature:sign(null,commercialPossessionCandidateChallenge(context,freshness),keys.privateKey).toString("base64url")};
  return {keys,now,context,proof};
}
it("D3 V2 candidate: token-bound digest verifies without defining a production wire protocol",()=>{
  const f=fixture();expect(commercialPossessionCandidateChallenge(f.context,f.proof).length).toBe(32);
  expect(verifyCommercialPossessionCandidateSignature(f.proof,f.context,f.keys.publicKey,f.now,1000)).toBe(true);
});
it.each(["origin","audience","clientId","tenantId","installationId","deviceId","credentialId","token","requestId","correlationId","body","operation"] as const)("D3 V2 candidate: replacing %s breaks possession",field=>{
  const f=fixture(),expected={...f.context};
  if(field==="origin")expected.origin="https://other.example.test";
  else if(field==="operation")expected.operation="REFRESH";
  else if(["audience","clientId","body","token"].includes(field))expected[field]="different-"+expected[field];
  else expected[field]=randomUUID();
  expect(verifyCommercialPossessionCandidateSignature(f.proof,expected,f.keys.publicKey,f.now,1000)).toBe(false);
});
it("D3 V2 candidate: stale proof wrong key missing policy and DeviceProof V1 are rejected",()=>{
  const f=fixture();expect(verifyCommercialPossessionCandidateSignature(f.proof,f.context,f.keys.publicKey,new Date(f.now.getTime()+1001),1000)).toBe(false);
  expect(verifyCommercialPossessionCandidateSignature(f.proof,f.context,generateKeyPairSync("ed25519").publicKey,f.now,1000)).toBe(false);
  expect(verifyCommercialPossessionCandidateSignature(f.proof,f.context,f.keys.publicKey,f.now,0)).toBe(false);
  const old=parseDeviceRequestAuthorization(createDeviceRequestAuthorization({method:"POST",path:"/v1/business-session/authorization",
    requestId:f.context.requestId,correlationId:f.context.correlationId,credentialId:f.context.credentialId,body:f.context.body},f.keys.privateKey,f.now))!;
  expect(verifyCommercialPossessionCandidateSignature(old,f.context,f.keys.publicKey,f.now,1000)).toBe(false);
  expect(verifyCommercialPossessionCandidateSignature({...f.proof,body:f.context.body} as never,
    {...f.context,body:"tampered"},f.keys.publicKey,f.now,1000)).toBe(false);
});
