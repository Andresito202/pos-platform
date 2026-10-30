import type {Socket} from "node:net";
import type {ContractVersionRange,WindowsScmHandoffProvision} from "@pos-platform/contracts";
import {LocalChannelClient} from "./client.js";
import {LocalChannelAuthenticator} from "./authenticator.js";
import {loadWindowsNativePipeAdapter,type WindowsPipeAdapter} from "./windows-native-pipe.js";
import {verifySignedWindowsHandoffCandidate,openWindowsHandoffCandidateForCurrentRecipient} from "./windows-handoff.js";

/** Only the existing signed capsule is prefixed; channel frames stay canonical. */
/**
 * Named pipes are byte streams, not message boundaries. The first channel
 * frame may arrive in the same data event as the signed capsule. Preserve
 * trailing bytes for LocalChannelClient rather than rejecting valid framing.
 */
export function decodeScmCapsulePrefix(bytes:Buffer):
  | {readonly complete:false}
  | {readonly complete:true;readonly capsule:unknown;readonly consumed:number}{
 if(bytes.length<4)return {complete:false};
 const length=bytes.readUInt32BE(0);
 if(length===0||length>32768)throw Error("SCM_HANDOFF_DELIVERY_REJECTED");
 if(bytes.length<4+length)return {complete:false};
 const capsule=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(4,4+length))) as unknown;
 return {complete:true,capsule,consumed:4+length};
}
function receiveCapsule(socket:Socket):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0);let settled=false;
  const timer=setTimeout(()=>fail(),5000);timer.unref();
  const cleanup=()=>{clearTimeout(timer);socket.off("data",data);socket.off("close",fail);socket.off("error",fail);};
  const fail=()=>{if(settled)return;settled=true;cleanup();socket.destroy();reject(Error("SCM_HANDOFF_DELIVERY_REJECTED"));};
  const data=(chunk:Buffer)=>{if(settled)return;try{
    if(bytes.length+chunk.length>65540){fail();return;}
    bytes=Buffer.concat([bytes,chunk]);
    const result=decodeScmCapsulePrefix(bytes);
    if(!result.complete)return;
    socket.pause();
    const remainder=bytes.subarray(result.consumed);
    if(remainder.length>0)socket.unshift(remainder);
    cleanup();settled=true;resolve(result.capsule);
  }catch{fail();}};
  socket.on("data",data);socket.once("close",fail);socket.once("error",fail);socket.resume();
 });
}
export async function connectWindowsScmClient(p:WindowsScmHandoffProvision,handshake:unknown,range:ContractVersionRange,
  dependencies?:{adapter:WindowsPipeAdapter;open:(capsule:unknown)=>Buffer}){
 if(p.role!=="DESKTOP"||!p.receiver_file)throw Error("SCM_DESKTOP_PROVISION_REQUIRED");
 const pipe=await (dependencies?.adapter??loadWindowsNativePipeAdapter(p)).connect();
 let authenticator:LocalChannelAuthenticator|undefined;
 try{
  pipe.recheck();const capsule=await receiveCapsule(pipe.socket),h=p.handoff;
  const verified=verifySignedWindowsHandoffCandidate(h,capsule,h.installation_id,h.device_id,new Date(),p.signer_public_key_pem,p.signer_spki_sha256);
  const secret=dependencies?dependencies.open(verified.capsule):openWindowsHandoffCandidateForCurrentRecipient(h,verified.capsule,p.receiver_file,h.installation_id,h.device_id);
  try{pipe.recheck();authenticator=new LocalChannelAuthenticator(secret);}finally{secret.fill(0);}
  const auth=authenticator;pipe.socket.once("close",()=>auth.destroy());
  const client=new LocalChannelClient("SCM_NATIVE_PIPE",auth,range,5000,64,async()=>pipe.socket);
  await client.connect(handshake);
  return {request:(input:unknown)=>{
    try{pipe.recheck();if(Date.now()<Date.parse(h.not_before)||Date.now()>=Date.parse(h.expires_at))throw Error("SCM_HANDOFF_EXPIRED");return client.request(input);}
    catch{pipe.socket.destroy();return Promise.reject(Error("SCM_CHANNEL_REJECTED"));}
  },close:async()=>{try{await client.close();}finally{auth.destroy();}}};
 }catch{pipe.socket.destroy();authenticator?.destroy();throw Error("SCM_CHANNEL_REJECTED");}
}
