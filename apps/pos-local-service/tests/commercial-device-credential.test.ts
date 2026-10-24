import {createPublicKey,generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import {afterEach,describe,it,expect} from "vitest";
import {uuidV7,type SignedDeviceTrustCredential} from "@pos-platform/contracts";
import {CentralDeviceCredentialIssuer,DeviceTrustVerifier,canonicalDeviceTrustJson,verifyDeviceRequestAuthorization,
  type TrustedDeviceTrustKey} from "@pos-platform/device-trust";
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
  return {database,binding,credentials,verifier,keys,context,signer,result,enroll:()=>enrollment.complete(result,verifier),
    withBinding:(other:typeof binding)=>new CommercialDeviceCredentialProvider(security,database,credentials,verifier,other),
    resign:(credential:SignedDeviceTrustCredential)=>({...credential,signature:sign(null,Buffer.from(canonicalDeviceTrustJson(credential.claims)),operational.privateKey).toString("base64url")}),
    identity:()=>security.identity,advance:(ms:number)=>{now=new Date(now.getTime()+ms);},
    stop:()=>security.stop(),restart:async()=>{await security.stop();security=new LocalSecurityComponent(database,binding,provider,securityDir,clock);await security.start();}};
}

describe.runIf(process.platform==="win32")("commercial device custody — real Windows DPAPI and temporary SQLite",()=>{
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
