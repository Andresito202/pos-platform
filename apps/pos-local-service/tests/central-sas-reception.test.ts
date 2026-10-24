import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {join,dirname,resolve,basename} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,it,expect} from "vitest";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {canonicalSessionTrustJson,type AuthorizationSnapshotClaims,type IpcRequest} from "@pos-platform/contracts";
import {CommercialComponent} from "../src/commercial/commercial-component.js";
import {CommercialRequestHandler} from "../src/commercial/commercial-request-handler.js";
import {DurableSyncStore} from "../src/sync/durable-sync-store.js";
import type {TrustedSigningKey} from "../src/security/license-verifier.js";

// Crypto fixtures exercise receiver failure paths only. Dashboard E2E uses the
// PostgreSQL producer, never these unit claims as commercial authority.
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"camacho-sas-reception-")),db=LocalDatabase.open({dataDirectory:dir});
  let now=new Date();const clock=()=>now;
  const user=randomUUID(),tenant=randomUUID(),company=randomUUID(),branch=randomUUID(),installation=randomUUID(),device=randomUUID();
  const config={data_directory:dir,installation_id:installation,device_id:device,tenant_id:tenant,company_id:company,branch_id:branch,
    service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0"};
  const ssa=generateKeyPairSync("ed25519"),sas=generateKeyPairSync("ed25519");
  const keys=new Map<string,TrustedSigningKey>([["SAS_TEST_UNIT",{key:sas.publicKey,status:"ACTIVE"}]]);
  const component=new CommercialComponent(config,{database:db} as never,{store:new DurableSyncStore(db)} as never,
    new Map([["SSA_TEST_UNIT",{key:ssa.publicKey,status:"ACTIVE"}]]),clock,undefined,undefined,keys);
  await component.start();const handler=new CommercialRequestHandler(config,component);
  const request=(type:string,payload:unknown={})=>({protocol_version:"1.0.0",message_type:type,request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload}) as IpcRequest;
  const call=(type:string,payload:unknown={})=>handler.handle(request(type,payload) as never,"fixture-native-connection") as {status:string;result_code:string;result:{permissions?:string[]}};
  const claims={session_id:randomUUID(),user_id:user,tenant_membership_id:randomUUID(),installation_id:installation,device_id:device,sequence:1,
    key_id:"SSA_TEST_UNIT",issued_at:now.toISOString(),offline_valid_until:new Date(now.getTime()+3600_000).toISOString()};
  expect(call("session.activate",{session_assertion:{claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),ssa.privateKey).toString("base64url")}}).result_code).toBe("ACTIVATED");
  const projection=(sequence=1):AuthorizationSnapshotClaims=>({snapshot_id:randomUUID(),user_id:user,installation_id:installation,device_id:device,sequence,
    key_id:"SAS_TEST_UNIT",issued_at:now.toISOString(),expires_at:new Date(now.getTime()+30_000).toISOString(),assignments:[{tenant_id:tenant,company_id:company,branch_id:branch,
      status:"ACTIVE",valid_from:new Date(now.getTime()-1000).toISOString(),valid_until:null,role_status:"ACTIVE",permissions:[{code:"AUDIT_EVENT_READ",status:"ACTIVE"}]}]});
  const signed=(claims=projection())=>({claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),sas.privateKey).toString("base64url")});
  const acquire=(artifact=signed())=>component.refreshAuthorization({fetch:async()=>artifact});
  cleanup.push(async()=>{await component.stop();db.close();if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("camacho-sas-reception-"))throw Error("SAS_TEST_CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});});
  return {db,component,keys,projection,signed,acquire,call,advance:()=>{now=new Date(now.getTime()+31_000);}};
}
it("central SAS reception: verified projection persists, permissions are scoped and direct forbidden operation is denied",async()=>{
  const f=await fixture();expect(await f.acquire()).toMatchObject({kind:"ACQUIRED",sequence:1});
  expect(f.call("authorization.capabilities.get").result.permissions).toEqual(["AUDIT_EVENT_READ"]);
  expect(f.call("catalog.item.list",{query:"",limit:1,offset:0}).result_code).toBe("UNAUTHORIZED");
});
it.each(["signature","key","user","device","installation"])("central SAS reception: rejects altered %s",async target=>{
  const f=await fixture(),artifact=f.signed();
  if(target==="signature")artifact.signature=(artifact.signature[0]==="A"?"B":"A")+artifact.signature.slice(1);
  if(target==="key")artifact.claims.key_id="SSA_TEST_UNIT";
  if(["user","device","installation"].includes(target)){
    if(target==="user")artifact.claims.user_id=randomUUID();if(target==="device")artifact.claims.device_id=randomUUID();if(target==="installation")artifact.claims.installation_id=randomUUID();
    artifact.signature=f.signed(artifact.claims).signature;
  }
  expect(await f.acquire(artifact)).toMatchObject({kind:"VERIFICATION_FAILED"});expect(f.call("authorization.capabilities.get").result.permissions).toEqual([]);
});
it.each(["company","branch","tenant"])("central SAS reception: authentic other %s scope grants no capability",async target=>{
  const f=await fixture(),claims=f.projection(),a=claims.assignments[0]!;
  if(target==="company")a.company_id=randomUUID();if(target==="branch")a.branch_id=randomUUID();if(target==="tenant")a.tenant_id=randomUUID();
  expect(await f.acquire(f.signed(claims))).toMatchObject({kind:"ACQUIRED"});expect(f.call("authorization.capabilities.get").result.permissions).toEqual([]);
});
it("central SAS reception: repeated or old sequence never replaces the current projection",async()=>{
  const f=await fixture(),old=f.signed();await f.acquire(old);await f.acquire(f.signed(f.projection(2)));
  expect(await f.acquire(old)).toMatchObject({kind:"STALE_SEQUENCE",currentSequence:2});
});
it("central SAS reception: updated revocation and signing-key revocation deny subsequent backend operations",async()=>{
  const f=await fixture();await f.acquire();
  const revoked=f.projection(2);revoked.assignments[0]!.status="REVOKED";await f.acquire(f.signed(revoked));
  expect(f.call("authorization.capabilities.get").result.permissions).toEqual([]);
  await f.acquire(f.signed(f.projection(3)));f.keys.set("SAS_TEST_UNIT",{...f.keys.get("SAS_TEST_UNIT")!,status:"REVOKED"});
  expect(f.call("authorization.capabilities.get").result_code).toBe("AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
});
it("central SAS reception: central outage preserves only a still-valid snapshot with no expiry grace",async()=>{
  const f=await fixture();await f.acquire();
  expect(await f.component.refreshAuthorization({fetch:async()=>{throw Error("OFFLINE");}})).toMatchObject({kind:"PROVIDER_UNAVAILABLE"});
  expect(f.call("authorization.capabilities.get").result.permissions).toEqual(["AUDIT_EVENT_READ"]);f.advance();
  expect(f.call("authorization.capabilities.get").result_code).toBe("AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
});
it("central SAS reception: local write failure rolls back and keeps the previous signed sequence",async()=>{
  const f=await fixture();await f.acquire();
  f.db.native.exec("CREATE TRIGGER sas_test_failure BEFORE UPDATE ON local_authorization_snapshot BEGIN SELECT RAISE(ABORT,'SAS_IO_FAILURE'); END");
  await expect(f.acquire(f.signed(f.projection(2)))).rejects.toThrow("SAS_IO_FAILURE");f.db.native.exec("DROP TRIGGER sas_test_failure");
  expect(f.call("authorization.capabilities.get").result.permissions).toEqual(["AUDIT_EVENT_READ"]);
});
it("central SAS reception: a corrupt on-disk signature cannot become authorization through its checksum",async()=>{
  const f=await fixture();await f.acquire();f.db.native.prepare("UPDATE local_authorization_snapshot SET signature=?").run("A".repeat(86));
  expect(f.call("authorization.capabilities.get").result_code).toBe("AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
});
it("central SAS reception: invalid or expired authorization key window fails closed",async()=>{
  const f=await fixture();await f.acquire();const key=f.keys.get("SAS_TEST_UNIT")!;
  f.keys.set("SAS_TEST_UNIT",{...key,validUntil:"not-a-date"});
  expect(f.call("authorization.capabilities.get").result_code).toBe("AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
  f.keys.set("SAS_TEST_UNIT",{...key,validUntil:new Date(Date.now()-1000).toISOString()});
  expect(f.call("authorization.capabilities.get").result_code).toBe("AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
});
