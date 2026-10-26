import {createPublicKey,generateKeyPairSync,sign,randomUUID,randomBytes,createHash} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import {afterEach,describe,it,expect} from "vitest";
import {uuidV7,canonicalSessionTrustJson,NativeCommercialRequestSchema,type SignedDeviceTrustCredential} from "@pos-platform/contracts";
import {NativeCommercialCoordinator,type NativeCommercialCentralTransport} from "../src/security/native-commercial-coordinator.js";
import {CommercialComponent} from "../src/commercial/commercial-component.js";
import {DurableSyncStore} from "../src/sync/durable-sync-store.js";
import {LocalChannelClient,LocalChannelAuthenticator,loadOrCreateWindowsLocalChannelSecret} from "@pos-platform/local-channel";
import {LocalChannelComponent} from "../src/channel/local-channel-component.js";
import {CentralDeviceCredentialIssuer,DeviceTrustVerifier,canonicalDeviceTrustJson,verifyDeviceRequestAuthorization,
  verifyCommercialPossession,parseCommercialPossession,type TrustedDeviceTrustKey} from "@pos-platform/device-trust";
import {LocalDatabaseComponent} from "../src/local-database-component.js";
import {LocalSecurityComponent} from "../src/security/local-security-component.js";
import {WindowsDpapiKeyProvider} from "../src/security/windows-dpapi-key-provider.js";
import {EncryptedFileSecretStore} from "../src/security/encrypted-secret-store.js";
import {InsecureDerivedKeyProvider} from "../src/security/insecure-derived-key-provider.js";
import {DeviceEnrollmentService} from "../src/security/device-enrollment-service.js";
import {DeviceTrustCredentialStore} from "../src/security/device-trust-credential-store.js";
import {CommercialDeviceCredentialProvider} from "../src/security/commercial-device-credential.js";
import {TrustedClockGuard} from "../src/security/trusted-clock.js";

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(insecure=false){
  const directory=await mkdtemp(join(tmpdir(),"camacho-commercial-device-")),securityDir=join(directory,"security");
  const binding={tenantId:randomUUID(),companyId:randomUUID(),installationId:randomUUID(),deviceId:randomUUID()};
  const database=new LocalDatabaseComponent(directory);await database.start();
  let now=new Date();const clock=()=>now;
  const provider=insecure?new InsecureDerivedKeyProvider(securityDir):new WindowsDpapiKeyProvider(securityDir);
  let security=new LocalSecurityComponent(database,binding,provider,securityDir,clock);await security.start();
  const secrets=new EncryptedFileSecretStore(securityDir,provider,`device-trust:${binding.installationId}:${binding.deviceId}`);
  const credentials=new DeviceTrustCredentialStore(secrets),root=generateKeyPairSync("ed25519"),operational=generateKeyPairSync("ed25519");
  const keys=new Map<string,TrustedDeviceTrustKey>();
  const verifier=new DeviceTrustVerifier(root.publicKey,keys,{now:clock,accept:date=>new TrustedClockGuard(database.database).accept(date)});
  const claims={key_id:"DEVICE_TRUST_UNIT",public_key_pem:operational.publicKey.export({type:"spki",format:"pem"}).toString(),
    key_purpose:"DEVICE_TRUST",status:"ACTIVE",valid_from:new Date(now.getTime()-1000).toISOString(),version:1};
  const verifiedKey=verifier.verifyOperationalKey({claims,signature:sign(null,Buffer.from(canonicalDeviceTrustJson(claims)),root.privateKey).toString("base64url")});
  expect(verifiedKey.decision).toBe("VALID");
  keys.set(claims.key_id,{key:operational.publicKey,status:"ACTIVE",validFrom:claims.valid_from});
  const enrollment=new DeviceEnrollmentService(database.database,security.identity,binding,clock,credentials);
  const prepared=enrollment.prepare({activation_id:randomUUID(),tenant_id:binding.tenantId,company_id:binding.companyId,
    installation_id:binding.installationId,device_id:binding.deviceId,activation_secret:"a".repeat(64),status:"ISSUED",
    issued_at:new Date(now.getTime()-1000).toISOString(),expires_at:new Date(now.getTime()+60000).toISOString(),version:1});
  const issuer=new CentralDeviceCredentialIssuer({findDevice:async()=>({device_id:binding.deviceId,installation_id:binding.installationId,
    tenant_id:binding.tenantId,company_id:binding.companyId,device_key_id:security.deviceKeyId,device_public_key:security.identity.publicKeyPem(),
    status:"PENDING",trust_key_id:claims.key_id,trust_key_purpose:"DEVICE_TRUST"}),consumeActivationAndIssueCredential:async()=>true},operational.privateKey,{now:clock});
  const result=await issuer.issue({request:prepared.request!,challenge:prepared.request!.challenge,expires_at:new Date(now.getTime()+60000).toISOString()});
  const signer=()=>new CommercialDeviceCredentialProvider(security,database,credentials,verifier,binding);
  cleanup.push(async()=>{secrets.destroy();await security.stop();await database.stop();
    if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("camacho-commercial-device-"))throw Error("TEST_CLEANUP_REJECTED");
    await rm(directory,{recursive:true,force:true});});
  const context=(path="/v1/commercial/native-requests")=>({method:"POST" as const,path,requestId:uuidV7(),correlationId:uuidV7(),body:JSON.stringify({fixture:"exact signed bytes"})});
  return {database,directory,binding,credentials,verifier,keys,context,signer,result,enroll:()=>enrollment.complete(result,verifier),
    withBinding:(other:typeof binding)=>new CommercialDeviceCredentialProvider(security,database,credentials,verifier,other),
    resign:(credential:SignedDeviceTrustCredential)=>({...credential,signature:sign(null,Buffer.from(canonicalDeviceTrustJson(credential.claims)),operational.privateKey).toString("base64url")}),
    identity:()=>security.identity,advance:(ms:number)=>{now=new Date(now.getTime()+ms);},
    tokenStore:()=>{const store=new EncryptedFileSecretStore(securityDir,provider,`commercial-v2:${binding.installationId}:${binding.deviceId}`);cleanup.push(async()=>store.destroy());return store;},
    stop:()=>security.stop(),restart:async()=>{await security.stop();security=new LocalSecurityComponent(database,binding,provider,securityDir,clock);await security.start();}};
}

