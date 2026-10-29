import {randomBytes,randomUUID} from "node:crypto";
import type {Server,Socket} from "node:net";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {DurableSyncStore} from "../src/sync/durable-sync-store.js";
import {OperationConfirmationStore} from "../src/operations/operation-confirmation-store.js";
import {afterEach,describe,expect,it,vi} from "vitest";
import {LocalChannelAuthenticator,LocalChannelClient} from "@pos-platform/local-channel";
import {uuidV7,type IpcRequest} from "@pos-platform/contracts";
import {LocalChannelServer,type ChannelRequestContext} from "../src/channel/server.js";

// Linux sandbox permits loopback TCP, but not Unix sockets. Only the bind and
// connect locations are adapted: real net.Server/Sockets, production framing,
// MAC/replay, queue, dispatcher and cleanup execute unchanged. NOT Win32/SCM.
const transport=vi.hoisted(()=>({server:undefined as Server|undefined}));
vi.mock("node:net",async original=>{
  const net=await original<typeof import("node:net")>();
  return {...net,createServer:(listener:(socket:Socket)=>void)=>{
    const server=net.createServer(listener),listen=server.listen.bind(server);
    Object.defineProperty(server,"listen",{value:(_endpoint:string,ready:()=>void)=>listen({host:"127.0.0.1",port:0},ready)});
    transport.server=server;return server;
  },createConnection:()=>{
    const address=transport.server?.address();
    if(!address||typeof address==="string")throw Error("TCP_TEST_LISTENER_REQUIRED");
    return net.createConnection({host:"127.0.0.1",port:address.port});
  }};
});

const installation="018f0000-0000-7000-8000-000000000001";
const device="018f0000-0000-7000-8000-000000000002";
function request(handshake=false){return {protocol_version:"1.0.0",message_type:handshake?"runtime.handshake":"runtime.status.get",
  request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload:handshake?{
    desktop_version:"1.0.0",service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0",
    installation_id:installation,device_id:device,schema_version:"5",service_state:"READY",
  }:{}};}
