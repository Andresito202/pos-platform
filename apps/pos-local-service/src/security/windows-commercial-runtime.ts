import {createHash,createPublicKey} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import * as z from "zod";
import {validateWindowsCommercialRegistration,type NativeClientRegistration} from "@pos-platform/contracts";
import {DeviceTrustVerifier} from "@pos-platform/device-trust";
import type {RuntimeComponent} from "../lifecycle.js";
import type {LocalDatabaseComponent} from "../local-database-component.js";
import type {CommercialComponent} from "../commercial/commercial-component.js";
import {LocalSecurityComponent} from "./local-security-component.js";
import {EncryptedFileSecretStore,type SecretStoreKeyProvider} from "./encrypted-secret-store.js";
import {DeviceTrustCredentialStore} from "./device-trust-credential-store.js";
import {CommercialDeviceCredentialProvider} from "./commercial-device-credential.js";
import {NativeCommercialCoordinator} from "./native-commercial-coordinator.js";
import {NativeCommercialHttps} from "./native-commercial-https.js";
import {TrustedClockGuard} from "./trusted-clock.js";

const ms=z.number().int().positive().max(2_147_483_647);
const Configuration=z.strictObject({profile:z.literal("CAMACHO_WINDOWS_COMMERCIAL_V2"),
  environment:z.enum(["PREPRODUCTION","PRODUCTION"]),
  registration:z.strictObject({clientId:z.string(),redirectUri:z.string(),authorizationOrigin:z.string(),platform:z.literal("ELECTRON")}),
  rp_id:z.string(),webauthn_origin:z.string(),audience:z.string().min(1).max(128),
  device_trust_root_public_key_pem:z.string().min(80).max(4096),device_trust_root_spki_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  device_trust_operational_keys:z.array(z.unknown()).min(1).max(32),
  request_timeout_ms:ms,attempt_lifetime_ms:ms,maximum_retention_ms:ms,
  renewal_interval_ms:ms,renewal_before_expiry_ms:ms,
}).refine(p=>p.renewal_interval_ms<p.renewal_before_expiry_ms,"renewal interval must be shorter than lead time");

/** Installer-owned deployment file. No renderer/main payload is provisioning. */
export function readWindowsCommercialConfiguration(path:string,centralOrigin:string|undefined){
  if(!isAbsolute(path))throw Error("COMMERCIAL_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)throw Error("COMMERCIAL_MANAGED_FILE_REJECTED");
  const p=Configuration.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path))));
  validateWindowsCommercialRegistration(p.registration,p.rp_id,p.webauthn_origin);
  if(!centralOrigin||p.registration.authorizationOrigin!==new URL(centralOrigin).origin)throw Error("COMMERCIAL_CENTRAL_ORIGIN_MISMATCH");
  const root=createPublicKey(p.device_trust_root_public_key_pem);
  if(root.asymmetricKeyType!=="ed25519"||createHash("sha256").update(root.export({type:"spki",format:"der"})).digest("hex")!==p.device_trust_root_spki_sha256)
    throw Error("COMMERCIAL_PROVISIONED_ROOT_REJECTED");
  return Object.freeze({...p,registration:Object.freeze({...p.registration})});
}

/** Production lifecycle composition; algorithms remain in their existing owners.
 * Without configuration no instance is mounted. Without DEV-003 every operation
 * still reaches the canonical verifier and is denied. */
export class WindowsCommercialRuntime implements RuntimeComponent{
  readonly name="windows-commercial";
  private coordinator:NativeCommercialCoordinator|undefined;
  private tokens:EncryptedFileSecretStore|undefined;
  private timer:ReturnType<typeof setInterval>|undefined;
  private readonly leases=new Map<string,AbortController>();
  private readonly pending=new Set<Promise<unknown>>();
  constructor(private readonly p:ReturnType<typeof readWindowsCommercialConfiguration>,
    private readonly dependencies:{database:LocalDatabaseComponent;security:LocalSecurityComponent;commercial:CommercialComponent;
      credentials:DeviceTrustCredentialStore;directory:string;keyProvider:SecretStoreKeyProvider;
      binding:{tenantId:string;companyId:string;installationId:string;deviceId:string}}){}
  async start(){
    if(process.platform!=="win32"||this.dependencies.security.protection!=="OS_BOUND")throw Error("COMMERCIAL_WINDOWS_DPAPI_REQUIRED");
    const d=this.dependencies,keys=new Map(),root=createPublicKey(this.p.device_trust_root_public_key_pem);
    const verifier=new DeviceTrustVerifier(root,keys,{now:()=>new Date(),accept:at=>new TrustedClockGuard(d.database.database).accept(at)});
    for(const raw of this.p.device_trust_operational_keys){
      const checked=verifier.verifyOperationalKey(raw);if(checked.decision!=="VALID"||!checked.value)throw Error("COMMERCIAL_OPERATIONAL_TRUST_REJECTED");
      const k=checked.value;if(keys.has(k.key_id))throw Error("COMMERCIAL_OPERATIONAL_KEY_ALIAS_REJECTED");
      keys.set(k.key_id,{key:createPublicKey(k.public_key_pem),status:k.status,validFrom:k.valid_from});
    }
    this.tokens=new EncryptedFileSecretStore(d.directory,d.keyProvider,`commercial-v2:${d.binding.installationId}:${d.binding.deviceId}`);
    try{this.coordinator=new NativeCommercialCoordinator(new CommercialDeviceCredentialProvider(d.security,d.database,d.credentials,verifier,d.binding),
      this.p.registration as NativeClientRegistration,new NativeCommercialHttps(this.p.registration,this.p.request_timeout_ms),d.commercial,
      {mode:"DEPLOYMENT",attemptLifetimeMs:this.p.attempt_lifetime_ms,accessV2:{audience:this.p.audience}},undefined,
      {store:this.tokens,maximumRetentionMs:this.p.maximum_retention_ms});}
    catch(error){this.tokens.destroy();this.tokens=undefined;throw error;}
    this.timer=setInterval(()=>{for(const [id,lease] of this.leases){
      const work=this.coordinator?.renewIfDue(id,lease.signal,this.p.renewal_before_expiry_ms);
      if(work){this.pending.add(work);void work.finally(()=>this.pending.delete(work));}
    }},this.p.renewal_interval_ms);this.timer.unref?.();
  }
  handle(...args:Parameters<NativeCommercialCoordinator["handle"]>){if(!this.coordinator)throw Error("COMMERCIAL_RUNTIME_NOT_STARTED");return this.coordinator.handle(...args);}
  recovered(connectionId:string){if(!this.leases.has(connectionId))this.leases.set(connectionId,new AbortController());}
  release(connectionId:string){this.leases.get(connectionId)?.abort();this.leases.delete(connectionId);this.coordinator?.release(connectionId);}
  async stop(){
    if(this.timer)clearInterval(this.timer);this.timer=undefined;
    for(const id of this.leases.keys())this.release(id);this.coordinator?.stop();
    await Promise.allSettled([...this.pending]);this.coordinator=undefined;this.tokens?.destroy();this.tokens=undefined;
  }
}
