import {createPublicKey} from "node:crypto";
import {UuidSchema} from "@pos-platform/contracts";
import {DeviceTrustVerifier,type DeviceTrustBinding} from "@pos-platform/device-trust";
import type {LocalDatabaseComponent} from "../local-database-component.js";
import type {DeviceRequestSigningContext} from "../sync/device-credential.js";
import {LocalSecurityComponent} from "./local-security-component.js";
import {DeviceTrustCredentialStore} from "./device-trust-credential-store.js";

const COMMERCIAL_PATHS=new Set([
  "/v1/commercial/native-requests","/v1/commercial/token",
  "/v1/business-session/assertions","/v1/business-session/authorization",
]);

/** Privileged Service-only adapter; not a signing RPC. No private key is
 * exported to Electron/preload/React. Construction cannot activate a login.
 * The transport must still be approved, authenticated and bound to its client.
 * Central remains responsible for current credential/device revocation.
 */
export class CommercialDeviceCredentialProvider {
  private readonly binding:Readonly<DeviceTrustBinding>;
  constructor(
    private readonly security:LocalSecurityComponent,
    private readonly database:LocalDatabaseComponent,
    private readonly credentials:DeviceTrustCredentialStore,
    private readonly verifier:DeviceTrustVerifier,
    binding:DeviceTrustBinding,
  ){
    if(!(security instanceof LocalSecurityComponent)||!(verifier instanceof DeviceTrustVerifier)||
      !(credentials instanceof DeviceTrustCredentialStore))throw Error("COMMERCIAL_DEVICE_TRUST_REQUIRED");
    this.binding=Object.freeze({tenantId:UuidSchema.parse(binding.tenantId),companyId:UuidSchema.parse(binding.companyId),
      installationId:UuidSchema.parse(binding.installationId),deviceId:UuidSchema.parse(binding.deviceId)});
  }

  async authorization(context:DeviceRequestSigningContext):Promise<string>{
    if(!context||context.method!=="POST"||!COMMERCIAL_PATHS.has(context.path)||
      typeof context.body!=="string"||Buffer.byteLength(context.body)>16*1024)
      throw Error("COMMERCIAL_DEVICE_REQUEST_REJECTED");
    if(this.security.protection!=="OS_BOUND")throw Error("COMMERCIAL_DEVICE_OS_CUSTODY_REQUIRED");
    if(!this.security.matchesDeviceBinding(this.binding))throw Error("COMMERCIAL_DEVICE_LOCAL_BINDING_MISMATCH");
    // Obtain the live identity on every call: stopped/replaced components cannot
    // keep signing through a captured DeviceIdentity after lifecycle shutdown.
    const identity=this.security.identity;
    if(!this.credentials.has())throw Error("DEVICE_TRUST_NOT_PROVISIONED");
    const credential=this.credentials.load();
    const verified=this.verifier.verifyCredential(credential,this.binding);
    if(verified.decision!=="VALID")throw Error(`DEVICE_TRUST_REJECTED:${verified.decision}`);
    if(credential.claims.expires_at!==null&&Date.parse(verified.evaluatedAt)>=Date.parse(credential.claims.expires_at))
      throw Error("DEVICE_TRUST_REJECTED:CREDENTIAL_EXPIRED");
    const certified=createPublicKey(credential.claims.device_public_key_pem).export({type:"spki",format:"der"});
    const local=createPublicKey(identity.publicKeyPem()).export({type:"spki",format:"der"});
    if(!certified.equals(local))throw Error("DEVICE_ENROLLMENT_LOCAL_KEY_MISMATCH");
    const db=this.database.database.native;
    const active=db.prepare(`SELECT 1 FROM local_device_identity_state s
      JOIN local_device_key_history h ON h.device_key_id=s.active_key_id
      WHERE s.singleton=1 AND s.status='ACTIVE' AND h.status='ACTIVE' AND h.device_key_id=?`).get(identity.deviceKeyId());
    if(!active)throw Error("COMMERCIAL_DEVICE_KEY_INACTIVE");
    const completed=db.prepare(`SELECT 1 FROM local_security_audit WHERE event_type='DEVICE_ENROLLMENT_COMPLETED'
      AND json_extract(details_json,'$.credential_id')=? LIMIT 1`).get(credential.claims.credential_id);
    if(!completed)throw Error("DEVICE_ENROLLMENT_COMPLETION_NOT_RECORDED");
    // Reuse the canonical request signer and nonce construction. No key copy,
    // second credential store or alternative DeviceProof format is introduced.
    return identity.signRequestAuthorization({...context,credentialId:credential.claims.credential_id});
  }
}