function response(req:IpcRequest){return {protocol_version:"1.0.0",request_id:req.request_id,correlation_id:req.correlation_id,
  operation_id:null,status:"SUCCEEDED",result_code:"OK",result_schema_version:"1.0.0",error:null,server_time:new Date().toISOString(),
  result:req.message_type==="runtime.handshake"?{status:"COMPATIBLE",negotiated_protocol_version:"1.0.0"}:
    {service_version:"1.0.0",protocol_version:"1.0.0",service_state:"READY",schema_version:"5"}};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(handle:(req:IpcRequest,signal:AbortSignal,context:ChannelRequestContext)=>Promise<unknown>,closed?:(id:string)=>void,timeout=1000){
  const secret=randomBytes(32),auth=new LocalChannelAuthenticator(secret),clients:LocalChannelClient[]=[],auths:LocalChannelAuthenticator[]=[];
  const ids:string[]=[];
  const server=new LocalChannelServer("TCP_TEST_ONLY",auth,async(req,signal,context)=>{
    if(req.message_type==="runtime.handshake"){ids.push(context.connectionId);return response(req);}
    return handle(req,signal,context);
  },{min:"1.0.0",max:"1.0.0"},32,64,timeout,closed);
  cleanups.push(async()=>{await server.stop();for(const c of clients)await c.close();auth.destroy();for(const a of auths)a.destroy();secret.fill(0);});
  await server.start();
  return {server,ids,connect:async()=>{
    const a=new LocalChannelAuthenticator(secret),c=new LocalChannelClient("TCP_TEST_ONLY",a,{min:"1.0.0",max:"1.0.0"},2000);
    auths.push(a);clients.push(c);await c.connect(request(true));return c;
  }};
}

function persistentOperation(){
  const directory=mkdtempSync(join(tmpdir(),"pos-channel-commit-"));
  let db=LocalDatabase.open({dataDirectory:directory});
  cleanups.push(async()=>{db.close();rmSync(directory,{recursive:true,force:true});});
  const scope={tenantId:randomUUID(),companyId:randomUUID(),branchId:randomUUID(),installationId:installation,deviceId:device};
  const context={scope,sessionId:randomUUID(),actorId:device};
  const operation={operationId:uuidV7(),idempotencyKey:randomUUID(),correlationId:randomUUID(),causationId:null,operationType:"RUNTIME_OPERATION_CONFIRMED",payload:{test:true}};
  return {confirm:()=>new OperationConfirmationStore(db,new DurableSyncStore(db)).confirm(context,operation),
    count:()=>db.native.prepare("SELECT count(*) AS n FROM runtime_operations").get(),
    audit:()=>db.native.prepare("SELECT count(*) AS n FROM local_operation_audit").get(),
    reopen:()=>{db.close();db=LocalDatabase.open({dataDirectory:directory});}};
}

describe.runIf(process.platform!=="win32")("real TCP transport: connection cancellation and closure (NOT Windows SCM)",()=>{
  it("performs the canonical MAC handshake and status response",async()=>{
    const f=await fixture(async req=>response(req)),client=await f.connect();
    expect(await client.request(request())).toMatchObject({status:"SUCCEEDED"});
  });
  it("disconnect aborts in-flight work synchronously and releases identity exactly once",async()=>{
    const started=deferred<AbortSignal>(),released:string[]=[];
    const f=await fixture(async(_req,signal)=>{started.resolve(signal);return new Promise(()=>{});},id=>released.push(id));
    const client=await f.connect(),result=client.request(request()).catch(e=>e),signal=await started.promise;
    expect(f.server.disconnectConnection(f.ids[0]!)).toBe(true);
    expect(signal.aborted).toBe(true);expect(released).toEqual(f.ids);
    expect(f.server.disconnectConnection(f.ids[0]!)).toBe(false);
    expect(await result).toBeInstanceOf(Error);
  });
  it("stopping closes every active connection even if one cleanup callback throws",async()=>{
    const started=deferred<void>(),signals:AbortSignal[]=[],released:string[]=[];
    const f=await fixture(async(_req,signal)=>{signals.push(signal);if(signals.length===2)started.resolve();return new Promise(()=>{});},id=>{released.push(id);throw Error("TEST_CLEANUP_FAILURE");});
    const a=await f.connect(),b=await f.connect();
    const results=[a.request(request()).catch(e=>e),b.request(request()).catch(e=>e)];
    await started.promise;await f.server.stop();
    expect(signals.every(s=>s.aborted)).toBe(true);expect(released).toHaveLength(2);
    expect((await Promise.all(results)).every(r=>r instanceof Error)).toBe(true);
  });
  it("retirement denies queued requests but drains the current response before closure",async()=>{
    const entered=deferred<void>(),proceed=deferred<void>();let calls=0;
    const f=await fixture(async(req,_signal,context)=>{calls++;entered.resolve();await proceed.promise;f.server.retireConnection(context.connectionId);return response(req);});
    const client=await f.connect(),first=client.request(request()),second=client.request(request()).catch(e=>e);
    await entered.promise;proceed.resolve();
    expect(await first).toMatchObject({status:"SUCCEEDED"});expect(await second).toBeInstanceOf(Error);expect(calls).toBe(1);
  });
  it("timeout aborts a handler and does not resurrect a connection on a late result",async()=>{
    const started=deferred<AbortSignal>(),late=deferred<unknown>();
    const f=await fixture(async(_req,signal)=>{started.resolve(signal);return late.promise;},undefined,40);
    const client=await f.connect(),result=client.request(request()).catch(e=>e),signal=await started.promise;
    expect(await result).toBeInstanceOf(Error);expect(signal.aborted).toBe(true);
    late.resolve({});expect(f.server.disconnectConnection(f.ids[0]!)).toBe(false);
  });
  it("a synchronous handler throw closes the channel without leaking an unhandled rejection",async()=>{
    const f=await fixture(()=>{throw Error("TEST_HANDLER_FAILURE");}),client=await f.connect();
    expect(await client.request(request()).catch(e=>e)).toBeInstanceOf(Error);
  });
  it("cancellation before the synchronous commit boundary leaves no operation or audit",async()=>{
    const store=persistentOperation(),entered=deferred<void>(),proceed=deferred<void>(),finished=deferred<void>();
    const f=await fixture(async(req,signal)=>{
      entered.resolve();await proceed.promise;
      try{signal.throwIfAborted();store.confirm();return response(req);}finally{finished.resolve();}
    });
    const client=await f.connect(),result=client.request(request()).catch(e=>e);
    await entered.promise;f.server.disconnectConnection(f.ids[0]!);proceed.resolve();await finished.promise;
    expect(await result).toBeInstanceOf(Error);expect(store.count()).toEqual({n:0});expect(store.audit()).toEqual({n:0});
  });
  it("a lost response after commit retains the canonical idempotent result and audit across reopen",async()=>{
    const store=persistentOperation(),committed=deferred<unknown>(),proceed=deferred<void>();
    const f=await fixture(async req=>{try{committed.resolve(store.confirm());}catch(error){committed.resolve(error);throw error;}await proceed.promise;return response(req);});
    const client=await f.connect(),result=client.request(request()).catch(e=>e);
    expect(await committed.promise).toMatchObject({kind:"CONFIRMED"});f.server.disconnectConnection(f.ids[0]!);proceed.resolve();
    expect(await result).toBeInstanceOf(Error);store.reopen();
    expect(store.confirm().kind).toBe("ALREADY_CONFIRMED");expect(store.count()).toEqual({n:1});expect(store.audit()).toEqual({n:1});
  });
});
