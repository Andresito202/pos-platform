import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {afterEach,it,expect} from "vitest";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {unsignedAuthorizationTrustCandidateBytes,type AuthorizationTrustCandidateClaims} from "@pos-platform/contracts";
import {AuthorizationTrustLifecycle,type PrivilegedAuthorizationTrust} from "../src/security/authorization-trust-lifecycle.js";
import {AuthorizationTrustCandidateStore} from "../src/security/authorization-trust-candidate.js";
import {EncryptedFileSecretStore} from "../src/security/encrypted-secret-store.js";
import {WindowsDpapiKeyProvider} from "../src/security/windows-dpapi-key-provider.js";
import {TrustedClockGuard} from "../src/security/trusted-clock.js";

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"camacho-trust-lifecycle-"));
  if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("camacho-trust-lifecycle-"))throw Error("TEST_PATH_REJECTED");
  const db=LocalDatabase.open({dataDirectory:dir}),root=generateKeyPairSync("ed25519"),key=generateKeyPairSync("ed25519");
  const binding={installationId:randomUUID(),deviceId:randomUUID()};let now=new Date("2026-10-25T12:00:00.000Z");
  const secrets=new EncryptedFileSecretStore(dir,new WindowsDpapiKeyProvider(dir),`sas-lab:${binding.installationId}:${binding.deviceId}`);
  const store=new AuthorizationTrustCandidateStore(secrets,{mode:"ISOLATED_VALIDATION",issuer:"https://business.example.test",authorityId:"ROOT_LAB",
    environment:"isolated-validation",minimumGeneration:1,root:root.publicKey},new Map(),new TrustedClockGuard(db,0),()=>now);
  const claims:AuthorizationTrustCandidateClaims={profile:"DEC011_LAB_CANDIDATE_1",mode:"ISOLATED_VALIDATION",schema_version:1,
    purpose:"AUTHORIZATION_SNAPSHOT",environment:"isolated-validation",issuer:"https://business.example.test",authority_id:"ROOT_LAB",generation:1,complete:true,
    issued_at:"2026-10-25T11:00:00.000Z",valid_from:"2026-10-25T11:00:00.000Z",valid_until:"2026-10-25T12:01:00.000Z",
    keys:[{key_id:"SAS_TEST_LIFECYCLE",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:key.publicKey.export({type:"spki",format:"pem"}).toString(),
      status:"ACTIVE",version:1,valid_from:"2026-10-25T11:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z"}]};
  const install=()=>store.install({claims,signature:sign(null,unsignedAuthorizationTrustCandidateBytes(claims),root.privateKey).toString("base64url")});
  const events:string[]=[];let destroyed=false;
  const adapter:PrivilegedAuthorizationTrust={binding,readKeys:()=>store.resolve(),refresh:async()=>{install();},destroy:()=>{destroyed=true;secrets.destroy();}};
  const component=new AuthorizationTrustLifecycle(binding,{create:()=>adapter,refreshIntervalMs:60000},event=>events.push(event));
  cleanup.push(async()=>{await component.stop();secrets.destroy();db.close();rmSync(dir,{recursive:true,force:true});});
  return {binding,adapter,store,claims,install,component,events,destroyed:()=>destroyed,advance:()=>{now=new Date(now.getTime()+61000);}};
}

it.runIf(process.platform==="win32")("SAS lifecycle: boot and refresh use DPAPI live verification; revoked and offline-expired keys disappear",async()=>{
  const f=fixture();expect(f.component.keys.size).toBe(0);await f.component.start();expect(f.component.keys.size).toBe(1);
  f.adapter.refresh=async()=>{throw Error("OFFLINE");};await f.component.refreshNow();expect(f.component.keys.size).toBe(1);
  f.advance();expect(f.component.keys.size).toBe(0);
  f.claims.generation++;f.claims.valid_until="2026-10-25T12:05:00.000Z";f.claims.keys[0]!.status="REVOKED";f.claims.keys[0]!.version++;
  f.adapter.refresh=async()=>{f.install();};await f.component.refreshNow();expect(f.component.keys.get("SAS_TEST_LIFECYCLE")?.status).toBe("REVOKED");
  f.binding.deviceId=randomUUID();let called=false;f.adapter.refresh=async()=>{called=true;};
  await f.component.refreshNow();expect(called).toBe(false);expect(f.component.keys.size).toBe(0);
  await f.component.stop();expect(f.component.keys.size).toBe(0);expect(f.destroyed()).toBe(true);expect(f.events).toContain("FAILED");
});
it.runIf(process.platform==="win32")("SAS lifecycle: coalesces privileged refresh and cancellation joins it before destroying custody",async()=>{
  const f=fixture();await f.component.start();let calls=0,entered!:()=>void;
  const ready=new Promise<void>(resolve=>entered=resolve);
  f.adapter.refresh=signal=>new Promise<void>((_resolve,reject)=>{calls++;entered();signal.addEventListener("abort",()=>reject(Error("CHANNEL_LOST")),{once:true});});
  const first=f.component.refreshNow(),second=f.component.refreshNow();await ready;
  const stopping=f.component.stop();expect(f.component.keys.size).toBe(0);await Promise.all([first,second,stopping]);
  expect(calls).toBe(1);expect(f.destroyed()).toBe(true);
  const boot=fixture();boot.adapter.refresh=signal=>new Promise<void>((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("BOOT_CANCELLED")),{once:true}));
  const starting=boot.component.start();await boot.component.stop();await starting;
  expect(boot.component.keys.size).toBe(0);expect(boot.destroyed()).toBe(true);
});
it.runIf(process.platform==="win32")("SAS lifecycle: refuses a provisioning adapter bound to another device and destroys it",async()=>{
  const f=fixture();const wrong=new AuthorizationTrustLifecycle({...f.binding,deviceId:randomUUID()},{create:()=>f.adapter,refreshIntervalMs:1000},()=>{});
  await expect(wrong.start()).rejects.toThrow("SAS_PROVISIONING_DEVICE_BINDING_REJECTED");expect(wrong.keys.size).toBe(0);expect(f.destroyed()).toBe(true);
});
it("SAS lifecycle: no provisioned adapter or missing refresh policy cannot create authority",async()=>{
  const binding={installationId:randomUUID(),deviceId:randomUUID()},empty=new AuthorizationTrustLifecycle(binding,undefined,()=>{});
  await empty.start();await empty.refreshNow();expect([...empty.keys]).toEqual([]);await empty.stop();
  expect(()=>new AuthorizationTrustLifecycle(binding,{create:()=>{throw Error("UNREACHABLE");},refreshIntervalMs:0},()=>{})).toThrow("SAS_EXPLICIT_REFRESH_POLICY_REQUIRED");
});
