import {readFile,writeFile,rename,unlink,lstat} from "node:fs/promises";
import {isAbsolute} from "node:path";
import {createHash,verify} from "node:crypto";
import {uuidV7,canonicalSessionTrustJson,validateCommercialHttpsOrigin,SignedLicenseCapacityRevocationSchema} from "@pos-platform/contracts";
import type {LocalDatabase} from "@pos-platform/database-sqlite";
import {LicenseCapacityProvisionSchema,parseLicenseCapacityProvision,parseLicenseCapacityKeys} from "./license-capacity-gate.js";
import {LicenseVerifier} from "./license-verifier.js";
import {TrustedClockGuard} from "./trusted-clock.js";
import type {CommercialDeviceCredentialProvider} from "./commercial-device-credential.js";
import {LocalSecurityLifecycle} from "./security-lifecycle.js";

/** Installer-owned trust only. Remote key metadata can never bootstrap trust.
 * Public artifacts are replaced atomically; credentials remain in OS custody. */
export async function downloadLicenseCapacity(input:{origin:string;activationId:string;provisionFile:string;trustKeys:unknown;
  binding:{tenantId:string;companyId:string;installationId:string;deviceId:string};database:LocalDatabase;
  provider:CommercialDeviceCredentialProvider;timeoutMs:number;signal:AbortSignal},transport:typeof fetch=fetch){
  validateCommercialHttpsOrigin(input.origin);
  if(!isAbsolute(input.provisionFile)||!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0)throw Error("LICENSE_DOWNLOAD_MANAGED_CONFIGURATION_REQUIRED");
  const trustKeys=LicenseCapacityProvisionSchema.shape.keys.parse(input.trustKeys);
  const proof=await input.provider.licenseActivationAuthorization({activationId:input.activationId,requestId:uuidV7(),correlationId:uuidV7()});
  const response=await transport(new URL("/v1/licensing/activations/resolve",input.origin),{method:"POST",body:proof.body,redirect:"error",cache:"no-store",
    signal:AbortSignal.any([input.signal,AbortSignal.timeout(input.timeoutMs)]),headers:{authorization:proof.authorization,"content-type":"application/json",
      "x-request-id":proof.requestId,"x-correlation-id":proof.correlationId}});
  if(response.status!==200||!response.body||!response.headers.get("content-type")?.startsWith("application/json"))throw Error("LICENSE_DOWNLOAD_REJECTED");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
    if(size>262144)throw Error("LICENSE_DOWNLOAD_TOO_LARGE");chunks.push(next.value);}}
  finally{await reader.cancel().catch(()=>undefined);}
  const remote=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
  if(remote.revocation){
    const signed=SignedLicenseCapacityRevocationSchema.parse(remote.revocation),c=signed.claims,key=parseLicenseCapacityKeys(trustKeys).get(c.key_id),b=input.binding;
    if(!key||key.status==='REVOKED'||c.activation_id!==input.activationId||c.tenant_id!==b.tenantId||c.company_id!==b.companyId||c.device_id!==b.deviceId||
      c.installation_id!==b.installationId||c.credential_id!==input.provider.requireVerifiedCredentialId()||Date.parse(c.issued_at)>Date.now()||
      !verify(null,Buffer.from(canonicalSessionTrustJson(c)),key.key,Buffer.from(signed.signature,"base64url")))throw Error("LICENSE_REVOCATION_SIGNATURE_OR_BINDING_REJECTED");
    new TrustedClockGuard(input.database).accept(new Date());
    if(input.signal.aborted)throw Error("LICENSE_DOWNLOAD_CANCELLED");
    input.database.native.transaction(()=>{
      const old=input.database.native.prepare("SELECT details_json FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_REVOCATION_ACCEPTED' AND subject_id=? ORDER BY sequence DESC LIMIT 1").get(c.license_id) as {details_json:string}|undefined;
      if(old){const prior=JSON.parse(old.details_json);if(prior.revocation_sequence>c.revocation_sequence||prior.revocation_sequence===c.revocation_sequence&&canonicalSessionTrustJson(prior)!==canonicalSessionTrustJson(c))throw Error("LICENSE_REVOCATION_REPLAY_CONFLICT");
        if(prior.revocation_sequence===c.revocation_sequence)return;}
      if(input.database.native.prepare("SELECT 1 FROM local_license_activation_state WHERE license_id=?").get(c.license_id))
        new LocalSecurityLifecycle(input.database).revokeLicense(c.license_id,c.reason_code);
      input.database.native.prepare("INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES('LICENSE_CAPACITY_REVOCATION_ACCEPTED',?,?,?)")
        .run(c.license_id,JSON.stringify(c),new Date().toISOString());
    }).immediate();
    return {status:"REVOKED" as const,licenseVersion:c.revocation_sequence,usableNow:false};
  }
  const p=LicenseCapacityProvisionSchema.parse({profile:"CAMACHO_LICENSE_CAPACITY_PROVISION_V2",keys:trustKeys,artifact:remote.artifact}),parsed=parseLicenseCapacityProvision(p);
  const checked=new LicenseVerifier(parsed.keys,new TrustedClockGuard(input.database)).verifyCapacity(p.artifact,input.binding,true),c=checked.claims;
  if(!["VALID","NOT_YET_VALID"].includes(checked.decision)||!c||c.tenant_id!==input.binding.tenantId||c.company_id!==input.binding.companyId)throw Error("LICENSE_DOWNLOAD_SIGNATURE_OR_BINDING_REJECTED");
  const digest=(v:unknown)=>createHash("sha256").update(canonicalSessionTrustJson(v)).digest("hex");
  try{const stat=await lstat(input.provisionFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)throw Error("LICENSE_DOWNLOAD_DESTINATION_REJECTED");
    const old=LicenseCapacityProvisionSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await readFile(input.provisionFile)))).artifact.claims;
    if(old.license_id!==c.license_id||old.license_version>c.license_version||old.license_version===c.license_version&&digest(old)!==digest(c))throw Error("LICENSE_DOWNLOAD_ROLLBACK_OR_CONFLICT");
  }catch(error){if(!(error instanceof Error&&"code" in error&&error.code==='ENOENT'))throw error;}
  if(input.signal.aborted)throw Error("LICENSE_DOWNLOAD_CANCELLED");
  const temporary=input.provisionFile+"."+uuidV7()+".tmp";
  try{await writeFile(temporary,JSON.stringify(p),{flag:"wx",mode:0o600});
    if(input.signal.aborted)throw Error("LICENSE_DOWNLOAD_CANCELLED");await rename(temporary,input.provisionFile);
  }finally{await unlink(temporary).catch(()=>undefined);}
  return {status:"STORED" as const,licenseVersion:c.license_version,usableNow:checked.decision==="VALID"};
}
