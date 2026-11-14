import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {Socket} from "node:net";
import {win32} from "node:path";
import * as z from "zod";
import {WindowsScmHandoffProvisionSchema,type WindowsScmHandoffProvision} from "@pos-platform/contracts";
import {handoffNative} from "./windows-handoff-native.js";

export interface NativePipeRecord {readonly fd:number;readonly handle:unknown;readonly peer:{sid:string;logonSid:string;sessionId:number;pid:number;creationTime:string};}
export interface NativePipeBinding {
 listen(endpoint:string,service:string,recipient:string,logon:string,session:number):unknown;
 accept(listener:unknown,timeout:number):Promise<NativePipeRecord>;
 connect(endpoint:string,service:string,recipient:string,logon:string,session:number,timeout:number):Promise<NativePipeRecord>;
 adopt(handle:unknown):void;release(handle:unknown):void;recheck(handle:unknown):void;stop(listener:unknown):void;
}
export interface AttestedWindowsPipe {readonly socket:Socket;readonly peer:NativePipeRecord["peer"];recheck():void;}
export interface WindowsPipeAdapter {listen():unknown;accept(listener:unknown):Promise<AttestedWindowsPipe>;connect():Promise<AttestedWindowsPipe>;stop(listener:unknown):void;}
function absolute(path:string){if(!/^[a-z]:\\/i.test(path)||!win32.isAbsolute(path)||win32.normalize(path)!==path||path.slice(2).includes(":"))throw Error("SCM_MANAGED_PATH_REJECTED");}
export function readWindowsManagedBytes(file:string):Buffer{
 absolute(file);return Buffer.from(handoffNative({action:"read-managed",path:file}),"base64");
}
export function readWindowsScmProvision(file:string,role:"SERVICE"|"DESKTOP",installationId?:string,deviceId?:string):WindowsScmHandoffProvision{
 const bytes=readWindowsManagedBytes(file);
 try{
  const p=WindowsScmHandoffProvisionSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  if(p.role!==role||installationId!==undefined&&p.handoff.installation_id!==installationId||deviceId!==undefined&&p.handoff.device_id!==deviceId)throw Error("SCM_PROVISION_BINDING_REJECTED");
  absolute(p.adapter_file);if(p.signer_private_file)absolute(p.signer_private_file);if(p.receiver_file)absolute(p.receiver_file);
  return p;
 }finally{bytes.fill(0);}
}
const recordSchema=z.object({fd:z.number().int().nonnegative(),handle:z.unknown(),peer:z.strictObject({sid:z.string(),logonSid:z.string(),sessionId:z.number().int().nonnegative(),pid:z.number().int().positive(),creationTime:z.string().regex(/^[0-9]+$/)})});

/** Privileged adapter. Production constructs it ONLY through the pinned loader.
 * The injectable binding is a code-level port for isolated tests, never JSON. */
export class WindowsNativePipeAdapter implements WindowsPipeAdapter {
 constructor(private readonly p:WindowsScmHandoffProvision,private readonly native:NativePipeBinding){}
 private args():[string,string,string,string,number]{const p=this.p.handoff;return [`\\\\.\\pipe\\camacho-pos-${p.installation_id.toLowerCase()}-scm`,p.service_sid,p.recipient_sid,p.recipient_logon_sid,p.recipient_session_id];}
 listen():unknown{if(this.p.role!=="SERVICE")throw Error("SCM_SERVICE_ROLE_REQUIRED");return this.native.listen(...this.args());}
 async accept(listener:unknown){return this.adopt(await this.native.accept(listener,1000));}
 async connect(){if(this.p.role!=="DESKTOP")throw Error("SCM_DESKTOP_ROLE_REQUIRED");return this.adopt(await this.native.connect(...this.args(),5000));}
 stop(listener:unknown):void{this.native.stop(listener);}
 private adopt(input:NativePipeRecord):AttestedWindowsPipe{
  const p=this.p.handoff;
  let socket:Socket|undefined;
  try{
   const r=recordSchema.parse(input);
   // These are native results, NOT attributes read from a channel payload.
   if(this.p.role==="SERVICE"?(r.peer.sid!==p.recipient_sid||r.peer.logonSid!==p.recipient_logon_sid||r.peer.sessionId!==p.recipient_session_id):(r.peer.sid!==p.service_sid||r.peer.sessionId!==0))throw Error("SCM_NATIVE_PEER_REJECTED");
   this.native.recheck(r.handle);
   socket=new Socket({fd:r.fd,readable:true,writable:true});this.native.adopt(r.handle);socket.pause();
   let released=false;const release=()=>{if(released)return;released=true;this.native.release(r.handle);};
   socket.once("close",release);socket.once("error",()=>{socket?.destroy();});
   return {socket,peer:r.peer,recheck:()=>{if(socket?.destroyed)throw Error("SCM_NATIVE_CONNECTION_CLOSED");this.native.recheck(r.handle);}};
  }catch{socket?.destroy();this.native.release(input.handle);throw Error("SCM_NATIVE_PEER_REJECTED");}
 }
}
export function loadWindowsNativePipeAdapter(p:WindowsScmHandoffProvision):WindowsPipeAdapter{
 if(process.platform!=="win32")throw Error("WINDOWS_NATIVE_PIPE_REQUIRED");
 const bytes=readWindowsManagedBytes(p.adapter_file);
 try{if(createHash("sha256").update(bytes).digest("hex")!==p.adapter_sha256)throw Error("SCM_NATIVE_ADAPTER_HASH_REJECTED");}finally{bytes.fill(0);}
 const binding=createRequire(import.meta.url)(p.adapter_file) as NativePipeBinding;
 for(const key of ["listen","accept","connect","adopt","release","recheck","stop"] as const)if(typeof binding[key]!=="function")throw Error("SCM_NATIVE_ADAPTER_API_REJECTED");
 return new WindowsNativePipeAdapter(p,binding);
}
