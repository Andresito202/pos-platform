import {z} from "zod";
import {validateNativeClientRegistration,type NativeClientRegistration} from "./native-authorization-constraints.js";

const ascii=z.string().regex(/^[\x20-\x7E]+$/);
const Code=z.string().regex(/^[A-Za-z0-9._~-]{16,512}$/);
const Verifier=z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const State=z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
const ClientId=z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/);
const Redirect=z.string().url().max(2048);
const StrictTokenRequest=z.strictObject({
  grant_type:z.literal("authorization_code"),
  code:Code,code_verifier:Verifier,state:State,
  client_id:ClientId,redirect_uri:Redirect,
});
export type CommercialTokenRequest=z.infer<typeof StrictTokenRequest>;
export type CommercialTransportResult=
  |{readonly status:200;readonly request:CommercialTokenRequest;readonly registration:NativeClientRegistration}
  |{readonly status:400|403|413|415;readonly error:"invalid_request"|"unauthorized_client"|"unsupported_media_type"};

export const COMMERCIAL_MAX_BODY_BYTES=4096;

/**
 * Strict boundary validation only. Never consumes codes, trusts arbitrary
 * session/device IDs, or acts as an HTTP token issuer.
 */
export function inspectCommercialTokenRequest(input:{
  method:string;contentType:string|null;body:string;registration:NativeClientRegistration;
}):CommercialTransportResult {
  if(input.method!=="POST")return {status:400,error:"invalid_request"};
  if(input.contentType!=="application/json")return {status:415,error:"unsupported_media_type"};
  if(Buffer.byteLength(input.body,"utf8")>COMMERCIAL_MAX_BODY_BYTES)return {status:413,error:"invalid_request"};
  let candidate:unknown;
  try{candidate=JSON.parse(input.body);}catch{return {status:400,error:"invalid_request"};}
  const parsed=StrictTokenRequest.safeParse(candidate);
  if(!parsed.success)return {status:400,error:"invalid_request"};
  let registered:NativeClientRegistration;
  try{registered=validateNativeClientRegistration(input.registration);}
  catch{return {status:403,error:"unauthorized_client"};}
  if(parsed.data.client_id!==registered.clientId||parsed.data.redirect_uri!==registered.redirectUri)
    return {status:403,error:"unauthorized_client"};
  return {status:200,request:parsed.data,registration:registered};
}
