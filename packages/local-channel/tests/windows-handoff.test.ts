import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { WindowsChannelHandoffSchema, type WindowsChannelHandoff } from "@pos-platform/contracts";
import { canonicalJson } from "../src/canonical-json.js";
import { LocalChannelAuthenticator } from "../src/authenticator.js";
import { prepareWindowsHandoffReceiver, recoverWindowsHandoffReceiverPublic, openWindowsHandoff, sealWindowsHandoff, validateWindowsHandoff } from "../src/windows-handoff.js";
import { currentHandoffIdentity, handoffNative } from "../src/windows-handoff-native.js";

const installation="018f0000-0000-7000-8000-000000000001";
const device="018f0000-0000-7000-8000-000000000002";
const at=new Date("2026-10-29T12:00:00Z");
let p:WindowsChannelHandoff;
let privateKey:Buffer;
afterAll(()=>privateKey?.fill(0));
beforeAll(()=>{
  const pair=generateKeyPairSync("rsa",{modulusLength:3072});
  privateKey=pair.privateKey.export({format:"der",type:"pkcs8"});
  p={profile:"CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",service_id:"CamachoPOSLocalService",service_sid:"S-1-5-80-1-2-3-4-5",installation_id:installation,device_id:device,
    recipient_sid:"S-1-5-21-1-2-3-1001",recipient_logon_sid:"S-1-5-5-1-2",recipient_session_id:1,
    recipient_public_key_pem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),recipient_key_sha256:createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex"),
    capsule_file:"C:\\ProgramData\\CamachoPOS\\handoff\\capsule.json",not_before:"2026-10-29T11:59:00Z",expires_at:"2026-10-29T12:01:00Z",revision:1,poll_ms:1000,policy_reference:"TEST_ONLY_NOT_OPERATIONAL"};
});

