import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { assertInitialScmCandidateState, serializeScmCandidate, inspectScmCandidateBytes, persistInitialScmCandidate } from "./scm-immutable-provision-store.mjs";

const signer=generateKeyPairSync("ed25519").publicKey;
const recipient=generateKeyPairSync("rsa",{modulusLength:3072,publicExponent:65537}).publicKey;
const pem=k=>k.export({type:"spki",format:"pem"}).toString();
const pin=k=>createHash("sha256").update(k.export({type:"spki",format:"der"})).digest("hex");
const nativeSha=createHash("sha256").update("candidate-adapter").digest("hex");
const now=new Date("2026-11-22T20:00:00.000Z");
const path=p=>"C:\\ProgramData\\CamachoPOS\\"+p;
function pair(){
 const handoff={
  profile:"CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",service_id:"CamachoPOSLocalService",
  service_sid:"S-1-5-80-1-2-3-4-5",installation_id:"c54bbaad-a6dd-45d6-9c6f-cb5e782573c8",
  device_id:"10872779-968b-4f04-a299-99c57d47ac2b",recipient_sid:"S-1-5-21-1-2-3-1001",
  recipient_logon_sid:"S-1-5-5-1-2",recipient_session_id:2,
  recipient_public_key_pem:pem(recipient),recipient_key_sha256:pin(recipient),
  capsule_file:path("capsules\\current.json"),not_before:"2026-11-22T19:00:00.000Z",
  expires_at:"2026-11-22T21:00:00.000Z",revision:1,poll_ms:1000,
  policy_reference:"approved-operator-policy",
 };
 const common={version:1,handoff,adapter_file:path("native\\camacho_windows_pipe.node"),
  adapter_sha256:nativeSha,signer_public_key_pem:pem(signer),signer_spki_sha256:pin(signer)};
 return {service:{...common,role:"SERVICE",signer_private_file:path("service\\private\\signer.json")},
  desktop:{...common,role:"DESKTOP",receiver_file:path("desktop\\private\\receiver.json")}};
}
const adapter=()=>nativeSha;
const encode=p=>serializeScmCandidate(p,adapter,now);
describe("immutable candidate storage",()=>{
 it("serializes validated public metadata with no release authority",()=>{
  const v=encode(pair()),o=JSON.parse(v.payload);
  assert.equal(o.status,"CANDIDATE_NOT_AUTHORIZED");
  assert.equal(v.revision,1);
  assert.equal(inspectScmCandidateBytes(Buffer.from(v.payload),adapter,now).commercial_ready,false);
  assert.equal(Object.hasOwn(o.service,"receiver_file"),false);
  assert.equal(Object.hasOwn(o.desktop,"signer_private_file"),false);
 });
 it("rejects any existing state rather than resetting",()=>{
  assert.doesNotThrow(()=>assertInitialScmCandidateState(null));
  assert.throws(()=>assertInitialScmCandidateState({}),/SCM_STORE_ALREADY_PROVISIONED/);
  assert.throws(()=>assertInitialScmCandidateState(undefined),/SCM_STORE_ALREADY_PROVISIONED/);
 });
 it("rejects mismatched hashes, stale handoffs and sample identities",()=>{
  let p=pair();p.desktop.adapter_sha256="0".repeat(64);
  assert.throws(()=>encode(p),/SCM_NATIVE_ADAPTER_HASH_REJECTED/);
  p=pair();p.service.handoff.installation_id="018f0000-0000-7000-8000-0000000000a1";
  assert.throws(()=>encode(p),/SCM_HANDOFF_IDENTITY_INVALID/);
  assert.throws(()=>serializeScmCandidate(pair(),adapter,new Date("2026-11-24T00:00:00Z")),/SCM_HANDOFF_WINDOW_INVALID/);
 });
 it("rejects altered stored metadata or authority flags",()=>{
  const o=JSON.parse(encode(pair()).payload);
  o.commercial_ready=true;
  assert.throws(()=>inspectScmCandidateBytes(Buffer.from(JSON.stringify(o)),adapter,now),/SCM_STORE_RECORD_SHAPE_INVALID/);
  delete o.commercial_ready;o.status="PRODUCTION";
  assert.throws(()=>inspectScmCandidateBytes(Buffer.from(JSON.stringify(o)),adapter,now),/SCM_STORE_RECORD_STATUS_REJECTED/);
  o.status="CANDIDATE_NOT_AUTHORIZED";o.revision=0;
  assert.throws(()=>inspectScmCandidateBytes(Buffer.from(JSON.stringify(o)),adapter,now),/SCM_STORE_RECORD_TAMPERED/);
 });
 it("refuses non-Windows persistence before filesystem access",()=>{
  assert.throws(()=>persistInitialScmCandidate({pair:pair(),root:path("provisions"),hashOfAdapter:adapter,now,platform:"linux"}),/SCM_STORE_WINDOWS_REQUIRED/);
 });
});
