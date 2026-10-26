import {createPublicKey,randomBytes} from "node:crypto";
import {UuidSchema,CommercialRefreshRequestSchema,CommercialAccessClaimsSchema} from "@pos-platform/contracts";
import {DeviceTrustVerifier,commercialPossessionChallenge,type CommercialPossessionContext,type DeviceTrustBinding} from "@pos-platform/device-trust";
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
    const {identity,credential}=this.requireVerified();
    return identity.signRequestAuthorization({...context,credentialId:credential.claims.credential_id});
  }
  requireVerifiedCredentialId():string{return this.requireVerified().credential.claims.credential_id;}
  async sessionAssertionPossession(context:Parameters<CommercialDeviceCredentialProvider["refreshPossession"]>[0]){
    return this.accessPossession(context,"SESSION_ASSERTION");
  }
  async authorizationSnapshotPossession(context:Parameters<CommercialDeviceCredentialProvider["refreshPossession"]>[0]){
    return this.accessPossession(context,"AUTHORIZATION_SNAPSHOT");
  }
  private accessPossession(context:Parameters<CommercialDeviceCredentialProvider["refreshPossession"]>[0],operation:"SESSION_ASSERTION"|"AUTHORIZATION_SNAPSHOT"){
    const claims=CommercialAccessClaimsSchema.parse(JSON.parse(Buffer.from(context.token.split(".")[1]??"","base64url").toString("utf8"))),body=JSON.parse(context.body);
    const credentialId=this.requireVerifiedCredentialId();
    // Parsing never authenticates a token. Central verifies its signature and
    // current family; here it only constrains what this enrolled key may sign.
    if(claims.iss!==context.origin||claims.aud!==context.audience||claims.client_id!==context.clientId||claims.cid!==credentialId||
      claims.tid!==this.binding.tenantId||claims.iid!==this.binding.installationId||claims.did!==this.binding.deviceId||claims.exp<=Math.floor(Date.now()/1000)||
      !body||typeof body!=="object"||Object.keys(body).length!==1||body.session_id!==claims.sid)throw Error("COMMERCIAL_ACCESS_BODY_OR_BINDING_REJECTED");
    return this.possession(context,operation);
  }
  /** Closed refresh proof, Service-only. Not an arbitrary sign(path,body) API. */
  async refreshPossession(context:Omit<CommercialPossessionContext,"operation"|"credentialId"|"tenantId"|"installationId"|"deviceId">):Promise<string>{
    const request=CommercialRefreshRequestSchema.parse(JSON.parse(context.body));
    if(request.refresh_token!==context.token||request.client_id!==context.clientId)throw Error("COMMERCIAL_REFRESH_BODY_REJECTED");
    return this.possession(context,"REFRESH");
  }
  private possession(context:Parameters<CommercialDeviceCredentialProvider["refreshPossession"]>[0],operation:CommercialPossessionContext["operation"]){
    const {identity,credential}=this.requireVerified(),timestamp=new Date().toISOString(),nonce=randomBytes(32).toString("base64url");
    const c:CommercialPossessionContext={...context,operation,credentialId:credential.claims.credential_id,
      tenantId:this.binding.tenantId,installationId:this.binding.installationId,deviceId:this.binding.deviceId};
    const signature=identity.signChallenge(commercialPossessionChallenge(c,{timestamp,nonce})).toString("base64url");
    return `CommercialProofV2 ${c.credentialId}.${timestamp}.${nonce}.${signature}`;
  }
  private requireVerified(){
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
    return {identity,credential};
  }
}