describe.runIf(process.platform==="win32")("commercial device custody — real Windows DPAPI and temporary SQLite",()=>{
  it("access V2 signs only session and authorization operations for its enrolled binding",async()=>{
    const f=await fixture();f.enroll();const signer=f.signer(),sid=uuidV7();
    const claims={ver:2,iss:"https://business.example.test",aud:"ACCESS_TEST",sub:uuidV7(),sid,tid:f.binding.tenantId,mid:uuidV7(),did:f.binding.deviceId,
      iid:f.binding.installationId,cid:signer.requireVerifiedCredentialId(),client_id:"WINDOWS_TEST",fid:uuidV7(),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,jti:uuidV7(),cnf:{jkt:"a".repeat(43)}};
    // Fixture token is only a signing selector; Central validates real tokens.
    const token="fixture."+Buffer.from(JSON.stringify(claims)).toString("base64url")+".fixture";
    const c={origin:claims.iss,audience:claims.aud,clientId:claims.client_id,token,requestId:uuidV7(),correlationId:uuidV7(),body:JSON.stringify({session_id:sid})};
    const key=createPublicKey(f.identity().publicKeyPem()),binding={credentialId:claims.cid,tenantId:claims.tid,installationId:claims.iid,deviceId:claims.did};
    const a=await signer.sessionAssertionPossession(c),b=await signer.authorizationSnapshotPossession(c);
    expect(verifyCommercialPossession(a,{...c,...binding,operation:"SESSION_ASSERTION"},key,new Date(),30_000)).toBe(true);
    expect(verifyCommercialPossession(b,{...c,...binding,operation:"AUTHORIZATION_SNAPSHOT"},key,new Date(),30_000)).toBe(true);
    expect(verifyCommercialPossession(a,{...c,...binding,operation:"AUTHORIZATION_SNAPSHOT"},key,new Date(),30_000)).toBe(false);
    for(const changes of [{body:JSON.stringify({session_id:uuidV7()})},{audience:"OTHER"},{clientId:"OTHER"},{origin:"https://other.example.test"}])
      await expect(signer.sessionAssertionPossession({...c,...changes})).rejects.toThrow("COMMERCIAL_ACCESS_BODY_OR_BINDING_REJECTED");
    const changed=f.credentials.load();changed.claims.credential_id=randomUUID();f.credentials.save(f.resign(changed));
    await expect(signer.authorizationSnapshotPossession(c)).rejects.toThrow();
  },60_000);
  it("refresh V2 signs only the closed operation under real custody and rejects lost enrollment",async()=>{
    const f=await fixture();f.enroll();const token=randomBytes(48).toString("base64url"),signer=f.signer(),c={origin:"https://business.example.test",audience:"REFRESH_TEST",clientId:"WINDOWS_TEST",token,requestId:uuidV7(),correlationId:uuidV7(),body:JSON.stringify({grant_type:"refresh_token",refresh_token:token,client_id:"WINDOWS_TEST"})};
    const proof=await signer.refreshPossession(c),second=await signer.refreshPossession(c);
    expect(parseCommercialPossession(proof)?.nonce).not.toBe(parseCommercialPossession(second)?.nonce);
    const expected={...c,operation:"REFRESH" as const,credentialId:signer.requireVerifiedCredentialId(),tenantId:f.binding.tenantId,installationId:f.binding.installationId,deviceId:f.binding.deviceId};
    expect(verifyCommercialPossession(proof,expected,createPublicKey(f.identity().publicKeyPem()),new Date(),30_000)).toBe(true);
    expect(verifyCommercialPossession(proof,{...expected,operation:"SESSION_ASSERTION"},createPublicKey(f.identity().publicKeyPem()),new Date(),30_000)).toBe(false);
    await f.restart();expect(parseCommercialPossession(await f.signer().refreshPossession(c))).not.toBeNull();
    await f.stop();await expect(signer.refreshPossession(c)).rejects.toThrow("device identity is not ready");
  },60000);
  it("uses the audited enrolled local identity for all fixed commercial routes with fresh nonces",async()=>{
    const f=await fixture();f.enroll();const signer=f.signer();
    for(const path of ["/v1/commercial/native-requests","/v1/commercial/token","/v1/business-session/assertions","/v1/business-session/authorization"]){
      const context=f.context(path),proof=await signer.authorization(context),second=await signer.authorization(context);
      const verified=verifyDeviceRequestAuthorization(proof,context,createPublicKey(f.identity().publicKeyPem()));
      expect(verified?.credentialId).toBe(f.result.credential_id);expect(second).not.toBe(proof);
      expect(verifyDeviceRequestAuthorization(proof,{...context,body:context.body+" "},createPublicKey(f.identity().publicKeyPem()))).toBeNull();
    }
  },60000);
  it("does not sign before enrollment",async()=>{
    const f=await fixture();await expect(f.signer().authorization(f.context())).rejects.toThrow("DEVICE_TRUST_NOT_PROVISIONED");
  });
  it("does not accept a stored credential without canonical completion",async()=>{
    const f=await fixture();f.credentials.save(f.result.credential);await expect(f.signer().authorization(f.context())).rejects.toThrow("DEVICE_ENROLLMENT_COMPLETION_NOT_RECORDED");
  });
  it("rejects a credential left behind by failed enrollment audit",async()=>{
    const f=await fixture();f.database.database.native.exec("CREATE TRIGGER reject_enrollment_audit BEFORE INSERT ON local_security_audit WHEN NEW.event_type='DEVICE_ENROLLMENT_COMPLETED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE'); END");
    expect(()=>f.enroll()).toThrow("AUDIT_FAILURE");expect(f.credentials.has()).toBe(true);
    await expect(f.signer().authorization(f.context())).rejects.toThrow("DEVICE_ENROLLMENT_COMPLETION_NOT_RECORDED");
  });
  it.each(["signature","tenant","company","installation","device","publicKey"])("rejects changed certified %s",async field=>{
    const f=await fixture();f.enroll();const credential=f.credentials.load();
    if(field==="signature")credential.signature="A".repeat(86);
    else {if(field==="tenant")credential.claims.tenant_id=randomUUID();if(field==="company")credential.claims.company_id=randomUUID();
      if(field==="installation")credential.claims.installation_id=randomUUID();if(field==="device")credential.claims.device_id=randomUUID();
      if(field==="publicKey")credential.claims.device_public_key_pem=generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"}).toString();
    }
    f.credentials.save(field==="signature"?credential:f.resign(credential));
    await expect(f.signer().authorization(f.context())).rejects.toThrow(field==="publicKey"?"DEVICE_ENROLLMENT_LOCAL_KEY_MISMATCH":"DEVICE_TRUST_REJECTED");
  });
  it("rechecks expiry and central operational-key revocation on each use",async()=>{
    const f=await fixture();f.enroll();const signer=f.signer();await signer.authorization(f.context());
    const key=f.keys.get("DEVICE_TRUST_UNIT")!;f.keys.set("DEVICE_TRUST_UNIT",{...key,status:"REVOKED"});
    await expect(signer.authorization(f.context())).rejects.toThrow("KEY_REVOKED");
    f.keys.set("DEVICE_TRUST_UNIT",key);f.advance(60000);
    await expect(signer.authorization(f.context())).rejects.toThrow("CREDENTIAL_EXPIRED");
  });
  it("local revocation and lifecycle shutdown invalidate an existing signer",async()=>{
    const f=await fixture();f.enroll();const signer=f.signer();
    f.database.database.native.prepare("UPDATE local_device_identity_state SET status='REVOKED'").run();
    await expect(signer.authorization(f.context())).rejects.toThrow("COMMERCIAL_DEVICE_KEY_INACTIVE");
    await f.stop();await expect(signer.authorization(f.context())).rejects.toThrow("device identity is not ready");
  });
  it("recovers the same DPAPI-protected key after restart without exporting it",async()=>{
    const f=await fixture();f.enroll();const original=f.identity().deviceKeyId();await f.restart();
    expect(f.identity().deviceKeyId()).toBe(original);const context=f.context();
    expect(verifyDeviceRequestAuthorization(await f.signer().authorization(context),context,createPublicKey(f.identity().publicKeyPem()))?.credentialId).toBe(f.result.credential_id);
  },60000);
  it("rejects unrelated paths and oversized requests without a signing endpoint",async()=>{
    const f=await fixture();f.enroll();
    for(const path of ["/v1/sync/batches","/v1/commercial/token?x=1","//v1/commercial/token"])
      await expect(f.signer().authorization(f.context(path))).rejects.toThrow("COMMERCIAL_DEVICE_REQUEST_REJECTED");
    await expect(f.signer().authorization({...f.context(),body:"a".repeat(16385)})).rejects.toThrow("COMMERCIAL_DEVICE_REQUEST_REJECTED");
  });
  it("does not let trusted-client IDs silently rebind the local installation",async()=>{
    const f=await fixture();f.enroll();await expect(f.withBinding({...f.binding,installationId:randomUUID()}).authorization(f.context())).rejects.toThrow("COMMERCIAL_DEVICE_LOCAL_BINDING_MISMATCH");
  });
  it("refuses the TEST_ONLY provider even with a valid credential and audit",async()=>{
    const f=await fixture(true);f.enroll();await expect(f.signer().authorization(f.context())).rejects.toThrow("COMMERCIAL_DEVICE_OS_CUSTODY_REQUIRED");
  });
});

