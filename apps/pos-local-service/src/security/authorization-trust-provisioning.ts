import {createHash,createPublicKey} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import * as z from "zod";
import {AuthorizationTrustRecipientSchema,SignedAuthorizationTrustSchema} from "@pos-platform/contracts";
import type {LocalDatabase} from "@pos-platform/database-sqlite";
import {AuthorizationTrustStore} from "./authorization-trust-candidate.js";
import {EncryptedFileSecretStore,type SecretStoreKeyProvider} from "./encrypted-secret-store.js";
import {TrustedClockGuard} from "./trusted-clock.js";
import type {TrustedSigningKey} from "./license-verifier.js";
import type {PrivilegedAuthorizationTrust} from "./authorization-trust-lifecycle.js";

/** Installer/Service configuration, NEVER a renderer or named-pipe payload.
 * Installer ACLs and out-of-band fingerprint verification remain operator duties.
 * This channel installs signed sets only; it cannot replace a root in place. */
const ProvisionSchema=z.strictObject({
  version:z.literal(1),environment:z.enum(["PREPRODUCTION","PRODUCTION"]),
  issuer:SignedAuthorizationTrustSchema.shape.claims.shape.issuer,
  authority_id:SignedAuthorizationTrustSchema.shape.claims.shape.authority_id,
  recipient:AuthorizationTrustRecipientSchema,minimum_generation:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  root_public_key_pem:z.string().max(4096).regex(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/),
  root_spki_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  artifact_path:z.string().refine(isAbsolute),refresh_interval_ms:z.number().int().min(1000).max(2_147_483_647),
  clock_rollback_tolerance_ms:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
function readManagedJson(path:string):unknown{
  if(!isAbsolute(path))throw Error("SAS_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error("SAS_MANAGED_FILE_REJECTED");
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path)));
}
export function prepareAuthorizationTrustProvisioning(input:{
  path:string;recipient:z.infer<typeof AuthorizationTrustRecipientSchema>;centralOrigin:string|undefined;
  directory:string;keyProvider:SecretStoreKeyProvider;database:()=>LocalDatabase;
  sessionKeys:ReadonlyMap<string,TrustedSigningKey>;now?:()=>Date;
}):{refreshIntervalMs:number;create:()=>PrivilegedAuthorizationTrust}{
  const p=ProvisionSchema.parse(readManagedJson(input.path)),root=createPublicKey(p.root_public_key_pem);
  if(root.type!=="public"||root.asymmetricKeyType!=="ed25519"||input.keyProvider.protection!=="OS_BOUND"||
    createHash("sha256").update(root.export({type:"spki",format:"der"})).digest("hex")!==p.root_spki_sha256)
    throw Error("SAS_PROVISIONED_ROOT_REJECTED");
  if(input.centralOrigin!==p.issuer||Object.entries(input.recipient).some(([k,v])=>p.recipient[k as keyof typeof p.recipient]!==v))
    throw Error("SAS_PROVISIONING_SCOPE_REJECTED");
  const now=input.now??(()=>new Date());
  return {refreshIntervalMs:p.refresh_interval_ms,create:()=>{
    const secrets=new EncryptedFileSecretStore(input.directory,input.keyProvider,`authorization-trust-v1:${p.recipient.installation_id}:${p.recipient.device_id}`);
    try{
      const store=new AuthorizationTrustStore(secrets,{mode:"DEPLOYMENT",issuer:p.issuer,authorityId:p.authority_id,environment:p.environment,
        minimumGeneration:p.minimum_generation,root,recipient:p.recipient},input.sessionKeys,new TrustedClockGuard(input.database(),p.clock_rollback_tolerance_ms),now);
      let destroyed=false;
      return {binding:Object.freeze({installationId:p.recipient.installation_id,deviceId:p.recipient.device_id}),
        readKeys:()=>destroyed?new Map():store.resolve(),
        refresh:async(signal:AbortSignal)=>{
          signal.throwIfAborted();if(destroyed)throw Error("SAS_PROVISIONING_CLOSED");
          const artifact=readManagedJson(p.artifact_path);signal.throwIfAborted();store.install(artifact);
        },destroy:()=>{destroyed=true;secrets.destroy();}};
    }catch(error){secrets.destroy();throw error;}
  }};
}
