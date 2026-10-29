import type {Socket} from "node:net";
import type {LocalDatabase} from "@pos-platform/database-sqlite";
import type {WindowsScmHandoffProvision} from "@pos-platform/contracts";
import {LocalChannelAuthenticator,encodeFrame,loadWindowsNativePipeAdapter,withWindowsServiceSigner,
  sealSignedWindowsHandoffForCurrentService,verifySignedWindowsHandoffCandidate,
  type WindowsPipeAdapter,type AttestedWindowsPipe} from "@pos-platform/local-channel";
import {SqliteWindowsHandoffLeaseAuthority} from "./sqlite-replay-state.js";
import type {ChannelServerTransport,ChannelConnectionSecurity} from "./server.js";

type Seal=()=>{capsule:string;secret:Buffer};
/** Same framing/dispatcher; this adapter supplies kernel-attested sockets and
 * per-lease MACs. No SSA/GLOBAL/RBAC authority is created by transport admission. */
export class WindowsScmChannelTransport implements ChannelServerTransport{
 private readonly ledger:SqliteWindowsHandoffLeaseAuthority;
 private readonly master:Buffer;
 private adapter:WindowsPipeAdapter|undefined;private listener:unknown;
 private faulted=false;private running=false;private started=false;private loop:Promise<void>|undefined;private poll:NodeJS.Timeout|undefined;
 private readonly sockets=new Set<Socket>();
 private readonly bound=new Map<string,{pipe:AttestedWindowsPipe;close:()=>void;retire:()=>void}>();
 private cache:{leaseId:string;capsule:unknown;secret:Buffer}|undefined;
 constructor(private readonly p:WindowsScmHandoffProvision,private readonly database:LocalDatabase,master:Buffer,
   private readonly dependencies?:{adapter:WindowsPipeAdapter;seal:Seal;clock?:()=>Date}){
  if(p.role!=="SERVICE"||!p.signer_private_file||master.length!==32)throw Error("SCM_SERVICE_PROVISION_REQUIRED");
  this.master=Buffer.from(master);this.ledger=new SqliteWindowsHandoffLeaseAuthority(database,p.handoff,dependencies?.clock);
 }
 private now(){return this.dependencies?.clock?.()??new Date();}
 private offered(){
  if(this.faulted)throw Error("SCM_TRANSPORT_DURABILITY_FAILED");
  if(this.cache)return this.cache;
  const p=this.p,h=p.handoff;
  const sealed=this.dependencies?this.dependencies.seal():withWindowsServiceSigner(p.signer_private_file!,h.installation_id,h.device_id,p.signer_public_key_pem,p.signer_spki_sha256,
    key=>sealSignedWindowsHandoffForCurrentService(h,this.master,key,p.signer_public_key_pem,p.signer_spki_sha256));
  try{
   const capsule=JSON.parse(sealed.capsule),verified=verifySignedWindowsHandoffCandidate(h,capsule,h.installation_id,h.device_id,this.now(),p.signer_public_key_pem,p.signer_spki_sha256);
   this.cache={leaseId:verified.leaseId,capsule,secret:sealed.secret};return this.cache;
  }catch(error){sealed.secret.fill(0);throw error;}
 }
 async start(accept:(socket:Socket,security:ChannelConnectionSecurity)=>void):Promise<void>{
  if(this.started)throw Error("SCM_TRANSPORT_ALREADY_STARTED");this.started=true;
  this.adapter=this.dependencies?.adapter??loadWindowsNativePipeAdapter(this.p);
  this.listener=this.adapter.listen();this.running=true;
  this.poll=setInterval(()=>{
   this.ledger.checkConnections();
   for(const b of [...this.bound.values()])try{b.pipe.recheck();}catch{b.close();}
  },this.p.handoff.poll_ms);this.poll.unref();
  this.loop=(async()=>{while(this.running){
   let pipe:AttestedWindowsPipe;
   try{pipe=await this.adapter!.accept(this.listener);}catch{if(this.running)await new Promise<void>(r=>setTimeout(r,25));continue;}
   if(!this.running){pipe.socket.destroy();break;}
   this.establish(pipe,accept);
  }})();
 }
 private establish(pipe:AttestedWindowsPipe,accept:(socket:Socket,security:ChannelConnectionSecurity)=>void):void{
  const socket=pipe.socket;this.sockets.add(socket);
  let authenticator:LocalChannelAuthenticator|undefined,negotiation:NodeJS.Timeout|undefined;
  socket.once("close",()=>{this.sockets.delete(socket);clearTimeout(negotiation);authenticator?.destroy();});
  try{
   pipe.recheck();const offered=this.offered();
   authenticator=new LocalChannelAuthenticator(offered.secret,undefined,{replayStateStore:{accept:input=>this.ledger.acceptTransportFrame(input)}});
   const security:ChannelConnectionSecurity={authenticator,authorize:(context,close,retire)=>{
    pipe.recheck();
    if(!this.bound.has(context.connectionId)){
      this.ledger.admitConnection(offered.leaseId,context.connectionId,close);
      this.bound.set(context.connectionId,{pipe,close,retire});clearTimeout(negotiation);
    }
    this.ledger.assertConnectionActive(context.connectionId);
   },closed:id=>{this.ledger.releaseConnection(id);this.bound.delete(id);authenticator?.destroy();}};
   negotiation=setTimeout(()=>socket.destroy(),5000);negotiation.unref();
   socket.write(encodeFrame(offered.capsule,32768),error=>{
    if(error||!this.running||socket.destroyed){socket.destroy();return;}
    accept(socket,security);socket.resume();
   });
  }catch{socket.destroy();}
 }
 revokeConnections(ids:readonly string[],initiator:string):void{
  const leases=new Set(ids.map(id=>this.ledger.leaseForConnection(id)).filter((id):id is string=>id!==undefined));
  for(const leaseId of leases){
   const draining=this.bound.get(initiator);
   try{this.ledger.revoke(leaseId,initiator,draining?()=>draining.retire():undefined);}
   catch(error){this.faulted=true;for(const socket of this.sockets)socket.destroy();throw error;}
   finally{if(this.cache?.leaseId===leaseId){this.cache.secret.fill(0);this.cache=undefined;}}
  }
 }
 async stop():Promise<void>{
  this.running=false;clearInterval(this.poll);this.poll=undefined;
  if(this.adapter&&this.listener!==undefined)this.adapter.stop(this.listener);
  this.ledger.closeConnections();for(const socket of this.sockets)socket.destroy();
  await this.loop;this.bound.clear();this.cache?.secret.fill(0);this.cache=undefined;this.master.fill(0);
 }
}
