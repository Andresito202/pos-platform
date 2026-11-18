import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync} from "node:crypto";
import {win32} from "node:path";
import * as z from "zod";
import {canonicalJson} from "./canonical-json.js";
import {currentHandoffIdentity,handoffNative} from "./windows-handoff-native.js";
const schema=z.strictObject({version:z.literal(1),installation_id:z.uuid(),device_id:z.uuid(),service_sid:z.string(),public_key_pem:z.string().max(4096),protected_private_key:z.string().min(1).max(16384)});
const pin=(key:string)=>createHash("sha256").update(createPublicKey(key).export({type:"spki",format:"der"})).digest("hex");
function identity(){const id=currentHandoffIdentity();if(!id.service||id.interactive||id.sessionId!==0)throw Error("SCM_SIGNER_IDENTITY_REQUIRED");return id;}
function path(file:string){if(!/^[A-Za-z]:\\/.test(file)||!win32.isAbsolute(file)||win32.normalize(file)!==file||file.slice(2).includes(":"))throw Error("SCM_SIGNER_PATH_REJECTED");}
const context=(installationId:string,deviceId:string,serviceSid:string)=>canonicalJson({purpose:"WINDOWS_SERVICE_SIGNER_V1",installationId,deviceId,serviceSid});
/** Explicit installer operation under the Service identity; NEVER auto-rotate. */
export function prepareWindowsServiceSigner(file:string,installationId:string,deviceId:string){
 path(file);z.uuid().parse(installationId);z.uuid().parse(deviceId);const id=identity(),pair=generateKeyPairSync("ed25519");
 const secret=pair.privateKey.export({type:"pkcs8",format:"der"}),publicKey=pair.publicKey.export({type:"spki",format:"pem"}).toString();
 try{
  const encrypted=handoffNative({action:"protect-service-signer",path:file,context:context(installationId,deviceId,id.sid),bytes:secret.toString("base64")});
  handoffNative({action:"write-service-signer",path:file,content:JSON.stringify(schema.parse({version:1,installation_id:installationId,device_id:deviceId,service_sid:id.sid,public_key_pem:publicKey,protected_private_key:encrypted}))});
  return {public_key_pem:publicKey,spki_sha256:pin(publicKey),service_sid:id.sid};
 }finally{secret.fill(0);}
}
/** Read-only recovery, pinned independently by the installer-owned provision. */
export function withWindowsServiceSigner<T>(file:string,installationId:string,deviceId:string,expectedPublic:string,expectedPin:string,use:(der:Buffer)=>T):T{
 path(file);const id=identity(),r=schema.parse(JSON.parse(handoffNative({action:"read-service-signer",path:file})));
 if(r.installation_id!==installationId||r.device_id!==deviceId||r.service_sid!==id.sid||pin(expectedPublic)!==expectedPin||pin(r.public_key_pem)!==expectedPin)throw Error("SCM_SIGNER_PIN_REJECTED");
 const der=Buffer.from(handoffNative({action:"open-service-signer",path:file,context:context(installationId,deviceId,id.sid),bytes:r.protected_private_key}),"base64");
 try{const key=createPrivateKey({key:der,type:"pkcs8",format:"der"});if(key.asymmetricKeyType!=="ed25519"||pin(createPublicKey(key).export({type:"spki",format:"pem"}).toString())!==expectedPin)throw Error("SCM_SIGNER_KEY_REJECTED");return use(der);}finally{der.fill(0);}
}

/** Explicit public enrollment recovery; does not rotate or export the secret. */
export function recoverWindowsServiceSignerPublic(file:string,installationId:string,deviceId:string){
 path(file);const id=identity(),r=schema.parse(JSON.parse(handoffNative({action:"read-service-signer",path:file})));
 const publicKey=r.public_key_pem,spki=pin(publicKey);
 return withWindowsServiceSigner(file,installationId,deviceId,publicKey,spki,()=>({public_key_pem:publicKey,spki_sha256:spki,service_sid:id.sid}));
}
