import {afterEach,describe,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Socket} from "node:net";
import type {WindowsScmHandoffProvision} from "@pos-platform/contracts";
import type {AttestedWindowsPipe,WindowsPipeAdapter} from "@pos-platform/local-channel";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {WindowsScmChannelTransport} from "../src/channel/windows-scm-transport.js";
// Fault-injection cleanup tests; do not attest any Windows identity or handle.
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0))f();});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"scm-stop-")),db=LocalDatabase.open({dataDirectory:dir});cleanup.push(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 let deliver!:(p:AttestedWindowsPipe)=>void;const pending=new Promise<AttestedWindowsPipe>(r=>deliver=r);
 const adapter:WindowsPipeAdapter={listen:vi.fn(()=>({})),accept:vi.fn(()=>pending),connect:vi.fn(),stop:vi.fn()};
 const p={role:"SERVICE",signer_private_file:"C:\\private\\signer",handoff:{}} as WindowsScmHandoffProvision;
 const t=new WindowsScmChannelTransport(p,db,Buffer.alloc(32,5),{adapter,seal:()=>{throw Error("MUST_NOT_SEAL_AFTER_STOP");}});
 // White-box observations are restricted to zeroization and resource ownership.
 const state=t as unknown as {master:Buffer;cache?:{secret:Buffer};sockets:Set<Socket>;bound:Map<string,{close:()=>void}>};
 const late={socket:{destroy:vi.fn()} as unknown as Socket,peer:{} as AttestedWindowsPipe["peer"],recheck:vi.fn()};
 return {t,adapter,state,deliver:()=>deliver(late),late};
}
describe("SCM transport failure-safe stop",()=>{
 it("retains a failed stop result for repeated callers without joining a stuck native accept",async()=>{
  const x=fixture(),failure=Error("NATIVE_STOP_FAILED");vi.mocked(x.adapter.stop).mockImplementation(()=>{throw failure;});await x.t.start(vi.fn());
  await expect(x.t.stop()).rejects.toBe(failure);const second=x.t.stop().catch(error=>error);
  try{expect(await Promise.race([second,new Promise(r=>setTimeout(()=>r("HUNG"),50))])).toBe(failure);}
  finally{x.deliver();await second;}
  expect(x.adapter.stop).toHaveBeenCalledOnce();expect(x.state.master.every(v=>v===0)).toBe(true);expect(x.late.socket.destroy).toHaveBeenCalledOnce();
 });
 it("continues cleanup and preserves the first error if a socket also fails to close",async()=>{
  const x=fixture(),first=Error("NATIVE_STOP_FAILED"),cache=Buffer.alloc(32,9),close=vi.fn();
  vi.mocked(x.adapter.stop).mockImplementation(()=>{throw first;});await x.t.start(vi.fn());
  x.state.cache={secret:cache};x.state.sockets.add({destroy:()=>{throw Error("SOCKET_CLOSE_FAILED");}} as unknown as Socket);x.state.bound.set("owned",{close});
  try{await expect(x.t.stop()).rejects.toBe(first);expect(close).toHaveBeenCalledOnce();expect(cache.every(v=>v===0)).toBe(true);expect(x.state.master.every(v=>v===0)).toBe(true);}
  finally{x.deliver();}
 });
 it("does not permit start after stop, including stop before the first listen",async()=>{
  const x=fixture();await x.t.stop();
  try{await expect(x.t.start(vi.fn())).rejects.toThrow("SCM_TRANSPORT_STOPPED");}
  finally{x.deliver();await x.t.stop().catch(()=>{});}
  expect(x.adapter.listen).not.toHaveBeenCalled();
 });
});
