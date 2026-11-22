import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertInitialScmCandidateState, serializeScmCandidate, inspectScmCandidateBytes, persistInitialScmCandidate, recoverPinnedScmCandidate } from "./scm-immutable-provision-store.mjs";

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

it("checks signed approval scope and rejects using the Service signer as the approval root",()=>{
 const p=pair(),record=encode(p),h=p.service.handoff;
 const binding={installationId:h.installation_id,deviceId:h.device_id,revision:h.revision,
  policyReference:h.policy_reference,authorityPin:"f".repeat(64)};
 const base={root:path("provisions"),expectedSha256:record.sha256,minRevision:1,
  hashOfAdapter:adapter,now,platform:"win32",invoke:()=>({status:0,stdout:Buffer.from(record.payload).toString("base64")})};
 assert.equal(recoverPinnedScmCandidate({...base,expectedBinding:binding}).commercial_ready,false);
 for(const change of [{installationId:h.device_id},{deviceId:h.installation_id},{revision:2},
  {policyReference:"wrong"},{authorityPin:p.service.signer_spki_sha256}]){
  assert.throws(()=>recoverPinnedScmCandidate({...base,expectedBinding:{...binding,...change}}),/SCM_RECOVERY_APPROVAL_BINDING_REJECTED/);
 }
});
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
 it("PowerShell native writer parses without execution", { skip:process.platform!=="win32" },()=>{
  const script=fileURLToPath(new URL("./write-scm-candidate-once.ps1",import.meta.url));
  const escaped=script.replaceAll("'","''");
  const cmd=`$tokens=$null; $errors=$null; $source=[IO.File]::ReadAllText('${escaped}'); [void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors); if($errors.Count -ne 0){ $errors | Out-String | Write-Error; exit 1 }`;
  const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",cmd],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr||result.stdout);
 });

 it("recovers only an independently pinned candidate and never authorizes commercial use",()=>{
  const record=encode(pair());
  let called=0;
  const invoke=(_command,args,options)=>{
    called++;
    assert.equal(args[3].endsWith("read-scm-candidate-verified.ps1"),true);
    assert.equal(JSON.parse(options.input).root,path("provisions"));
    return {status:0,stdout:Buffer.from(record.payload).toString("base64")};
  };
  const recovered=recoverPinnedScmCandidate({
    root:path("provisions"),expectedSha256:record.sha256,minRevision:1,
    hashOfAdapter:adapter,now,platform:"win32",invoke,
  });
  assert.equal(called,1);
  assert.deepEqual(recovered,{
    status:"CANDIDATE_RECOVERED_NOT_AUTHORIZED",
    sha256:record.sha256,revision:1,commercial_ready:false,
  });
 });
 it("rejects substituted bytes, untrusted pins, failed native reads and rollback floors",()=>{
  const record=encode(pair());
  const payload=Buffer.from(record.payload).toString("base64");
  const base={root:path("provisions"),expectedSha256:record.sha256,minRevision:1,
    hashOfAdapter:adapter,now,platform:"win32"};
  assert.throws(()=>recoverPinnedScmCandidate({...base,expectedSha256:undefined,
    invoke:()=>{throw Error("must not invoke");}}),/SCM_RECOVERY_TRUSTED_PIN_REQUIRED/);
  assert.throws(()=>recoverPinnedScmCandidate({...base,minRevision:0,
    invoke:()=>{throw Error("must not invoke");}}),/SCM_RECOVERY_MIN_REVISION_REQUIRED/);
  assert.throws(()=>recoverPinnedScmCandidate({...base,invoke:()=>({status:0,
    stdout:Buffer.from(record.payload+" ").toString("base64")})}),/SCM_RECOVERY_PIN_MISMATCH/);
  assert.throws(()=>recoverPinnedScmCandidate({...base,invoke:()=>({status:1,stdout:payload})}),
    /SCM_RECOVERY_NATIVE_READ_REJECTED/);
  assert.throws(()=>recoverPinnedScmCandidate({...base,minRevision:2,
    invoke:()=>({status:0,stdout:payload})}),/SCM_RECOVERY_ROLLBACK_REJECTED/);
  assert.throws(()=>recoverPinnedScmCandidate({...base,invoke:()=>({status:0,stdout:"***"})}),
    /SCM_RECOVERY_BYTES_REJECTED/);
  assert.throws(()=>recoverPinnedScmCandidate({...base,expectedSha256:"0".repeat(64),
    invoke:()=>({status:0,stdout:payload})}),/SCM_RECOVERY_PIN_MISMATCH/);
 });
 it("PowerShell native reader parses without execution", {skip:process.platform!=="win32"},()=>{
  const script=fileURLToPath(new URL("./read-scm-candidate-verified.ps1",import.meta.url));
  const escaped=script.replaceAll("'","''");
  const cmd=`$tokens=$null; $errors=$null; $source=[IO.File]::ReadAllText('${escaped}'); [void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors); if($errors.Count -ne 0){ $errors | Out-String | Write-Error; exit 1 }`;
  const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",cmd],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr||result.stdout);
 });

});
