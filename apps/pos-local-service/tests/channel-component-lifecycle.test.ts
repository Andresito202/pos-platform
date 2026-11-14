import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {CommercialComponent} from "../src/commercial/commercial-component.js";
import type {LocalDatabaseComponent} from "../src/local-database-component.js";
import type {OperationConfirmationComponent} from "../src/operations/operation-confirmation-component.js";
import type {ServiceConfig} from "../src/config.js";

// Deterministic lifecycle-only ports. No Windows identity, DPAPI or socket proof.
const h=vi.hoisted(()=>({servers:[] as {start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[],auths:[] as {destroy:ReturnType<typeof vi.fn>}[],pending:[] as Promise<void>[],secretFailure:false,startFailure:undefined as Error|undefined,stopFailure:undefined as Error|undefined}));
vi.mock("../src/channel/secret.js",()=>({loadOrCreateWindowsLocalChannelSecret:()=>{if(h.secretFailure)throw Error("PROVISION_FAILED");return Buffer.alloc(32,7);}}));
vi.mock("../src/commercial/commercial-request-handler.js",()=>({CommercialRequestHandler:class{}}));
vi.mock("@pos-platform/local-channel",async original=>{
 const actual=await original<typeof import("@pos-platform/local-channel")>();
 return {...actual,LocalChannelAuthenticator:class{destroy=vi.fn();constructor(){h.auths.push(this);}}};
});
vi.mock("../src/channel/server.js",()=>({LocalChannelServer:class{
 start=vi.fn(()=>h.startFailure?Promise.reject(h.startFailure):(h.pending.shift()??Promise.resolve()));
 stop=vi.fn(()=>h.stopFailure?Promise.reject(h.stopFailure):Promise.resolve());
 disconnectConnection=vi.fn();retireConnection=vi.fn();constructor(){h.servers.push(this);}
}}));
import {LocalChannelComponent} from "../src/channel/local-channel-component.js";
const platform=Object.getOwnPropertyDescriptor(process,"platform")!;
beforeEach(()=>{Object.defineProperty(process,"platform",{...platform,value:"win32"});h.servers=[];h.auths=[];h.pending=[];h.secretFailure=false;h.startFailure=undefined;h.stopFailure=undefined;});
afterEach(()=>Object.defineProperty(process,"platform",platform));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
function fixture(){
 const unregister:ReturnType<typeof vi.fn>[]=[];
 const commercial={registerNativeSessionCloser:vi.fn(()=>{const fn=vi.fn();unregister.push(fn);return fn;}),bindings:{release:vi.fn()}};
 const native={handle:vi.fn(),release:vi.fn(),stop:vi.fn()};
 const c=new LocalChannelComponent({installation_id:"018f0000-0000-7000-8000-000000000001",data_directory:"C:\\private",protocol_min:"1.0.0",protocol_max:"1.0.0"} as ServiceConfig,{database:{}} as LocalDatabaseComponent,()=>"READY",{} as OperationConfirmationComponent,commercial as unknown as CommercialComponent,native);
 return {c,unregister,native};
}
const tick=()=>new Promise<void>(r=>setImmediate(r));
describe("component start/stop ownership (simulated host and server)",()=>{
 it("stops the in-flight server and joins startup before shutdown resolves",async()=>{
  const d=deferred();h.pending.push(d.promise);const {c,unregister}=fixture();
  const started=c.start().catch(error=>error);let done=false;const stopped=c.stop().then(()=>{done=true;});
  try{await tick();expect(done).toBe(false);expect(h.servers[0]!.stop).toHaveBeenCalledOnce();}
  finally{d.resolve();await started;await stopped;}
  expect(unregister[0]).toHaveBeenCalledOnce();expect(h.auths[0]!.destroy).toHaveBeenCalledOnce();
 });
 it("rejects a replacement start until the cancelled attempt has fully settled",async()=>{
  const d=deferred();h.pending.push(d.promise);const {c,unregister}=fixture();const first=c.start().catch(error=>error),stop=c.stop();
  try{await expect(c.start()).rejects.toThrow("LOCAL_CHANNEL_ALREADY_STARTED");}
  finally{d.resolve();await first;await stop;await c.stop();}
  await c.start();expect(unregister[1]).not.toHaveBeenCalled();await c.stop();expect(unregister[1]).toHaveBeenCalledOnce();
 });
 it("coalesces concurrent shutdown without invoking cancellation twice",async()=>{
  const {c,native}=fixture();await c.start();await Promise.all([c.stop(),c.stop()]);
  expect(h.servers[0]!.stop).toHaveBeenCalledOnce();expect(native.stop).toHaveBeenCalledOnce();expect(h.auths[0]!.destroy).toHaveBeenCalledOnce();
 });
 it("continues resource cleanup if the native login coordinator throws",async()=>{
  const {c,native}=fixture();await c.start();const error=Error("COORDINATOR_STOP_FAILED");native.stop.mockImplementation(()=>{throw error;});
  await expect(c.stop()).rejects.toThrow();expect(h.servers[0]!.stop).toHaveBeenCalledOnce();expect(h.auths[0]!.destroy).toHaveBeenCalledOnce();
 });
 it("does not retain starting state after synchronous provisioning fails",async()=>{
  const {c}=fixture();h.secretFailure=true;await expect(c.start()).rejects.toThrow("PROVISION_FAILED");h.secretFailure=false;
  await c.start();await c.stop();expect(h.servers).toHaveLength(1);
 });
 it("preserves startup and cleanup errors together",async()=>{
  const {c}=fixture(),start=Error("START_FAILED"),stop=Error("STOP_FAILED");h.startFailure=start;h.stopFailure=stop;
  const error=await c.start().catch(e=>e);expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toContain(start);expect(error.errors).toContain(stop);expect(h.auths[0]!.destroy).toHaveBeenCalledOnce();
 });
 it("retains the completed stop result for sequential callers",async()=>{
  const {c,native}=fixture();await c.start();await c.stop();await c.stop();
  expect(native.stop).toHaveBeenCalledOnce();expect(h.servers[0]!.stop).toHaveBeenCalledOnce();
 });
 it("does not report a later successful stop after resource cleanup failed",async()=>{
  const {c}=fixture();await c.start();const failure=Error("STOP_FAILED");h.stopFailure=failure;
  await expect(c.stop()).rejects.toBe(failure);await expect(c.stop()).rejects.toBe(failure);
  await expect(c.start()).rejects.toThrow("LOCAL_CHANNEL_ALREADY_STARTED");
  expect(h.servers[0]!.stop).toHaveBeenCalledOnce();expect(h.auths[0]!.destroy).toHaveBeenCalledOnce();
 });

});
