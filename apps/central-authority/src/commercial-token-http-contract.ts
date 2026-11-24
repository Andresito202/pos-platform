import {validateNativeClientRegistration,type NativeClientRegistration} from "./native-authorization-constraints.js";

export type CommercialTokenRequest={
  readonly grant_type:"authorization_code";readonly code:string;
  readonly code_verifier:string;readonly state:string;
  readonly client_id:string;readonly redirect_uri:string;
};
export type CommercialTransportResult=
  |{readonly status:200;readonly request:CommercialTokenRequest;readonly registration:NativeClientRegistration}
  |{readonly status:400|403|413|415;readonly error:"invalid_request"|"unauthorized_client"|"unsupported_media_type"};

export const COMMERCIAL_MAX_BODY_BYTES=4096;
const keys=["grant_type","code","code_verifier","state","client_id","redirect_uri"] as const;
/**
 * Strict boundary validation only. No code consumption or credential delivery.
 * Never treats user/device/session identifiers as authenticated material.
 */
export function inspectCommercialTokenRequest(input:{
  method:string;contentType:string|null;body:string;registration:NativeClientRegistration;
}):CommercialTransportResult {
  if(input.method!=="POST")return {status:400,error:"invalid_request"};
  if(input.contentType!=="application/json")return {status:415,error:"unsupported_media_type"};
  if(Buffer.byteLength(input.body,"utf8")>COMMERCIAL_MAX_BODY_BYTES)return {status:413,error:"invalid_request"};
  let candidate:unknown;
  try{candidate=JSON.parse(input.body);}catch{return {status:400,error:"invalid_request"};}
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return {status:400,error:"invalid_request"};
  const obj=candidate as Record<string,unknown>;
  if(Object.keys(obj).length!==keys.length||keys.some(key=>!Object.hasOwn(obj,key)))
    return {status:400,error:"invalid_request"};
  if(obj.grant_type!=="authorization_code"||
     typeof obj.code!=="string"||!/^[A-Za-z0-9._~-]{16,512}$/.test(obj.code)||
     typeof obj.code_verifier!=="string"||!/^[A-Za-z0-9._~-]{43,128}$/.test(obj.code_verifier)||
     typeof obj.state!=="string"||!/^[A-Za-z0-9_-]{32,256}$/.test(obj.state)||
     typeof obj.client_id!=="string"||!/^[A-Za-z0-9._~-]{1,128}$/.test(obj.client_id)||
     typeof obj.redirect_uri!=="string"||obj.redirect_uri.length>2048)
    return {status:400,error:"invalid_request"};
  let registered:NativeClientRegistration;
  try{registered=validateNativeClientRegistration(input.registration);}
  catch{return {status:403,error:"unauthorized_client"};}
  if(obj.client_id!==registered.clientId||obj.redirect_uri!==registered.redirectUri)
    return {status:403,error:"unauthorized_client"};
  return {status:200,registration:registered,request:{
    grant_type:"authorization_code",code:obj.code,code_verifier:obj.code_verifier,
    state:obj.state,client_id:obj.client_id,redirect_uri:obj.redirect_uri,
  }};
}
