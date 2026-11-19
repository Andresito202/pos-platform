import {describe,expect,it} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes,randomUUID} from "node:crypto";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {readWindowsScmProvision,readWindowsManagedBytes,loadWindowsNativePipeAdapter,LocalChannelAuthenticator,connectWindowsScmClient} from "@pos-platform/local-channel";
import {WindowsScmHandoffProvisionSchema} from "@pos-platform/contracts";
import {LocalChannelServer} from "../src/channel/server.js";
import {WindowsScmChannelTransport} from "../src/channel/windows-scm-transport.js";

// Requires a disposable, owner-approved Windows SCM installation. Never installs
// a service, changes ACLs, creates identities or enables the commercial entry.
// Both roles use real native handles, DPAPI and pinned installer provisions.
const file=process.env.CAMACHO_SCM_PHYSICAL_PROVISION;
const range={min:"1.0.0",max:"1.0.0"};
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function statusRequest(){return {protocol_version:"1.0.0",message_type:"runtime.status.get",request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload:{}};}
describe("physical Windows SCM transport (not BUSINESS/human certification)",()=>{
 it.skipIf(process.platform!=="win32"||!file)("authenticates real SCM and recipient, consumes one lease and closes both sockets on revoke",async()=>{
  const bytes=readWindowsManagedBytes(file!);let role:"SERVICE"|"DESKTOP";
  try{role=WindowsScmHandoffProvisionSchema.parse(JSON.parse(bytes.toString("utf8"))).role;}finally{bytes.fill(0);}
  const p=readWindowsScmProvision(file!,role);
  if(role==="SERVICE"){
   const dir=mkdtempSync(join(tmpdir(),"camacho-scm-physical-")),db=LocalDatabase.open({dataDirectory:dir}),master=randomBytes(32),auth=new LocalChannelAuthenticator(master);
   const transport=new WindowsScmChannelTransport(p,db,master),ids=new Set<string>(),closed=new Set<string>();let operations=0,beforeRevocationRows=0;
   const server=new LocalChannelServer("NATIVE_PHYSICAL",auth,async(r,_signal,context)=>{
    ids.add(context.connectionId);if(r.message_type!=="runtime.handshake")operations++;
    if(operations===2&&r.message_type!=="runtime.handshake"){
      beforeRevocationRows=(db.native.prepare("SELECT count(*) AS n FROM local_channel_replay_state").get() as {n:number}).n;
      transport.revokeConnections([...ids],context.connectionId);
    }
    return {protocol_version:"1.0.0",request_id:r.request_id,correlation_id:r.correlation_id,operation_id:null,status:"SUCCEEDED",result_code:"OK",result_schema_version:"1.0.0",error:null,server_time:new Date().toISOString(),result:r.message_type==="runtime.handshake"?{status:"COMPATIBLE",negotiated_protocol_version:"1.0.0"}:{service_version:"1.0.0",protocol_version:"1.0.0",service_state:"READY",schema_version:"5"}};
   },range,32,64,5000,id=>closed.add(id),transport);
   try{
    await server.start();
    const duplicate=loadWindowsNativePipeAdapter(p);let duplicateListener:unknown;
    try{expect(()=>{duplicateListener=duplicate.listen();}).toThrow();}finally{if(duplicateListener!==undefined)duplicate.stop(duplicateListener);}
    const deadline=Date.now()+60_000;
    while(operations<2&&Date.now()<deadline)await pause(50);
    expect(operations).toBe(2);expect(ids.size).toBe(2);await pause(500);
    expect((db.native.prepare("SELECT count(*) AS n FROM local_channel_replay_state").get() as {n:number}).n).toBe(beforeRevocationRows+1);
    // The wrong-signer-pin client is kernel-authorized but never completes a
    // MAC handshake. Its native socket must also close; it is not in ids.
    expect([...ids].filter(id=>closed.has(id))).toHaveLength(2);
    expect([...closed].filter(id=>!ids.has(id))).toHaveLength(1);
   }finally{await server.stop();auth.destroy();master.fill(0);db.close();rmSync(dir,{recursive:true,force:true});}
  }else{
   const handshake=()=>({...statusRequest(),message_type:"runtime.handshake",payload:{desktop_version:"1.0.0",service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0",installation_id:p.handoff.installation_id,device_id:p.handoff.device_id,schema_version:"5",service_state:"READY"}});
   // Actual native self-token/SCM checks, with no injected adapter or identity.
   expect(()=>loadWindowsNativePipeAdapter({...p,role:"SERVICE"}).listen()).toThrow();
   for(const change of [{recipient_logon_sid:"S-1-5-5-0-0"},{recipient_session_id:0},{recipient_sid:"S-1-5-21-0-0-0-1000"}]){
    await expect(connectWindowsScmClient({...p,handoff:{...p.handoff,...change}},handshake(),range)).rejects.toThrow();
   }
   await expect(connectWindowsScmClient({...p,signer_spki_sha256:"0".repeat(64)},handshake(),range)).rejects.toThrow();
   const a=await connectWindowsScmClient(p,handshake(),range);let b:Awaited<ReturnType<typeof connectWindowsScmClient>>|undefined;
   try{b=await connectWindowsScmClient(p,handshake(),range);
    await expect(a.request(statusRequest())).resolves.toMatchObject({status:"SUCCEEDED"});
    await expect(b.request(statusRequest())).resolves.toMatchObject({status:"SUCCEEDED"});await pause(1500);
    await expect(a.request(statusRequest())).rejects.toThrow();await expect(b.request(statusRequest())).rejects.toThrow();
   }finally{await a.close();await b?.close();}
  }
 },75_000);
});
