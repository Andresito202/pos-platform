import { constants, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { win32 } from "node:path";
import * as z from "zod";
import { WindowsChannelHandoffSchema, type WindowsChannelHandoff } from "@pos-platform/contracts";
import { canonicalJson } from "./canonical-json.js";
import { currentHandoffIdentity, handoffNative, type WindowsHandoffIdentity } from "./windows-handoff-native.js";

const ReceiverSchema=z.strictObject({version:z.literal(1),installation_id:z.uuid(),device_id:z.uuid(),sid:z.string(),public_key_pem:z.string(),protected_private_key:z.string().min(1).max(16384)});
const CapsuleSchema=z.strictObject({version:z.literal(1),profile_sha256:z.string().regex(/^[a-f0-9]{64}$/),nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),ciphertext:z.string().regex(/^[A-Za-z0-9_-]+$/).max(2048)});
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const fail=():never=>{throw Error("WINDOWS_HANDOFF_REJECTED");};
function path(value:string):void{
  if(!win32.isAbsolute(value)||! /^[a-z]:\\/i.test(value)||value.slice(2).includes(":")||win32.normalize(value)!==value)fail();
}
export function validateWindowsHandoff(input:unknown,installationId:string,deviceId:string,now:Date):WindowsChannelHandoff{
  const p=WindowsChannelHandoffSchema.parse(input);
  path(p.capsule_file);
  if(p.installation_id!==installationId||p.device_id!==deviceId||!Number.isFinite(now.getTime())||now.getTime()<Date.parse(p.not_before)||now.getTime()>=Date.parse(p.expires_at))fail();
  const key=createPublicKey(p.recipient_public_key_pem);
  if(key.asymmetricKeyType!=="rsa"||(key.asymmetricKeyDetails?.modulusLength??0)<3072||key.asymmetricKeyDetails?.publicExponent!==65537n)fail();
  if(sha(key.export({type:"spki",format:"der"}))!==p.recipient_key_sha256)fail();
  return p;
}
export function handoffProfileHash(p:WindowsChannelHandoff):string{return sha(canonicalJson(p));}
function label(p:WindowsChannelHandoff,nonce:string):Buffer{return Buffer.from(canonicalJson({purpose:"CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",profile_sha256:handoffProfileHash(p),nonce}));}

/** Cryptographic primitive, not an authority: caller must have validated the
 * installer ACL and the service token before deriving or publishing anything. */
export function sealWindowsHandoff(p:WindowsChannelHandoff,master:Buffer):{capsule:string;secret:Buffer}{
  if(master.length!==32)fail();
  const nonce=randomBytes(32).toString("base64url");
  const context=label(p,nonce);
  const secret=createHmac("sha256",master).update(context).digest();
  try{
    const ciphertext=publicEncrypt({key:p.recipient_public_key_pem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256",oaepLabel:context},secret).toString("base64url");
    return {capsule:JSON.stringify({version:1,profile_sha256:handoffProfileHash(p),nonce,ciphertext}),secret};
  }catch{secret.fill(0);return fail();}
}
export function openWindowsHandoff(p:WindowsChannelHandoff,capsule:unknown,privateKey:Buffer):Buffer{
  const c=CapsuleSchema.parse(capsule);
  if(c.profile_sha256!==handoffProfileHash(p))fail();
  const key=createPrivateKey({key:privateKey,type:"pkcs8",format:"der"});
  const actual=sha(createPublicKey(key).export({type:"spki",format:"der"}));
  if(!timingSafeEqual(Buffer.from(actual,"hex"),Buffer.from(p.recipient_key_sha256,"hex")))fail();
  try{
    const secret=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256",oaepLabel:label(p,c.nonce)},Buffer.from(c.ciphertext,"base64url"));
    if(secret.length!==32){secret.fill(0);fail();}
    return secret;
  }catch{return fail();}
}
function context(installationId:string,deviceId:string,sid:string):string{return canonicalJson({purpose:"WINDOWS_HANDOFF_RECEIVER_V1",installationId,deviceId,sid});}
function interactive(identity:WindowsHandoffIdentity):void{if(!identity.interactive||identity.service||identity.sessionId<=0)fail();}
function publicEnrollment(installationId:string,deviceId:string,id:WindowsHandoffIdentity,publicKey:string):Readonly<Record<string,unknown>>{
  return {installation_id:installationId,device_id:deviceId,recipient_sid:id.sid,recipient_logon_sid:id.logonSid,recipient_session_id:id.sessionId,recipient_public_key_pem:publicKey,recipient_key_sha256:sha(createPublicKey(publicKey).export({format:"der",type:"spki"}))};
}

/** Explicit operator enrollment only. Existing files are NEVER overwritten.
 * Directory must already have a protected owner-only ACL. No login identity,
 * device credential, access token or Service master secret is created here. */
export function prepareWindowsHandoffReceiver(file:string,installationId:string,deviceId:string):Readonly<Record<string,unknown>>{
  path(file);z.uuid().parse(installationId);z.uuid().parse(deviceId);
  const id=currentHandoffIdentity();interactive(id);
  const pair=generateKeyPairSync("rsa",{modulusLength:3072,publicExponent:65537});
  const privateKey=pair.privateKey.export({format:"der",type:"pkcs8"});
  const publicKey=pair.publicKey.export({format:"pem",type:"spki"}).toString();
  try{
    const protectedKey=handoffNative({action:"protect-receiver",context:context(installationId,deviceId,id.sid),bytes:privateKey.toString("base64")});
    const value=ReceiverSchema.parse({version:1,installation_id:installationId,device_id:deviceId,sid:id.sid,public_key_pem:publicKey,protected_private_key:protectedKey});
    handoffNative({action:"write-receiver",path:file,content:JSON.stringify(value)});
    return publicEnrollment(installationId,deviceId,id,publicKey);
  }finally{privateKey.fill(0);}
}

/** Explicit recovery of PUBLIC metadata only. Revalidates DPAPI, file ACL and
 * public/private key correspondence without rotating or overwriting custody. */
export function recoverWindowsHandoffReceiverPublic(file:string,installationId:string,deviceId:string):Readonly<Record<string,unknown>>{
  path(file);z.uuid().parse(installationId);z.uuid().parse(deviceId);
  const id=currentHandoffIdentity();interactive(id);
  const r=ReceiverSchema.parse(JSON.parse(handoffNative({action:"read-receiver",path:file})));
  if(r.installation_id!==installationId||r.device_id!==deviceId||r.sid!==id.sid)fail();
  const key=Buffer.from(handoffNative({action:"open-receiver",path:file,context:context(installationId,deviceId,id.sid),bytes:r.protected_private_key}),"base64");
  try{
    const recovered=createPublicKey(createPrivateKey({key,format:"der",type:"pkcs8"}));
    if(recovered.asymmetricKeyType!=="rsa"||(recovered.asymmetricKeyDetails?.modulusLength??0)<3072)fail();
    const actual=recovered.export({format:"pem",type:"spki"}).toString();
    if(actual!==r.public_key_pem)fail();
    return publicEnrollment(installationId,deviceId,id,actual);
  }finally{key.fill(0);}
}
