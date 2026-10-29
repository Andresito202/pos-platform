import { constants, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, sign, timingSafeEqual, verify } from "node:crypto";
import { win32 } from "node:path";
import * as z from "zod";
import { WindowsChannelHandoffSchema, type WindowsChannelHandoff } from "@pos-platform/contracts";
import { canonicalJson } from "./canonical-json.js";
import { currentHandoffIdentity, handoffNative, type WindowsHandoffIdentity } from "./windows-handoff-native.js";
import type { LocalChannelReplayStateStore } from "./replay-state.js";

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
/**
 * Check the actual Windows recipient token independently of the encrypted
 * capsule. DPAPI CurrentUser alone does not distinguish logon sessions.
 * No environment-supplied SID or claimed session is accepted as identity.
 *
 * This does NOT establish capsule origin authenticity or make SCM ready.
 */
export function validateWindowsHandoffRecipient(
  input:unknown,
  installationId:string,
  deviceId:string,
  now:Date,
  identity:WindowsHandoffIdentity,
):WindowsChannelHandoff {
  const p=validateWindowsHandoff(input,installationId,deviceId,now);
  interactive(identity);
  if(identity.sid!==p.recipient_sid||
    identity.logonSid!==p.recipient_logon_sid||
    identity.sessionId!==p.recipient_session_id)fail();
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

/**
 * Candidate-only receiver path: uses the CURRENT OS token and actual clock,
 * verifies receiver-file custody and key pin, then decrypts the lease.
 *
 * Intentionally not connected to Electron/SCM. Authentic service publication,
 * a one-use/revocable lease, and a restricted cross-logon pipe are still
 * mandatory before this value can authorize a production channel.
 */
export function openWindowsHandoffCandidateForCurrentRecipient(
  profile:unknown,
  capsule:unknown,
  receiverFile:string,
  installationId:string,
  deviceId:string,
):Buffer {
  path(receiverFile);
  const identity=currentHandoffIdentity();
  const p=validateWindowsHandoffRecipient(profile,installationId,deviceId,new Date(),identity);
  const r=ReceiverSchema.parse(JSON.parse(handoffNative({action:"read-receiver",path:receiverFile})));
  if(r.installation_id!==installationId||
    r.device_id!==deviceId||
    r.sid!==identity.sid||
    sha(createPublicKey(r.public_key_pem).export({type:"spki",format:"der"}))!==p.recipient_key_sha256)fail();
  const secretKey=Buffer.from(handoffNative({
    action:"open-receiver",
    path:receiverFile,
    context:context(installationId,deviceId,identity.sid),
    bytes:r.protected_private_key,
  }),"base64");
  try{
    const material=createPrivateKey({key:secretKey,type:"pkcs8",format:"der"});
    if(sha(createPublicKey(material).export({type:"spki",format:"der"}))!==p.recipient_key_sha256)fail();
    return openWindowsHandoff(p,capsule,secretKey);
  }finally{secretKey.fill(0);}
}


/**
 * Authentication layer for the existing candidate handoff capsule.
 *
 * RSA-OAEP supplies confidentiality, NOT issuer authentication. This envelope
 * additionally requires an Ed25519 signature from the installer-pinned Service
 * signer, verified without trusting any public key carried by the capsule.
 * The signer must be provisioned under Service-owned DPAPI custody; this
 * module NEVER provisions or stores its private key.
 *
 * No SCM/pipe activation follows from these primitives.
 */
const SignedHandoffSchema=z.strictObject({
  version:z.literal(2),
  capsule:CapsuleSchema,
  signed_at:z.iso.datetime(),
  signing_key_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type SignedWindowsHandoffCapsule=z.infer<typeof SignedHandoffSchema>;

function signingPayload(
  p:WindowsChannelHandoff,
  capsule:z.infer<typeof CapsuleSchema>,
  signedAt:string,
  signingKeySha256:string,
):Buffer{
  return Buffer.from(canonicalJson({
    purpose:"CAMACHO_WINDOWS_CHANNEL_HANDOFF_SIGNED_CANDIDATE_V2",
    profile_sha256:handoffProfileHash(p),
    capsule,
    signed_at:signedAt,
    signing_key_sha256:signingKeySha256,
    service_sid:p.service_sid,
  }),"utf8");
}
function pinnedServiceSigner(publicKeyPem:string,pinnedSha256:string){
  if(!/^[a-f0-9]{64}$/.test(pinnedSha256))fail();
  const key=createPublicKey(publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")fail();
  const fingerprint=sha(key.export({type:"spki",format:"der"}));
  if(!timingSafeEqual(Buffer.from(fingerprint,"hex"),Buffer.from(pinnedSha256,"hex")))fail();
  return key;
}
export function assertWindowsHandoffIssuer(p:WindowsChannelHandoff,id:WindowsHandoffIdentity):void{
  if(!id.service||id.interactive||id.sid!==p.service_sid||id.sessionId!==0)fail();
}

/** Pure candidate seal for isolated tests; do not use as a host attestation. */
export function sealSignedWindowsHandoffCandidate(
  p:WindowsChannelHandoff,
  master:Buffer,
  signerPrivateDer:Buffer,
  approvedServiceSignerPublicPem:string,
  pinnedServiceSignerSha256:string,
  now:Date,
  serviceIdentity:WindowsHandoffIdentity,
):{capsule:string;secret:Buffer}{
  validateWindowsHandoff(p,p.installation_id,p.device_id,now);
  assertWindowsHandoffIssuer(p,serviceIdentity);
  const publicKey=pinnedServiceSigner(approvedServiceSignerPublicPem,pinnedServiceSignerSha256);
  const key=createPrivateKey({key:signerPrivateDer,format:"der",type:"pkcs8"});
  if(key.asymmetricKeyType!=="ed25519"||
    sha(createPublicKey(key).export({type:"spki",format:"der"}))!==sha(publicKey.export({type:"spki",format:"der"})))fail();
  const sealed=sealWindowsHandoff(p,master);
  try{
    const original=CapsuleSchema.parse(JSON.parse(sealed.capsule));
    const issuedAt=now.toISOString();
    const signature=sign(null,signingPayload(p,original,issuedAt,pinnedServiceSignerSha256),key).toString("base64url");
    return {secret:sealed.secret,capsule:JSON.stringify(SignedHandoffSchema.parse({
      version:2,capsule:original,signed_at:issuedAt,signing_key_sha256:pinnedServiceSignerSha256,signature,
    }))};
  }catch{
    sealed.secret.fill(0);return fail();
  }
}

/** Only actual SCM service token can issue from this Windows entry point. */
export function sealSignedWindowsHandoffForCurrentService(
  p:WindowsChannelHandoff,master:Buffer,signerPrivateDer:Buffer,
  approvedServiceSignerPublicPem:string,pinnedServiceSignerSha256:string,
):{capsule:string;secret:Buffer}{
  return sealSignedWindowsHandoffCandidate(p,master,signerPrivateDer,
    approvedServiceSignerPublicPem,pinnedServiceSignerSha256,new Date(),currentHandoffIdentity());
}

/** Reject unauthenticated, expired, modified and wrongly pinned handoffs. */
export function verifySignedWindowsHandoffCandidate(
  profile:unknown,
  input:unknown,
  installationId:string,
  deviceId:string,
  now:Date,
  approvedServiceSignerPublicPem:string,
  pinnedServiceSignerSha256:string,
):{profile:WindowsChannelHandoff;capsule:z.infer<typeof CapsuleSchema>;leaseId:string}{
  const p=validateWindowsHandoff(profile,installationId,deviceId,now);
  const signed=SignedHandoffSchema.parse(input);
  const publicKey=pinnedServiceSigner(approvedServiceSignerPublicPem,pinnedServiceSignerSha256);
  if(signed.signing_key_sha256!==pinnedServiceSignerSha256||
     signed.capsule.profile_sha256!==handoffProfileHash(p))fail();
  const issuance=Date.parse(signed.signed_at);
  if(!Number.isFinite(issuance)||issuance<Date.parse(p.not_before)||
     issuance>=Date.parse(p.expires_at)||issuance>now.getTime())fail();
  const signature=Buffer.from(signed.signature,"base64url");
  if(signature.length!==64||signature.toString("base64url")!==signed.signature||
     !verify(null,signingPayload(p,signed.capsule,signed.signed_at,pinnedServiceSignerSha256),publicKey,signature))fail();
  return {profile:p,capsule:signed.capsule,
    leaseId:sha(canonicalJson({purpose:"WINDOWS_HANDOFF_LEASE_V2",
      profile_hash:handoffProfileHash(p),nonce:signed.capsule.nonce,
      signing_key_sha256:pinnedServiceSignerSha256}))};
}

/**
 * The canonical SQLite replay table requires a 36-character UUID session_id.
 * Derive a deterministic, domain-separated RFC-4122 version-4-shaped UUID from
 * the signed lease digest; do NOT change the existing table or channel schema.
 */
export function windowsHandoffReplaySessionId(leaseId:string):string{
  if(!/^[0-9a-f]{64}$/.test(leaseId))fail();
  const digest=createHash("sha256").update("WINDOWS_HANDOFF_REPLAY_UUID_V1:").update(leaseId).digest();
  digest[6]=(digest[6]!&0x0f)|0x40;
  digest[8]=(digest[8]!&0x3f)|0x80;
  const h=digest.subarray(0,16).toString("hex");
  digest.fill(0);
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20,32)].join("-");
}

export interface WindowsHandoffRevocationAuthority {
  /** Must read trusted current installer/Service policy, never client claims. */
  assertActive(input:Readonly<{
    leaseId:string;revision:number;serviceSid:string;
    recipientSid:string;recipientLogonSid:string;expiresAt:string;
  }>):void;
}

/**
 * This candidate composes signed issuer authenticity + current OS receiver
 * identity + mandatory revocation authority + one-use replay ledger.
 * The ledger must be durably implemented by the authorized host: using a
 * memory store in a test does NOT certify restart-safe consumption.
 * In particular no Electron, Service or SCM boot path calls this function yet.
 */
export function consumeSignedWindowsHandoffForCurrentRecipient(
  profile:unknown,input:unknown,receiverFile:string,
  installationId:string,deviceId:string,
  approvedServiceSignerPublicPem:string,pinnedServiceSignerSha256:string,
  replay:LocalChannelReplayStateStore,
  revocation:WindowsHandoffRevocationAuthority,
):Buffer{
  if(!replay||typeof replay.accept!=="function"||
     !revocation||typeof revocation.assertActive!=="function")fail();
  const now=new Date();
  const v=verifySignedWindowsHandoffCandidate(profile,input,installationId,deviceId,now,
    approvedServiceSignerPublicPem,pinnedServiceSignerSha256);
  const id=currentHandoffIdentity();
  validateWindowsHandoffRecipient(v.profile,installationId,deviceId,now,id);
  revocation.assertActive({leaseId:v.leaseId,revision:v.profile.revision,
    serviceSid:v.profile.service_sid,recipientSid:id.sid,
    recipientLogonSid:id.logonSid,expiresAt:v.profile.expires_at});
  const secret=openWindowsHandoffCandidateForCurrentRecipient(v.profile,v.capsule,
    receiverFile,installationId,deviceId);
  try{
    replay.accept({sessionId:windowsHandoffReplaySessionId(v.leaseId),sequence:1,
      evaluatedAt:new Date().toISOString(),expiresAt:v.profile.expires_at});
    return secret;
  }catch{
    secret.fill(0);return fail();
  }
}