describe("candidate handoff cryptography (not SCM interoperability)",()=>{
 it("validates the exact installation, device, pinned RSA key and explicit policy",()=>{
   expect(validateWindowsHandoff(p,installation,device,at).revision).toBe(1);
   expect(WindowsChannelHandoffSchema.safeParse({...p,arbitrary:true}).success).toBe(false);
   expect(WindowsChannelHandoffSchema.safeParse({...p,policy_reference:""}).success).toBe(false);
   expect(WindowsChannelHandoffSchema.safeParse({...p,poll_ms:undefined}).success).toBe(false);
 });
 it.each([
   {device_id:installation},{installation_id:device},{recipient_key_sha256:"0".repeat(64)},
   {expires_at:at.toISOString()},{not_before:"2026-10-29T12:00:01Z"},{capsule_file:"\\\\remote\\capsule"},
   {recipient_sid:"S-1-1-0"},{recipient_logon_sid:"S-1-5-32-545"},{recipient_session_id:0},
 ])("rejects altered or unauthorized profile %j",change=>{
   expect(()=>validateWindowsHandoff({...p,...change},installation,device,at)).toThrow();
 });
 it("rejects RSA below the candidate strength even with a matching pin",()=>{
   const key=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey;
   expect(()=>validateWindowsHandoff({...p,recipient_public_key_pem:key.export({type:"spki",format:"pem"}).toString(),recipient_key_sha256:createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex")},installation,device,at)).toThrow();
 });
 it("seals only a derived key, binding all claims to OAEP-SHA256",()=>{
   const master=randomBytes(32),sealed=sealWindowsHandoff(p,master);
   const recovered=openWindowsHandoff(p,JSON.parse(sealed.capsule),privateKey);
   try{expect(recovered.equals(sealed.secret)).toBe(true);expect(recovered.equals(master)).toBe(false);expect(sealed.capsule.includes(master.toString("base64url"))).toBe(false);}
   finally{master.fill(0);sealed.secret.fill(0);recovered.fill(0);}
 });
 it.each(["recipient_logon_sid","device_id","revision","expires_at"] as const)("rejects capsule replay under another %s",field=>{
   const master=randomBytes(32),sealed=sealWindowsHandoff(p,master);
   const changes={recipient_logon_sid:"S-1-5-5-1-3",device_id:installation,revision:2,expires_at:"2026-10-29T12:02:00Z"};
   try{expect(()=>openWindowsHandoff({...p,[field]:changes[field]},JSON.parse(sealed.capsule),privateKey)).toThrow();}
   finally{master.fill(0);sealed.secret.fill(0);}
 });
 it("rejects ciphertext and nonce tampering and a different receiver key",()=>{
   const master=randomBytes(32),sealed=sealWindowsHandoff(p,master),capsule=JSON.parse(sealed.capsule);
   const other=generateKeyPairSync("rsa",{modulusLength:3072}).privateKey.export({type:"pkcs8",format:"der"});
   try{
     expect(()=>openWindowsHandoff(p,{...capsule,nonce:randomBytes(32).toString("base64url")},privateKey)).toThrow();
     expect(()=>openWindowsHandoff(p,{...capsule,ciphertext:randomBytes(384).toString("base64url")},privateKey)).toThrow();
     expect(()=>openWindowsHandoff(p,capsule,other)).toThrow();
   }finally{master.fill(0);sealed.secret.fill(0);other.fill(0);}
 });
 it("rotates lease keys without changing the master and rejects old frames",()=>{
   const master=randomBytes(32),original=Buffer.from(master),one=sealWindowsHandoff(p,master),two=sealWindowsHandoff(p,master);
   const old=new LocalChannelAuthenticator(one.secret),current=new LocalChannelAuthenticator(two.secret);
   try{expect(master.equals(original)).toBe(true);expect(one.secret.equals(two.secret)).toBe(false);expect(()=>current.verify(old.sign({test:true},"1.0.0"))).toThrow("MAC rejected");}
   finally{master.fill(0);original.fill(0);one.secret.fill(0);two.secret.fill(0);old.destroy();current.destroy();}
 });
});

const windowsIt=process.platform==="win32"?it:it.skip;
windowsIt("real Windows receiver: owner-only ACL, DPAPI CurrentUser, no overwrite, wrong context and tampering denied",()=>{
 const dir=mkdtempSync(join(tmpdir(),"pos-handoff-receiver-")),file=join(dir,"receiver.json");
 // Fixture-only ACL. Never edits an operational directory or Windows account.
 const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",String.raw`
 $ErrorActionPreference='Stop';$p=[Console]::In.ReadToEnd();$u=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $a=New-Object Security.AccessControl.DirectorySecurity;$a.SetOwner($u);$a.SetAccessRuleProtection($true,$false)
 [void]$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($u,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
 [IO.Directory]::SetAccessControl($p,$a)
 `],{input:dir,encoding:"utf8",windowsHide:true});
 try{
   expect(result.status).toBe(0);
   const enrollment=prepareWindowsHandoffReceiver(file,installation,device);
   const identity=currentHandoffIdentity();
   expect(enrollment.recipient_sid===identity.sid).toBe(true);
   const saved=readFileSync(file,"utf8"),stored=JSON.parse(handoffNative({action:"read-receiver",path:file}));
   expect(saved.includes("PRIVATE KEY")).toBe(false);
   expect(()=>prepareWindowsHandoffReceiver(file,installation,device)).toThrow("HANDOFF_NATIVE_REJECTED");
   expect(readFileSync(file,"utf8")===saved).toBe(true);
   const recoveredPublic=recoverWindowsHandoffReceiverPublic(file,installation,device);
   expect(recoveredPublic.recipient_key_sha256===enrollment.recipient_key_sha256).toBe(true);
   expect(readFileSync(file,"utf8")===saved).toBe(true);
   const context=canonicalJson({purpose:"WINDOWS_HANDOFF_RECEIVER_V1",installationId:installation,deviceId:device,sid:identity.sid});
   const key=Buffer.from(handoffNative({action:"open-receiver",path:file,context,bytes:stored.protected_private_key}),"base64");
   try{
     const profile={...p,...enrollment};
     const valid=validateWindowsHandoff(profile,installation,device,at);
     const master=randomBytes(32),sealed=sealWindowsHandoff(valid,master),opened=openWindowsHandoff(valid,JSON.parse(sealed.capsule),key);
     try{expect(opened.equals(sealed.secret)).toBe(true);}finally{master.fill(0);sealed.secret.fill(0);opened.fill(0);}
   }finally{key.fill(0);}
   expect(()=>handoffNative({action:"open-receiver",path:file,context:context+"altered",bytes:stored.protected_private_key})).toThrow("HANDOFF_NATIVE_REJECTED");
   const bytes=Buffer.from(stored.protected_private_key,"base64");bytes[bytes.length-1]=bytes[bytes.length-1]!^1;
   expect(()=>handoffNative({action:"open-receiver",path:file,context,bytes:bytes.toString("base64")})).toThrow("HANDOFF_NATIVE_REJECTED");bytes.fill(0);
   expect(()=>handoffNative({action:"arbitrary-sign",path:file})).toThrow("HANDOFF_NATIVE_REJECTED");
 }finally{
   if(!dir.startsWith(join(tmpdir(),"pos-handoff-receiver-")))throw Error("TEST_PATH_REJECTED");
   rmSync(dir,{recursive:true,force:true});
 }
},60000);

windowsIt("real Windows receiver rejects inherited directory ACL before writing",()=>{
 const dir=mkdtempSync(join(tmpdir(),"pos-handoff-denied-")),file=join(dir,"receiver.json");
 try{expect(()=>prepareWindowsHandoffReceiver(file,installation,device)).toThrow("HANDOFF_NATIVE_REJECTED");}
 finally{if(!dir.startsWith(join(tmpdir(),"pos-handoff-denied-")))throw Error("TEST_PATH_REJECTED");rmSync(dir,{recursive:true,force:true});}
},30000);