async function coordinatedFixture(v2=false){
  const f=await fixture();f.enroll();const user=randomUUID(),sid=randomUUID(),branch=randomUUID(),ssa=generateKeyPairSync("ed25519"),sas=generateKeyPairSync("ed25519");
  const config={data_directory:f.directory,installation_id:f.binding.installationId,device_id:f.binding.deviceId,tenant_id:f.binding.tenantId,
    company_id:f.binding.companyId,branch_id:branch,service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0"};
  const commercial=new CommercialComponent(config,f.database,{store:new DurableSyncStore(f.database.database)} as never,
    new Map([["SSA_UNIT",{key:ssa.publicKey,status:"ACTIVE"}]]),undefined,undefined,undefined,new Map([["SAS_UNIT",{key:sas.publicKey,status:"ACTIVE"}]]));
  await commercial.start();cleanup.push(()=>commercial.stop());
  const at=new Date(),until=new Date(at.getTime()+60000).toISOString();
  const assertionClaims={session_id:sid,user_id:user,tenant_membership_id:randomUUID(),installation_id:f.binding.installationId,device_id:f.binding.deviceId,
    sequence:1,key_id:"SSA_UNIT",issued_at:at.toISOString(),offline_valid_until:until};
  const snapshotClaims={snapshot_id:randomUUID(),user_id:user,installation_id:f.binding.installationId,device_id:f.binding.deviceId,sequence:1,
    key_id:"SAS_UNIT",issued_at:at.toISOString(),expires_at:until,assignments:[]};
  const artifact=<T extends object>(claims:T,key:ReturnType<typeof generateKeyPairSync>["privateKey"])=>({claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),key).toString("base64url")});
  const assertion=artifact(assertionClaims,ssa.privateKey),snapshot=artifact(snapshotClaims,sas.privateKey),nonce=new Set<string>(),paths:string[]=[];
  const registration={clientId:"desktop",redirectUri:"http://127.0.0.1:42133/callback",authorizationOrigin:"https://business.example.test"};
  const tokenClaims={ver:2,iss:registration.authorizationOrigin,aud:"ACCESS_TEST",sub:user,sid,tid:f.binding.tenantId,mid:assertionClaims.tenant_membership_id,
    did:f.binding.deviceId,iid:f.binding.installationId,cid:f.result.credential_id,client_id:registration.clientId,fid:uuidV7(),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,jti:uuidV7(),cnf:{jkt:"a".repeat(43)}};
  const tokens=()=>({accessToken:"fixture."+Buffer.from(JSON.stringify({...tokenClaims,jti:uuidV7()})).toString("base64url")+".fixture",refreshToken:randomBytes(48).toString("base64url")});
  let currentTokens=tokens();
  let hook:((path:string)=>Promise<void>)|undefined;
  const transport:NativeCommercialCentralTransport={post:async(path,body,headers,signal)=>{
    paths.push(path);if(hook)await hook(path);if(signal.aborted)throw Error("ABORTED");
    if(path.endsWith("native-request-challenges"))return {challenge_id:uuidV7(),challenge:randomBytes(32).toString("base64url"),expires_at:until};
    if(v2&&(path.endsWith("/assertions")||path.endsWith("/authorization")||path.endsWith("/refresh"))){
      const refresh=path.endsWith("/refresh"),operation=refresh?"REFRESH":path.endsWith("/assertions")?"SESSION_ASSERTION":"AUTHORIZATION_SNAPSHOT";
      expect(verifyCommercialPossession(headers.authorization!,{operation,origin:registration.authorizationOrigin,audience:"ACCESS_TEST",clientId:registration.clientId,
        tenantId:f.binding.tenantId,installationId:f.binding.installationId,deviceId:f.binding.deviceId,credentialId:f.result.credential_id!,
        token:refresh?JSON.parse(body).refresh_token:currentTokens.accessToken,body,requestId:headers["x-request-id"]!,correlationId:headers["x-correlation-id"]!},createPublicKey(f.identity().publicKeyPem()),new Date(),30_000)).toBe(true);
      if(refresh){currentTokens=tokens();assertion.claims.sequence++;snapshot.claims.sequence++;
        assertion.signature=artifact(assertion.claims,ssa.privateKey).signature;snapshot.signature=artifact(snapshot.claims,sas.privateKey).signature;
        return {status:"ROTATED",access:currentTokens.accessToken,refreshToken:currentTokens.refreshToken};}
      return path.endsWith("/assertions")?assertion:snapshot;
    }
    const verified=verifyDeviceRequestAuthorization(headers.authorization!,{method:"POST",path,body,requestId:headers["x-request-id"]!,correlationId:headers["x-correlation-id"]!},createPublicKey(f.identity().publicKeyPem()));
    expect(verified?.credentialId).toBe(f.result.credential_id);expect(nonce.has(verified!.nonce)).toBe(false);nonce.add(verified!.nonce);
    if(path.endsWith("native-requests"))return {authorization_url:registration.authorizationOrigin+"/v1/commercial/login?request="+randomBytes(32).toString("base64url"),expires_at:until};
    if(path.endsWith("/token"))return v2?currentTokens:{accessToken:"e30."+Buffer.from(JSON.stringify({sid})).toString("base64url")+".c2ln",refreshToken:randomBytes(48).toString("base64url")};
    if(path.endsWith("/assertions"))return assertion;return snapshot;
  }};
  let now=Date.now();const store=v2?f.tokenStore():undefined;
  const coordinatorPolicy={mode:"ISOLATED_VALIDATION" as const,attemptLifetimeMs:30000,...(v2?{accessV2:{audience:"ACCESS_TEST"}}:{})};
  const createCoordinator=()=>new NativeCommercialCoordinator(f.signer(),registration,transport,commercial,coordinatorPolicy,()=>now,
    store?{store:f.tokenStore(),maximumRetentionMs:60_000}:undefined);
  const coordinator=createCoordinator();
  cleanup.push(async()=>coordinator.stop());
  const state=randomBytes(32).toString("base64url"),verifier=randomBytes(48).toString("base64url");
  const beginPayload={state,code_challenge:createHash("sha256").update(verifier).digest("base64url")};
  const envelope=(message_type:string,payload:unknown)=>({protocol_version:"1.0.0",message_type,request_id:uuidV7(),correlation_id:uuidV7(),payload_schema_version:"1.0.0",payload});
  const call=(type:string,payload:unknown,connection="owner",signal=new AbortController().signal)=>coordinator.handle(envelope(type,payload),connection,signal);
  const begin=async()=>{const response=await call("commercial.native.begin",beginPayload);expect(response.result?.outcome).toBe("PREPARED");return response.result!.attempt_id!;};
  const complete=(id:string,overrides={})=>call("commercial.native.complete",{attempt_id:id,code:"authorized-code-fixture",state,code_verifier:verifier,...overrides});
  return {...f,config,commercial,coordinator,assertion,snapshot,paths,call,begin,complete,envelope,beginPayload,codeVerifier:verifier,store,createCoordinator,
    hook:(h:typeof hook)=>{hook=h;},expire:()=>{now+=30001;}};
}

