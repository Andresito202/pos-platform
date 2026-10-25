import {createHash,generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it} from "vitest";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {SignedAuthorizationTrustCandidateSchema,SignedAuthorizationTrustSchema,unsignedAuthorizationTrustBytes,type AuthorizationTrustClaims} from "@pos-platform/contracts";
import {WindowsDpapiKeyProvider} from "../src/security/windows-dpapi-key-provider.js";
import {prepareAuthorizationTrustProvisioning} from "../src/security/authorization-trust-provisioning.js";
import {AuthorizationTrustLifecycle} from "../src/security/authorization-trust-lifecycle.js";

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"camacho-sas-deployment-")),db=LocalDatabase.open({dataDirectory:dir});
  const root=generateKeyPairSync("ed25519"),key=generateKeyPairSync("ed25519"),keyProvider=new WindowsDpapiKeyProvider(dir);
  const recipient={tenant_id:randomUUID(),company_id:randomUUID(),branch_id:randomUUID(),installation_id:randomUUID(),device_id:randomUUID()};
  let now=new Date("2026-10-25T12:00:00.000Z");
  const artifact=join(dir,"signed-set.json"),path=join(dir,"provision.json");
  const provision={version:1,environment:"PREPRODUCTION",issuer:"https://central.example.test",authority_id:"TEST_SAS_ROOT",recipient,
    minimum_generation:1,root_public_key_pem:root.publicKey.export({type:"spki",format:"pem"}).toString(),
    root_spki_sha256:createHash("sha256").update(root.publicKey.export({type:"spki",format:"der"})).digest("hex"),
    artifact_path:artifact,refresh_interval_ms:1000,clock_rollback_tolerance_ms:0};
  const claims:AuthorizationTrustClaims={profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",schema_version:1,purpose:"AUTHORIZATION_SNAPSHOT",
    environment:"PREPRODUCTION",issuer:provision.issuer,authority_id:provision.authority_id,recipient,generation:1,complete:true,
    issued_at:"2026-10-25T11:00:00.000Z",valid_from:"2026-10-25T11:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z",
    keys:[{key_id:"SAS_DEPLOYMENT_TEST",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:key.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",version:1,
      valid_from:"2026-10-25T11:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z"}]};
  const signed=()=>({claims:structuredClone(claims),signature:sign(null,unsignedAuthorizationTrustBytes(claims),root.privateKey).toString("base64url")});
  const write=()=>writeFileSync(artifact,JSON.stringify(signed()));
  const configure=()=>writeFileSync(path,JSON.stringify(provision));configure();write();
  const prepare=()=>prepareAuthorizationTrustProvisioning({path,recipient,centralOrigin:provision.issuer,directory:dir,keyProvider,database:()=>db,sessionKeys:new Map(),now:()=>now});
  cleanup.push(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,root,recipient,claims,provision,signed,write,configure,prepare,artifact,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
it.runIf(process.platform==="win32")("SAS deployment: approved profile is disjoint from LAB and authenticates recipient",()=>{
  const f=fixture();expect(SignedAuthorizationTrustSchema.safeParse(f.signed()).success).toBe(true);
  expect(SignedAuthorizationTrustCandidateSchema.safeParse(f.signed()).success).toBe(false);
  expect(SignedAuthorizationTrustSchema.safeParse({...f.signed(),claims:{...f.claims,profile:"DEC011_LAB_CANDIDATE_1",mode:"ISOLATED_VALIDATION"}}).success).toBe(false);
});
it.runIf(process.platform==="win32")("SAS deployment: DPAPI bootstrap rotation restart and expiry use the existing lifecycle",async()=>{
  const f=fixture(),p=f.prepare();const binding={installationId:f.recipient.installation_id,deviceId:f.recipient.device_id};
  const lifecycle=new AuthorizationTrustLifecycle(binding,p,()=>{});cleanup.push(()=>{void lifecycle.stop();});
  await lifecycle.start();expect(lifecycle.keys.get("SAS_DEPLOYMENT_TEST")?.status).toBe("ACTIVE");
  f.claims.generation=2;f.claims.keys[0]!.version=2;f.claims.keys[0]!.status="REVOKED";f.write();
  await lifecycle.refreshNow();expect(lifecycle.keys.get("SAS_DEPLOYMENT_TEST")?.status).toBe("REVOKED");await lifecycle.stop();
  const recovered=p.create();cleanup.push(()=>recovered.destroy());expect(recovered.readKeys().get("SAS_DEPLOYMENT_TEST")?.status).toBe("REVOKED");
  f.advance(3_600_000);expect(recovered.readKeys().size).toBe(0);
});
it.runIf(process.platform==="win32").each(["tenant_id","company_id","branch_id","installation_id","device_id"] as const)("SAS deployment: root-signed wrong %s is denied",async field=>{
  const f=fixture(),adapter=f.prepare().create();cleanup.push(()=>adapter.destroy());
  f.claims.recipient={...f.claims.recipient,[field]:randomUUID()};f.write();
  await expect(adapter.refresh(new AbortController().signal)).rejects.toThrow("SAS_TRUST_RECIPIENT_REJECTED");expect(adapter.readKeys().size).toBe(0);
});
it.runIf(process.platform==="win32")("SAS deployment: manipulated envelope and rollback preserve protected generation",async()=>{
  const f=fixture(),adapter=f.prepare().create();cleanup.push(()=>adapter.destroy());
  f.claims.generation=2;f.write();await adapter.refresh(new AbortController().signal);
  const altered=f.signed();altered.claims.generation=3;writeFileSync(f.artifact,JSON.stringify(altered));
  await expect(adapter.refresh(new AbortController().signal)).rejects.toThrow("SAS_ROOT_SIGNATURE_INVALID");
  f.claims.generation=1;f.write();await expect(adapter.refresh(new AbortController().signal)).rejects.toThrow("SAS_GENERATION_ROLLBACK");
  expect(adapter.readKeys().size).toBe(1);
});
it.runIf(process.platform==="win32")("SAS deployment: root replacement cannot silently reset history",async()=>{
  const f=fixture(),adapter=f.prepare().create();await adapter.refresh(new AbortController().signal);adapter.destroy();
  const newRoot=generateKeyPairSync("ed25519");f.provision.root_public_key_pem=newRoot.publicKey.export({type:"spki",format:"pem"}).toString();
  f.provision.root_spki_sha256=createHash("sha256").update(newRoot.publicKey.export({type:"spki",format:"der"})).digest("hex");f.configure();
  const replaced=f.prepare().create();cleanup.push(()=>replaced.destroy());expect(replaced.readKeys().size).toBe(0);
  const next={claims:f.claims,signature:sign(null,unsignedAuthorizationTrustBytes(f.claims),newRoot.privateKey).toString("base64url")};writeFileSync(f.artifact,JSON.stringify(next));
  await expect(replaced.refresh(new AbortController().signal)).rejects.toThrow("SAS_ROOT_SIGNATURE_INVALID");
});
it.runIf(process.platform==="win32")("SAS deployment: cancellation closure and bad pin cannot install trust",async()=>{
  const f=fixture(),adapter=f.prepare().create();cleanup.push(()=>adapter.destroy());
  const controller=new AbortController();controller.abort();await expect(adapter.refresh(controller.signal)).rejects.toThrow();expect(adapter.readKeys().size).toBe(0);
  adapter.destroy();await expect(adapter.refresh(new AbortController().signal)).rejects.toThrow("SAS_PROVISIONING_CLOSED");
  f.provision.root_spki_sha256="0".repeat(64);f.configure();expect(()=>f.prepare()).toThrow("SAS_PROVISIONED_ROOT_REJECTED");
});
it.runIf(process.platform==="win32")("SAS deployment: raised bootstrap floor preserves old history while allowing authenticated renewal",async()=>{
  const f=fixture(),first=f.prepare().create();await first.refresh(new AbortController().signal);first.destroy();
  f.provision.minimum_generation=2;f.configure();
  const renewed=f.prepare().create();cleanup.push(()=>renewed.destroy());expect(renewed.readKeys().size).toBe(0);
  f.claims.generation=2;f.claims.keys[0]!.status="REVOKED";f.claims.keys[0]!.version=2;f.write();
  await renewed.refresh(new AbortController().signal);expect(renewed.readKeys().get("SAS_DEPLOYMENT_TEST")?.status).toBe("REVOKED");
});
