import {createHash,verify,type KeyObject} from "node:crypto";
import {canonicalSessionTrustJson,UuidSchema} from "@pos-platform/contracts";
import {deviceRequestProofBytes,type DeviceRequestProofInput} from "./request-proof.js";

const paths={SESSION_ASSERTION:"/v1/business-session/assertions",AUTHORIZATION_SNAPSHOT:"/v1/business-session/authorization",REFRESH:"/v1/commercial/refresh"} as const;
export interface CommercialPossessionCandidateContext {
  readonly mode:"ISOLATED_VALIDATION";
  readonly operation:keyof typeof paths;
  readonly origin:string;readonly audience:string;readonly clientId:string;
  readonly tenantId:string;readonly installationId:string;readonly deviceId:string;
  readonly credentialId:string;readonly token:string;
  readonly requestId:string;readonly correlationId:string;readonly body:string;
}
export type CommercialPossessionCandidateProof=Pick<DeviceRequestProofInput,"credentialId"|"timestamp"|"nonce">&{readonly signature:string};

/** D3 LAB V2 design vector, NOT a wire format, DPoP or authorization decision.
 * No production caller. Existing DeviceProof V1 bytes and header stay unchanged.
 * The digest fits the existing Service-custodied DeviceIdentity.signChallenge.
 * All context fields at verification must come from trusted registration,
 * verified token/session and verified DeviceCredential, never renderer claims. */
export function commercialPossessionCandidateChallenge(context:CommercialPossessionCandidateContext,
  freshness:Pick<DeviceRequestProofInput,"timestamp"|"nonce">):Buffer{
  const origin=new URL(context.origin);
  if(context.mode!=="ISOLATED_VALIDATION"||!Object.hasOwn(paths,context.operation)||origin.protocol!=="https:"||
    origin.origin!==context.origin||origin.username||origin.password||origin.search||origin.hash||
    ![context.audience,context.clientId].every(v=>typeof v==="string"&&v.length>0&&v.length<=128)||
    typeof context.token!=="string"||context.token.length<32||context.token.length>8192||
    typeof context.body!=="string"||Buffer.byteLength(context.body)>16384)throw Error("D3_LAB_POSSESSION_CONTEXT_REJECTED");
  for(const id of [context.tenantId,context.installationId,context.deviceId,context.credentialId])UuidSchema.parse(id);
  const request=deviceRequestProofBytes({method:"POST",path:paths[context.operation],requestId:context.requestId,
    correlationId:context.correlationId,body:context.body,credentialId:context.credentialId,timestamp:freshness.timestamp,nonce:freshness.nonce});
  return createHash("sha256").update("POS-COMMERCIAL-POSSESSION-LAB-V2\n").update(canonicalSessionTrustJson({
    origin:context.origin,audience:context.audience,client_id:context.clientId,
    tenant_id:context.tenantId,installation_id:context.installationId,device_id:context.deviceId,
    token_kind:context.operation==="REFRESH"?"REFRESH":"ACCESS",
    token_hash:createHash("sha256").update(context.token,"utf8").digest("hex"),request:request.toString("base64url"),
  })).digest();
}

/** Signature/freshness ONLY. Central must ALSO revalidate credential, session,
 * family binding and atomically consume nonce via canonical migration 012.
 * Returning true here cannot mint access, rotate refresh or confer grants. */
export function verifyCommercialPossessionCandidateSignature(proof:CommercialPossessionCandidateProof,
  expected:CommercialPossessionCandidateContext,publicKey:KeyObject,now:Date,maximumSkewMs:number):boolean{
  try{
    if(!Number.isSafeInteger(maximumSkewMs)||maximumSkewMs<=0||publicKey.type!=="public"||publicKey.asymmetricKeyType!=="ed25519"||
      proof.credentialId!==expected.credentialId||!/^[A-Za-z0-9_-]{86}$/.test(proof.signature)||
      !Number.isFinite(now.getTime())||!Number.isFinite(Date.parse(proof.timestamp))||
      Math.abs(now.getTime()-Date.parse(proof.timestamp))>maximumSkewMs)return false;
    return verify(null,commercialPossessionCandidateChallenge(expected,proof),publicKey,Buffer.from(proof.signature,"base64url"));
  }catch{return false;}
}