describe.runIf(process.platform==="win32")("privileged native coordinator",()=>{
  it("deployment renewal hook waits for its explicit lead time and renews only a bound session",async()=>{
    const f=await coordinatedFixture(true),id=await f.begin();await f.complete(id);await f.call("commercial.native.commit",{attempt_id:id});
    expect(await f.coordinator.renewIfDue("owner",new AbortController().signal,30_000)).toBe("NOT_DUE");
    f.expire();expect(await f.coordinator.renewIfDue("owner",new AbortController().signal,30_000)).toBe("RENEWED");
    expect(f.paths.filter(p=>p.endsWith("/refresh"))).toHaveLength(1);
  },60_000);
  it("durable V2: reopens DPAPI credentials after identity restart and rotates with fresh possession",async()=>{
    const f=await coordinatedFixture(true),id=await f.begin();await f.complete(id);
    expect(JSON.parse(f.store!.read("commercial-credentials-v2").toString()).state).toBe("CLOSED");
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("ACTIVATED");
    expect(await f.coordinator.renewAuthorization("unbound",new AbortController().signal)).toBe(false);
    f.coordinator.stop();await f.restart();const resumed=f.createCoordinator();
    expect(await resumed.renewAuthorization("owner",new AbortController().signal)).toBe(true);
    expect(f.paths.filter(x=>x.endsWith("/refresh"))).toHaveLength(1);
    const stored=JSON.parse(f.store!.read("commercial-credentials-v2").toString());
    expect(stored.ssa.claims.sequence).toBe(2);expect(stored.sas.claims.sequence).toBe(2);resumed.stop();
  },60_000);
  it.each(["network","loss","concurrent"])("durable V2: %s never retries a refresh with uncertain delivery",async reason=>{
    const f=await coordinatedFixture(true),id=await f.begin();await f.complete(id);await f.call("commercial.native.commit",{attempt_id:id});
    let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>finish=r);
    f.hook(async path=>{if(path.endsWith("/refresh")){entered();await gate;if(reason==="network")throw Error("NETWORK_LOST");}});
    const first=f.coordinator.renewAuthorization("owner",new AbortController().signal);await started;
    expect(await f.coordinator.renewAuthorization("owner",new AbortController().signal)).toBe(false);
    if(reason==="loss")f.coordinator.release("owner");finish();expect(await first).toBe(reason==="concurrent");
    if(reason!=="concurrent"){
      expect(JSON.parse(f.store!.read("commercial-credentials-v2").toString()).state).toBe("CLOSED");
      expect(await f.createCoordinator().renewAuthorization("owner",new AbortController().signal)).toBe(false);
    }
    expect(f.paths.filter(x=>x.endsWith("/refresh"))).toHaveLength(1);
  },60_000);
  it("durable V2: activation rollback and retention expiry leave no usable credentials",async()=>{
    const f=await coordinatedFixture(true),id=await f.begin();await f.complete(id);
    f.database.database.native.exec("CREATE TRIGGER v2_sas_fail BEFORE INSERT ON local_authorization_snapshot BEGIN SELECT RAISE(ABORT,'V2_SAS_FAIL'); END");
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("DENIED");
    expect(JSON.parse(f.store!.read("commercial-credentials-v2").toString()).state).toBe("CLOSED");
    f.database.database.native.exec("DROP TRIGGER v2_sas_fail");const next=await f.begin();await f.complete(next);await f.call("commercial.native.commit",{attempt_id:next});
    f.expire();f.expire();expect(await f.coordinator.renewAuthorization("owner",new AbortController().signal)).toBe(false);
    expect(f.paths.filter(x=>x.endsWith("/refresh"))).toHaveLength(0);
  },60_000);
  it("uses DPAPI proofs and commits verified SSA/SAS together only after explicit commit",async()=>{
    const f=await coordinatedFixture(),id=await f.begin();expect((await f.complete(id)).result?.outcome).toBe("VERIFIED");
    expect(f.commercial.bindings.resolve("owner")).toBeNull();
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("ACTIVATED");
    expect(f.commercial.bindings.resolve("owner")?.ssaSessionId).toBe((f.assertion.claims as {session_id:string}).session_id);
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("DENIED");expect(f.paths).toHaveLength(5);
  });
  it.each(["state","code_verifier"])("rejects manipulated %s without redeeming a code",async field=>{
    const f=await coordinatedFixture(),id=await f.begin();expect((await f.complete(id,{[field]:"x".repeat(43)})).result?.outcome).toBe("DENIED");expect(f.paths).toHaveLength(2);
  });
  it("rejects another connection, duplicate begin and replayed operation IDs",async()=>{
    const f=await coordinatedFixture(),id=await f.begin();
    expect((await f.call("commercial.native.commit",{attempt_id:id},"other")).result?.outcome).toBe("DENIED");
    expect((await f.call("commercial.native.begin",f.beginPayload)).result?.outcome).toBe("DENIED");
    const request=f.envelope("commercial.native.complete",{attempt_id:id,code:"authorized-code-fixture",state:f.beginPayload.state,code_verifier:f.codeVerifier});
    expect((await f.coordinator.handle(request,"owner",new AbortController().signal)).result?.outcome).toBe("VERIFIED");
    expect((await f.coordinator.handle(request,"owner",new AbortController().signal)).result?.outcome).toBe("DENIED");
  });
  it.each(["expiry","cancel","loss"])("never commits after %s",async reason=>{
    const f=await coordinatedFixture(),id=await f.begin();await f.complete(id);
    if(reason==="expiry")f.expire();else if(reason==="cancel")await f.call("commercial.native.cancel",{attempt_id:id});else f.coordinator.release("owner");
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("DENIED");expect(f.commercial.bindings.resolve("owner")).toBeNull();
  });
  it("rechecks the exact credential before commit",async()=>{
    const f=await coordinatedFixture(),id=await f.begin();await f.complete(id);
    const changed=f.credentials.load();changed.claims.credential_id=randomUUID();f.credentials.save(f.resign(changed));
    f.database.database.native.prepare("INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES ('DEVICE_ENROLLMENT_COMPLETED','FIXTURE_ROTATION',?,?)")
      .run(JSON.stringify({credential_id:changed.claims.credential_id}),new Date().toISOString());
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("DENIED");
  });
  it("rolls SSA back when SAS persistence fails",async()=>{
    const f=await coordinatedFixture(),id=await f.begin();await f.complete(id);
    f.database.database.native.exec("CREATE TRIGGER native_sas_fail BEFORE INSERT ON local_authorization_snapshot BEGIN SELECT RAISE(ABORT,'SAS_FAIL'); END");
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("DENIED");
    expect(f.database.database.native.prepare("SELECT count(*) AS n FROM local_session_assertion").get()).toEqual({n:0});expect(f.commercial.bindings.resolve("owner")).toBeNull();
  });
  it("rejects altered SAS signatures and a channel lost while awaiting Central",async()=>{
    const f=await coordinatedFixture(),id=await f.begin();f.snapshot.signature="A".repeat(86);await f.complete(id);
    expect((await f.call("commercial.native.commit",{attempt_id:id})).result?.outcome).toBe("DENIED");
    const next=await f.begin();f.hook(async path=>{if(path.endsWith("/token"))f.coordinator.release("owner");});
    expect((await f.complete(next)).result?.outcome).toBe("DENIED");expect(f.commercial.bindings.resolve("owner")).toBeNull();
  });
  it("closed contracts reject signing bodies, paths, credential IDs and asserted tenant",async()=>{
    const f=await coordinatedFixture();
    for(const extra of [{path:"/anything"},{body:"{}"},{credential_id:randomUUID()}])
      expect(NativeCommercialRequestSchema.safeParse(f.envelope("commercial.native.begin",{...f.beginPayload,...extra})).success).toBe(false);
    expect(NativeCommercialRequestSchema.safeParse({...f.envelope("commercial.native.begin",f.beginPayload),tenant_id:randomUUID()}).success).toBe(false);
  });
  it("real Windows authenticated pipe denies bad MAC/binding and cannot transfer an attempt to another connection",async()=>{
    const f=await coordinatedFixture();
    const server=new LocalChannelComponent(f.config,f.database,()=>"READY",{} as never,f.commercial,f.coordinator);await server.start();
    cleanup.push(()=>server.stop());
    const secret=loadOrCreateWindowsLocalChannelSecret(f.directory,f.binding.installationId);
    const connect=async(badMac=false,badBinding=false)=>{
      const auth=new LocalChannelAuthenticator(badMac?randomBytes(32):secret),client=new LocalChannelClient(server.endpoint,auth,{min:"1.0.0",max:"1.0.0"},1500);
      cleanup.push(async()=>{await client.close();auth.destroy();});
      await client.connect(f.envelope("runtime.handshake",{desktop_version:"1.0.0",service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0",
        installation_id:badBinding?randomUUID():f.binding.installationId,device_id:f.binding.deviceId,schema_version:"5",service_state:"READY"}));return client;
    };
    await expect(connect(true)).rejects.toThrow();await expect(connect(false,true)).rejects.toThrow();expect(f.paths).toHaveLength(0);
    const owner=await connect(),prepared=await owner.request(f.envelope("commercial.native.begin",f.beginPayload)) as {result:{attempt_id:string}};
    const other=await connect();const stolen=await other.request(f.envelope("commercial.native.commit",{attempt_id:prepared.result.attempt_id})) as {result_code:string};
    expect(stolen.result_code).toBe("DENIED");await owner.close();
    expect((await other.request(f.envelope("commercial.native.commit",{attempt_id:prepared.result.attempt_id})) as {result_code:string}).result_code).toBe("DENIED");secret.fill(0);
  },30000);
});
