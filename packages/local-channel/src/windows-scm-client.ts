import type {Socket} from "node:net";
import type {ContractVersionRange,WindowsScmHandoffProvision} from "@pos-platform/contracts";
import {LocalChannelClient} from "./client.js";
import {LocalChannelAuthenticator} from "./authenticator.js";
import {loadWindowsNativePipeAdapter,type WindowsPipeAdapter} from "./windows-native-pipe.js";
import {verifySignedWindowsHandoffCandidate,openWindowsHandoffCandidateForCurrentRecipient} from "./windows-handoff.js";

/** Only the existing signed capsule is prefixed; channel frames stay canonical. */
function receiveCapsule(socket:Socket):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0);const timer=setTimeout(()=>fail(),5000);timer.unref();
  const cleanup=()=>{clearTimeout(timer);socket.off("data",data);socket.off("close",fail);socket.off("error",fail);};
  const fail=()=>{cleanup();socket.destroy();reject(Error("SCM_HANDOFF_DELIVERY_REJECTED"));};
  const data=(chunk:Buffer)=>{try{
    if(bytes.length+chunk.length>32772){fail();return;}bytes=Buffer.concat([bytes,chunk]);
    if(bytes.length<4)return;const n=bytes.readUInt32BE();if(n===0||n>32768){fail();return;}
    if(bytes.length<4+n)return;if(bytes.length!==4+n){fail();return;}
    const capsule=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(4)));
    socket.pause();cleanup();resolve(capsule);
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
