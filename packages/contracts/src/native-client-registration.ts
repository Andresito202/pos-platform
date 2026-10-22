/** Server-owned registration metadata, never proof of a user or device. */
export interface NativeClientRegistration {
  readonly clientId:string;
  readonly redirectUri:string;
  readonly authorizationOrigin:string;
  readonly platform?:"ELECTRON"|"ANDROID";
  readonly androidPackageId?:string;
  readonly androidSigningCertificateSha256?:string;
}

/** Exact callbacks only. Domain association and deployment approval are separate
 * evidence; an Android URL or this descriptor alone cannot activate a client. */
export function validateNativeClientRegistration(value:NativeClientRegistration):NativeClientRegistration{
  if(!value||typeof value.clientId!=="string"||typeof value.redirectUri!=="string"||typeof value.authorizationOrigin!=="string"||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(value.clientId))throw Error("NATIVE_CLIENT_REGISTRATION_INVALID");
  let origin:URL;
  try{origin=new URL(value.authorizationOrigin);}catch{throw Error("NATIVE_AUTHORIZATION_ORIGIN_INVALID");}
  if(origin.protocol!=="https:"||!origin.hostname||origin.username||origin.password||origin.pathname!=="/"||
    origin.search||origin.hash||origin.origin!==value.authorizationOrigin||origin.hostname==="localhost"||
    origin.hostname.endsWith(".localhost")||origin.hostname==="127.0.0.1")throw Error("NATIVE_AUTHORIZATION_ORIGIN_INVALID");
  let redirect:URL;
  try{redirect=new URL(value.redirectUri);}catch{throw Error("NATIVE_CLIENT_REGISTRATION_INVALID");}
  if(redirect.href!==value.redirectUri||redirect.username||redirect.password||redirect.search||redirect.hash)throw Error("NATIVE_CLIENT_REGISTRATION_INVALID");
  if(value.platform==="ANDROID"){
    if(redirect.protocol!=="https:"||redirect.origin!==origin.origin||redirect.pathname!=="/android/callback"||
      !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value.androidPackageId??"")||
      !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value.androidSigningCertificateSha256??""))throw Error("NATIVE_ANDROID_REGISTRATION_INVALID");
    return Object.freeze({...value});
  }
  if(value.platform!==undefined&&value.platform!=="ELECTRON"||value.androidPackageId!==undefined||value.androidSigningCertificateSha256!==undefined||
    redirect.protocol!=="http:"||redirect.hostname!=="127.0.0.1"||!redirect.port||Number(redirect.port)<1||Number(redirect.port)>65535||redirect.pathname!=="/callback")throw Error("NATIVE_CLIENT_REGISTRATION_INVALID");
  return Object.freeze({clientId:value.clientId,redirectUri:value.redirectUri,authorizationOrigin:value.authorizationOrigin,...(value.platform?{platform:value.platform}:{})});
}
