import {createHash,verify,type KeyObject} from "node:crypto";
import {canonicalSessionTrustJson,UuidSchema} from "@pos-platform/contracts";
import {deviceRequestProofBytes,parseDeviceRequestAuthorization} from "./request-proof.js";

const paths={SESSION_ASSERTION:"/v1/business-session/assertions",AUTHORIZATION_SNAPSHOT:"/v1/business-session/authorization",REFRESH:"/v1/commercial/refresh",REVOKE:"/v1/commercial/revoke"} as const;
export interface CommercialPossessionContext{
  readonly operation:keyof typeof paths;readonly origin:string;readonly audience:string;readonly clientId:string;
  readonly tenantId:string;readonly installationId:string;readonly deviceId:string;readonly credentialId:string;
  readonly token:string;readonly requestId:string;readonly correlationId:string;readonly body:string;
}
/** Versioned proprietary proof, NOT DPoP. Token hash, recipient and exact
 * request are signed together; V1 and LAB signatures cannot verify here. */
export function commercialPossessionChallenge(c:CommercialPossessionContext,f:{timestamp:string;nonce:string}):Buffer{
  const origin=new URL(c.origin);
  if(origin.protocol!=="https:"||origin.origin!==c.origin||origin.username||origin.password)throw Error("COMMERCIAL_POSSESSION_ORIGIN_REJECTED");
  if(!Object.hasOwn(paths,c.operation)||![c.clientId,c.audience].every(v=>typeof v==="string"&&v.length>0&&v.length<=128)||
    typeof c.token!=="string"||c.token.length<32||c.token.length>8192||typeof c.body!=="string"||Buffer.byteLength(c.body)>16384)
    throw Error("COMMERCIAL_POSSESSION_CONTEXT_REJECTED");
  // Validate every binding UUID, not just the credential in the V1 primitive.
  for(const id of [c.tenantId,c.installationId,c.deviceId])UuidSchema.parse(id);
  const request=deviceRequestProofBytes({method:"POST",path:paths[c.operation],requestId:c.requestId,correlationId:c.correlationId,
    body:c.body,credentialId:c.credentialId,timestamp:f.timestamp,nonce:f.nonce});
  return createHash("sha256").update("POS-COMMERCIAL-POSSESSION-V2\n").update(canonicalSessionTrustJson({
    origin:c.origin,audience:c.audience,client_id:c.clientId,tenant_id:c.tenantId,installation_id:c.installationId,device_id:c.deviceId,
    token_kind:c.operation==="REFRESH"||c.operation==="REVOKE"?"REFRESH":"ACCESS",token_hash:createHash("sha256").update(c.token).digest("hex"),request:request.toString("base64url"),
  })).digest();
}
export function parseCommercialPossession(value:string){
  if(typeof value!=="string"||!value.startsWith("CommercialProofV2 "))return null;
  const p=parseDeviceRequestAuthorization("DeviceProof "+value.slice("CommercialProofV2 ".length));
  return p&&Buffer.from(p.signature,"base64url").toString("base64url")===p.signature?p:null;
}
export function verifyCommercialPossession(value:string,c:CommercialPossessionContext,key:KeyObject,now:Date,maximumSkewMs:number):boolean{
  try{
    const p=parseCommercialPossession(value);
    return !!p&&p.credentialId===c.credentialId&&key.type==="public"&&key.asymmetricKeyType==="ed25519"&&
      Number.isSafeInteger(maximumSkewMs)&&maximumSkewMs>0&&Number.isFinite(now.getTime())&&
      Math.abs(now.getTime()-Date.parse(p.timestamp))<=maximumSkewMs&&
      verify(null,commercialPossessionChallenge(c,p),key,Buffer.from(p.signature,"base64url"));
  }catch{return false;}
}
