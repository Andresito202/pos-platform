import {afterEach,describe,expect,it} from "vitest";
import {createServer,createConnection,type Server,type Socket} from "node:net";
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import type {WindowsChannelHandoff,WindowsScmHandoffProvision} from "@pos-platform/contracts";
import {LocalChannelAuthenticator,connectWindowsScmClient,sealSignedWindowsHandoffCandidate,openWindowsHandoff,type AttestedWindowsPipe,type WindowsPipeAdapter} from "@pos-platform/local-channel";
import {LocalChannelServer,type ChannelHandler} from "../src/channel/server.js";
import {WindowsScmChannelTransport} from "../src/channel/windows-scm-transport.js";

// Actual TCP + canonical framing/MAC/handshake + RSA/Ed25519 + SQLite.
// Kernel peer attestation and DPAPI are explicit test ports, NOT Windows proof.
class KernelPortFixture implements WindowsPipeAdapter{
 private server:Server|undefined;private sockets=new Set<Socket>();private queue:AttestedWindowsPipe[]=[];
 private waiting:{resolve:(p:AttestedWindowsPipe)=>void;reject:(e:Error)=>void}|undefined;
 private ready:Promise<void>=Promise.resolve();valid=true;
 private pipe(socket:Socket):AttestedWindowsPipe{
  socket.pause();this.sockets.add(socket);socket.on("error",()=>socket.destroy());socket.once("close",()=>this.sockets.delete(socket));
  return {socket,peer:{sid:"FIXTURE_KERNEL_PORT",logonSid:"FIXTURE",sessionId:1,pid:1,creationTime:"1"},recheck:()=>{if(!this.valid||socket.destroyed)throw Error("FIXTURE_PEER_CHANGED");}};
 }
 listen(){this.ready=new Promise<void>((resolve,reject)=>{
  this.server=createServer(socket=>{const pipe=this.pipe(socket);if(this.waiting){const w=this.waiting;this.waiting=undefined;w.resolve(pipe);}else this.queue.push(pipe);});
  this.server.once("error",reject);this.server.listen({host:"127.0.0.1",port:0},resolve);
 });return this;}
 accept():Promise<AttestedWindowsPipe>{const p=this.queue.shift();if(p)return Promise.resolve(p);return new Promise((resolve,reject)=>{this.waiting={resolve,reject};});}
 async connect(){await this.ready;const address=this.server!.address();if(!address||typeof address==="string")throw Error("FIXTURE_LISTENER_REQUIRED");
  const socket=createConnection({host:"127.0.0.1",port:address.port});await new Promise<void>((resolve,reject)=>{socket.once("connect",resolve);socket.once("error",reject);});return this.pipe(socket);
 }
 stop(){this.waiting?.reject(Error("FIXTURE_STOPPED"));this.waiting=undefined;for(const socket of this.sockets)socket.destroy();this.queue=[];this.server?.close();}
}
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
const range={min:"1.0.0",max:"1.0.0"};
function request(type="runtime.status.get"){return {protocol_version:"1.0.0",message_type:type,request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload:{}};}
function response(r:any,result:unknown){return {protocol_version:"1.0.0",request_id:r.request_id,correlation_id:r.correlation_id,operation_id:null,status:"SUCCEEDED",result_code:r.message_type==="runtime.handshake"?"COMPATIBLE":"READY",result_schema_version:"1.0.0",error:null,server_time:new Date().toISOString(),result};}
async function lab(options:{clock?:()=>Date;handler?:ChannelHandler;mutate?:(p:WindowsScmHandoffProvision)=>WindowsScmHandoffProvision}={}){
 const dir=mkdtempSync(join(tmpdir(),"scm-runtime-")),db=LocalDatabase.open({dataDirectory:dir});
 const rsa=generateKeyPairSync("rsa",{modulusLength:3072}),signer=generateKeyPairSync("ed25519");
 const publicPem=rsa.publicKey.export({format:"pem",type:"spki"}).toString(),signerPem=signer.publicKey.export({format:"pem",type:"spki"}).toString();
 const pin=createHash("sha256").update(signer.publicKey.export({format:"der",type:"spki"})).digest("hex"),now=Date.now();
 const handoff:WindowsChannelHandoff={profile:"CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",service_id:"CamachoPOSLocalService",service_sid:"S-1-5-80-1-2-3-4-5",installation_id:"018f0000-0000-7000-8000-000000000001",device_id:"018f0000-0000-7000-8000-000000000002",recipient_sid:"S-1-5-21-1-2-3-1001",recipient_logon_sid:"S-1-5-5-1-2",recipient_session_id:1,recipient_public_key_pem:publicPem,recipient_key_sha256:createHash("sha256").update(rsa.publicKey.export({format:"der",type:"spki"})).digest("hex"),capsule_file:"C:\\ProgramData\\CamachoPOS\\capsule.json",not_before:new Date(now-1000).toISOString(),expires_at:new Date(now+60_000).toISOString(),revision:1,poll_ms:1000,policy_reference:"ISOLATED_KERNEL_PORT_FIXTURE"};
 const service:WindowsScmHandoffProvision={version:1,role:"SERVICE",handoff,adapter_file:"C:\\Managed\\pipe.node",adapter_sha256:"a".repeat(64),signer_public_key_pem:signerPem,signer_spki_sha256:pin,signer_private_file:"C:\\Managed\\signer.json"};
 const desktop:WindowsScmHandoffProvision={...service,role:"DESKTOP",signer_private_file:undefined,receiver_file:"C:\\Recipient\\key.json"};
 const master=randomBytes(32),adapter=new KernelPortFixture();
 const transport=new WindowsScmChannelTransport(service,db,master,{adapter,...(options.clock?{clock:options.clock}:{}),seal:()=>sealSignedWindowsHandoffCandidate(handoff,master,signer.privateKey.export({format:"der",type:"pkcs8"}),signerPem,pin,new Date(),{sid:handoff.service_sid,logonSid:"S-1-5-5-0-0",sessionId:0,service:true,interactive:false})});
 const ids:string[]=[],auth=new LocalChannelAuthenticator(randomBytes(32));
 const server=new LocalChannelServer("NATIVE_TEST_PORT",auth,async(r,signal,context)=>{
  if(r.message_type==="runtime.handshake"){ids.push(context.connectionId);return response(r,{status:"COMPATIBLE",negotiated_protocol_version:"1.0.0"});}
  if(options.handler)return options.handler(r,signal,context);
  return response(r,{service_state:"READY",service_version:"1.0.0",protocol_version:"1.0.0",schema_version:"5"});
 },range,32,64,2000,undefined,transport);
 cleanup.push(async()=>{await server.stop();auth.destroy();master.fill(0);db.close();rmSync(dir,{recursive:true,force:true});});
 await server.start();
 const connect=()=>connectWindowsScmClient(options.mutate?options.mutate(desktop):desktop,{...request("runtime.handshake"),payload:{desktop_version:"1.0.0",service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0",installation_id:handoff.installation_id,device_id:handoff.device_id,schema_version:"5",service_state:"READY"}},range,{adapter,open:c=>openWindowsHandoff(handoff,c,rsa.privateKey.export({format:"der",type:"pkcs8"}))});
 return {connect,transport,adapter,ids,db};
}

describe("SCM runtime integration with simulated kernel/DPAPI ports",()=>{
 it("admits multiple real sockets with one durable lease consumption and revokes every member",async()=>{
  const x=await lab(),a=await x.connect(),b=await x.connect();
  expect(x.ids).toHaveLength(2);expect(new Set(x.ids).size).toBe(2);
  await expect(a.request(request())).resolves.toMatchObject({status:"SUCCEEDED"});
  await expect(b.request(request())).resolves.toMatchObject({status:"SUCCEEDED"});
  expect(x.db.native.prepare("SELECT count(*) AS n FROM local_channel_replay_state WHERE highest_sequence=1").get()).toEqual({n:1});
  x.transport.revokeConnections([x.ids[0]!],"no-drain");
  await expect(a.request(request())).rejects.toThrow();await expect(b.request(request())).rejects.toThrow();
  const fresh=await x.connect();expect(x.ids).toHaveLength(3);
  // A new kernel-authenticated negotiation creates a DIFFERENT lease; it
  // grants transport only, never restores the revoked BUSINESS session.
  await fresh.close();await a.close();await b.close();
 });
 it("rechecks adapter peer evidence on each operation",async()=>{
  const x=await lab(),a=await x.connect();x.adapter.valid=false;
  await expect(a.request(request())).rejects.toThrow();await a.close();
 });
 it("rejects an independently pinned signer mismatch before the first MAC request",async()=>{
  const x=await lab({mutate:p=>({...p,signer_spki_sha256:"f".repeat(64)})});
  await expect(x.connect()).rejects.toThrow();expect(x.ids).toEqual([]);
 },15_000);
 it("aborts an in-flight operation before its persistent effect when the lease is revoked",async()=>{
  let started!:()=>void,release!:()=>void,aborted=false,committed=false;
  const entered=new Promise<void>(r=>started=r),proceed=new Promise<void>(r=>release=r);
  const x=await lab({handler:async(r,signal)=>{started();await proceed;if(signal.aborted){aborted=true;throw Error("cancelled before commit");}committed=true;return response(r,{});}});
  const a=await x.connect(),pending=a.request(request()).then(()=>false,()=>true);
  await entered;x.transport.revokeConnections([x.ids[0]!],"no-drain");release();
  expect(await pending).toBe(true);await new Promise<void>(r=>setImmediate(r));
  expect({aborted,committed}).toEqual({aborted:true,committed:false});await a.close();
 });
 it("preserves an already committed effect on response loss; cancellation does not undo commit",async()=>{
  let started!:()=>void,release!:()=>void,committed=0;
  const entered=new Promise<void>(r=>started=r),proceed=new Promise<void>(r=>release=r);
  const x=await lab({handler:async(r)=>{committed++;started();await proceed;return response(r,{});}});
  const a=await x.connect(),pending=a.request(request()).then(()=>false,()=>true);
  await entered;x.transport.revokeConnections([x.ids[0]!],"no-drain");release();
  expect(await pending).toBe(true);expect(committed).toBe(1);await a.close();
 });
 it("rechecks expiry at the commit fence after asynchronous work without waiting for polling",async()=>{
  let time=0,started!:()=>void,release!:()=>void,committed=false;
  const entered=new Promise<void>(r=>started=r),proceed=new Promise<void>(r=>release=r);
  const x=await lab({clock:()=>new Date(Date.now()+time),handler:async(r,_signal,context)=>{
    started();await proceed;context.assertAuthorized!();committed=true;return response(r,{});
  }});
  const a=await x.connect(),pending=a.request(request()).then(()=>false,()=>true);
  await entered;time+=120_000;release();expect(await pending).toBe(true);expect(committed).toBe(false);await a.close();
 });
 it("quarantines the transport on SQLite revocation failure and rejects fresh negotiation",async()=>{
  const x=await lab(),a=await x.connect(),b=await x.connect();x.db.native.pragma("query_only = ON");
  expect(()=>x.transport.revokeConnections([x.ids[0]!],"no-drain")).toThrow();
  x.db.native.pragma("query_only = OFF");
  await expect(a.request(request())).rejects.toThrow();await expect(b.request(request())).rejects.toThrow();
  await expect(x.connect()).rejects.toThrow();await a.close();await b.close();
 });

 it("drains exactly the initiating signed response while closing every other lease member",async()=>{
  let x:Awaited<ReturnType<typeof lab>>;
  x=await lab({handler:async(r,_signal,context)=>{
    x.transport.revokeConnections(x.ids,context.connectionId);
    return response(r,{service_version:"1.0.0",protocol_version:"1.0.0",service_state:"READY",schema_version:"5"});
  }});
  const a=await x.connect(),b=await x.connect();
  await expect(a.request(request())).resolves.toMatchObject({status:"SUCCEEDED"});
  await expect(b.request(request())).rejects.toThrow();await expect(a.request(request())).rejects.toThrow();
  await a.close();await b.close();
 });

});
