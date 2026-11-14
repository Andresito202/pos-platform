import { randomUUID } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { HardwareProfileSchema,HardwareRequestSchema,CanonicalPermission,type HardwareProfile } from "@pos-platform/contracts";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import { HardwareService } from "../src/hardware/hardware-service.js";
import { HardwareStore } from "../src/hardware/hardware-store.js";
import { RawTcpTransport,requirePhysicalProfile,type HardwareTransport,type TransportResult } from "../src/hardware/adapters.js";
import { encodePrinterText,drawerPulse,cutterCommand,formatReceiptAmount,projectPrintableReceipt } from "../src/hardware/receipt-printer.js";
import { WindowsRawSpoolTransport,CupsRawTransport,loadHardwareRegistry } from "../src/hardware/platform-transports.js";
import { SqliteReceiptStore } from "../src/receipts/sqlite-receipt-store.js";
import { GetReceiptUseCase } from "../src/receipts/get-receipt-use-case.js";
import type { Receipt } from "../src/receipts/receipt.js";

// These are TEST DOUBLES, not product adapters or evidence of physical support.
class RecordingTransport implements HardwareTransport {
  readonly id="fixture-printer";readonly simulated=true;writes:Uint8Array[]=[];
  result:TransportResult={state:"TRANSPORT_ACCEPTED",code:"TEST_BYTES_ONLY"};
  async send(bytes:Uint8Array){this.writes.push(bytes);return this.result;}
}
const scope={tenantId:randomUUID(),companyId:randomUUID(),branchId:randomUUID(),deviceId:randomUUID(),installationId:randomUUID()};
const actor={userId:randomUUID(),sessionId:randomUUID()},register=randomUUID(),binding=randomUUID();
const profile:HardwareProfile=HardwareProfileSchema.parse({schema_version:"1.0.0",id:"SYNTHETIC_TEST_ONLY",revision:1,manufacturer:"Fixture",model:"No physical model",firmware:"test",support_status:"SIMULATED",evidence:"unit-test-not-device",protocol:"ESC_POS",transport:"SIMULATOR",paper_mm:80,columns:48,encoding:"CP1252",code_page:16,cut:"UNSUPPORTED",drawer:"SUPPORTED",drawer_sensor:"UNKNOWN",paper_sensor:"UNKNOWN",drawer_pulse:{pin:0,on:10,off:10}});
function auth(permissions:string[]=Object.values(CanonicalPermission)):StoredAuthorizationSnapshot {
  return {signature:"fixture-only",activatedAt:new Date().toISOString(),claims:{
    snapshot_id:randomUUID(),user_id:actor.userId,installation_id:scope.installationId,device_id:scope.deviceId,
    sequence:1,key_id:"TEST_ONLY",issued_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),
    assignments:[{tenant_id:scope.tenantId,company_id:scope.companyId,branch_id:scope.branchId,status:"ACTIVE",role_status:"ACTIVE",valid_from:"2020-01-01T00:00:00.000Z",valid_until:null,permissions:permissions.map(code=>({code,status:"ACTIVE"}))}],
  }} as StoredAuthorizationSnapshot;
}
let directory:string,database:LocalDatabase,store:HardwareStore,transport:RecordingTransport,service:HardwareService;
beforeEach(()=>{
  directory=mkdtempSync(join(tmpdir(),"pos-hardware-"));database=LocalDatabase.open({dataDirectory:directory});store=new HardwareStore(database);transport=new RecordingTransport();
  database.native.prepare("INSERT INTO cash_register(id,tenant_id,company_id,branch_id,code,code_normalized,name,currency_code,status,created_at,version,last_seen_sequence) VALUES (?,?,?,?,?,?,?,'COP','ACTIVE',?,1,1)").run(register,scope.tenantId,scope.companyId,scope.branchId,"LAB","LAB","Fixture",new Date().toISOString());
  service=new HardwareService(store,new GetReceiptUseCase(new SqliteReceiptStore(database)),new Map([[transport.id,{transport,profile}]]),async()=>[{id:transport.id,name:"Test double",driver:null,transport:"SIMULATOR",observable_state:"TEST_ONLY"}]);
  store.associate(scope,actor,binding,register,transport.id,profile);
});
afterEach(()=>{database?.close();if(directory)rmSync(directory,{recursive:true,force:true});});
async function queued(kind:"PRINT_TEST"|"DRAWER_OPEN"|"CUT"="PRINT_TEST",id=randomUUID()) {
  const result=await service.execute(scope,auth(),actor,{action:"enqueue",job_id:id,binding_id:binding,kind,sale_id:null,reason:"Authorized fixture"});
  return {id,result};
}
describe("hardware execution, durable SQLite and canonical authorization",()=>{
  it("cannot use a simulated or untested profile to drive real hardware",()=>{
    const real=new RawTcpTransport("never-used","127.0.0.1",1,1000);
    expect(()=>requirePhysicalProfile(profile,real)).toThrow("SIMULATED_PROFILE_CANNOT_DRIVE_PHYSICAL_HARDWARE");
    expect(()=>requirePhysicalProfile({...profile,support_status:"UNTESTED"},real)).toThrow("PHYSICAL_HARDWARE_PROFILE_NOT_VALIDATED");
  });
  it("rechecks permission at dispatch even when enqueue was authorized",async()=>{
    const {id}=await queued("DRAWER_OPEN");
    expect((await service.execute(scope,auth([CanonicalPermission.HARDWARE_READ]),actor,{action:"dispatch",job_id:id})).kind).toBe("UNAUTHORIZED");
    expect(transport.writes).toHaveLength(0);expect(store.job(scope,id)?.state).toBe("PENDING");
  });
  it("does not replay when audit fails after bytes have been accepted",async()=>{
    const {id}=await queued("DRAWER_OPEN");
    database.native.exec("CREATE TRIGGER hardware_finish_audit_failure BEFORE INSERT ON hardware_events WHEN NEW.event_code='TRANSPORT_ACCEPTED' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    expect((await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id})).kind).toBe("REJECTED");
    expect(store.job(scope,id)?.state).toBe("DISPATCHING");
    await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id});
    expect(transport.writes).toHaveLength(1);
    store.recoverInterrupted();expect(store.job(scope,id)?.state).toBe("UNKNOWN");
  });
  it("queues and dispatches text without claiming physical printing or a drawer sensor",async()=>{
    const {id,result}=await queued();expect(result.kind).toBe("QUEUED");
    const sent=await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id});
    expect(sent.kind).toBe("TRANSPORT_ACCEPTED");expect(transport.writes).toHaveLength(1);
    expect(profile.drawer_sensor).toBe("UNKNOWN");expect(store.job(scope,id)?.result_code).toBe("TEST_BYTES_ONLY");
  });
  it("manual drawer requires its specific permission, reason and append-only audit",async()=>{
    const id=randomUUID();
    expect((await service.execute(scope,auth([CanonicalPermission.HARDWARE_PRINT]),actor,{action:"enqueue",job_id:id,binding_id:binding,kind:"DRAWER_OPEN",sale_id:null,reason:"Manual test"})).kind).toBe("UNAUTHORIZED");
    expect(store.job(scope,id)).toBeNull();expect(database.native.prepare("SELECT event_code FROM hardware_events WHERE event_code='DENIED_MANUAL_DRAWER'").get()).toBeTruthy();
    const job=await queued("DRAWER_OPEN");await service.execute(scope,auth(),actor,{action:"dispatch",job_id:job.id});
    expect([...transport.writes[0]!]).toEqual([27,112,0,10,10]);
    expect(()=>database.native.prepare("DELETE FROM hardware_events").run()).toThrow("append-only");
  });
  it("rejects job replay without emitting a second pulse",async()=>{
    const {id}=await queued("DRAWER_OPEN");
    await Promise.all([service.execute(scope,auth(),actor,{action:"dispatch",job_id:id}),service.execute(scope,auth(),actor,{action:"dispatch",job_id:id})]);
    expect(transport.writes).toHaveLength(1);
  });
  it("keeps identity idempotent but rejects a different intent with the same job",async()=>{
    const {id}=await queued();expect((await queued("PRINT_TEST",id)).result.kind).toBe("QUEUED");
    expect((await queued("DRAWER_OPEN",id)).result.reason).toBe("HARDWARE_IDEMPOTENCY_CONFLICT");
    expect(store.list(scope).jobs).toHaveLength(1);
  });
  it("keeps pending print jobs through an actual database close/reopen",async()=>{
    const {id}=await queued();database.close();database=LocalDatabase.open({dataDirectory:directory});store=new HardwareStore(database);store.recoverInterrupted();
    expect(store.job(scope,id)?.state).toBe("PENDING");
  });
  it("marks interrupted I/O UNKNOWN at restart without replaying pulse",async()=>{
    const {id}=await queued("DRAWER_OPEN");expect(store.claim(scope,actor,id)).toBe(true);
    database.close();database=LocalDatabase.open({dataDirectory:directory});store=new HardwareStore(database);store.recoverInterrupted();
    expect(store.job(scope,id)?.state).toBe("UNKNOWN");expect(transport.writes).toHaveLength(0);
  });
  it("preserves uncertain transport outcome and does not retry after reconnection",async()=>{
    transport.result={state:"UNKNOWN",code:"LINK_LOST_AFTER_WRITE"};const {id}=await queued("DRAWER_OPEN");
    expect((await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id})).kind).toBe("UNKNOWN");
    transport.result={state:"TRANSPORT_ACCEPTED",code:"RECONNECTED"};await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id});
    expect(transport.writes).toHaveLength(1);
  });
  it("records a known paper error supplied by a capable adapter without inventing sensor values",async()=>{
    transport.result={state:"FAILED",code:"PAPER_OUT_REPORTED_BY_ADAPTER"};const {id}=await queued();
    expect((await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id})).kind).toBe("FAILED");
  });
  it("denies a different branch and never reaches the physical adapter",async()=>{
    const {id}=await queued("DRAWER_OPEN");expect((await service.execute({...scope,branchId:randomUUID()},auth(),actor,{action:"dispatch",job_id:id})).kind).toBe("UNAUTHORIZED");
    expect(transport.writes).toHaveLength(0);
  });
  it("rejects a register outside its branch during association",()=>{
    expect(()=>store.associate(scope,actor,randomUUID(),randomUUID(),transport.id,profile)).toThrow("HARDWARE_REGISTER_OUT_OF_SCOPE");
  });
  it("rejects a missing cutter and any caller-supplied electrical command",async()=>{
    expect((await queued("CUT")).result.reason).toBe("PRINTER_HAS_NO_VERIFIED_CUTTER");
    expect(()=>HardwareRequestSchema.parse({protocol_version:"1.0.0",payload_schema_version:"1.0.0",message_type:"hardware.command",request_id:randomUUID(),correlation_id:randomUUID(),payload:{action:"dispatch",job_id:randomUUID(),bytes:[27,112]}})).toThrow();
  });
  it("rolls back the dispatch claim when audit fails, before touching transport",async()=>{
    const {id}=await queued();database.native.exec("CREATE TRIGGER hardware_test_audit_fail BEFORE INSERT ON hardware_events BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
    const result=await service.execute(scope,auth(),actor,{action:"dispatch",job_id:id});expect(result.kind).toBe("REJECTED");
    expect(store.job(scope,id)?.state).toBe("PENDING");expect(transport.writes).toHaveLength(0);
  });
  it("does not enqueue a receipt for an unpaid or absent sale",async()=>{
    const result=await service.execute(scope,auth(),actor,{action:"enqueue",job_id:randomUUID(),binding_id:binding,kind:"PRINT_RECEIPT",sale_id:randomUUID(),reason:"Receipt test"});
    expect(result.reason).toBe("NOT_FOUND");expect(store.list(scope).jobs).toHaveLength(0);
  });
  it("rejects a profile without a model-specific drawer pulse",()=>{
    expect(()=>HardwareProfileSchema.parse({...profile,drawer_pulse:null})).toThrow();
    expect(()=>drawerPulse({...profile,drawer:"UNKNOWN",drawer_pulse:null})).toThrow("DRAWER_PROFILE_UNSUPPORTED");
  });
});
describe("receipt projection and verified encoding",()=>{
  const receipt:Receipt={saleId:randomUUID(),documentSeries:"POS",saleNumber:7,businessDate:"2026-10-21",currencyCode:"COP",completedAt:new Date().toISOString(),lines:[{lineNumber:1,presentationName:"Unidad",identifier:null,unitPrecision:0,unitPriceAmount:"123456789012345.123456",grossAmount:"123456789012345.123456",discountAmount:"0.000000",taxableAmount:"123456789012345.123456",taxAmount:"0.000000",productName:"Café piñón",quantity:"1.000000",unitCode:"UND",lineTotalAmount:"123456789012345.123456"}],payments:[],subtotalAmount:"123456789012345.123456",discountAmount:"0.000000",taxAmount:"0.000000",fiscalTotalAmount:"123456789012345.123456",commercialRoundingAdjustment:"-0.123456",payableAmount:"123456789012345.000000",calculationChecksum:"a".repeat(64)};
  it("preserves all frozen decimal digits without recalculating money",()=>{
    expect(formatReceiptAmount("123456789012345.123456")).toBe("123.456.789.012.345,123456");
    const original=JSON.stringify(receipt);expect(projectPrintableReceipt(receipt,48)).toContain("TOTAL COP 123.456.789.012.345");expect(JSON.stringify(receipt)).toBe(original);
  });
  it("supports Spanish characters in the explicitly selected code page",()=>{
    expect([...encodePrinterText("Café piñón ¿Sí?\n",profile)]).toContain(241);
    expect(()=>encodePrinterText("中文",profile)).toThrow("PRINTER_CHARACTER_UNSUPPORTED");
  });
  it("never includes drawer/cut bytes in a reprinted receipt",()=>{
    const bytes=encodePrinterText(projectPrintableReceipt(receipt,48),profile);
    expect(Buffer.from(bytes).includes(Buffer.from([27,112]))).toBe(false);
    expect(Buffer.from(bytes).includes(Buffer.from([29,86]))).toBe(false);
  });
  it("rejects control injection hidden in a product name",()=>{
    expect(()=>projectPrintableReceipt({...receipt,lines:[{...receipt.lines[0]!,productName:"x\x1bp\x00"}]},32)).toThrow("HARDWARE_TEXT_CONTAINS_CONTROL");
  });
});
describe("actual TCP transport against an isolated loopback receiver",()=>{
  it("requires an explicit cutter command instead of choosing a model default",()=>{
    expect(()=>HardwareProfileSchema.parse({...profile,cut:"SUPPORTED",cut_command:null})).toThrow();
    const selected=HardwareProfileSchema.parse({...profile,cut:"SUPPORTED",cut_command:"GS_V_1"});
    expect([...cutterCommand(selected)]).toEqual([29,86,1]);
  });
  it("fails closed without a trusted absolute registry path",()=>{
    expect(loadHardwareRegistry(undefined).size).toBe(0);
    expect(()=>loadHardwareRegistry("relative.json")).toThrow();
  });
  it("rejects an absent Windows spool queue without printing",async()=>{
    if(process.platform!=="win32")return;
    expect((await new WindowsRawSpoolTransport("absent",`CAMACHO_ABSENT_${randomUUID()}`,10000).send(Buffer.from("not printed"))).state).toBe("FAILED");
    expect((await new CupsRawTransport("absent","never-executed",1000).send(Buffer.from("x"))).state).toBe("FAILED");
  },15000);
  it("sends exact bytes but reports transport acceptance only",async()=>{
    const chunks:Buffer[]=[];const server=createServer(socket=>socket.on("data",chunk=>chunks.push(chunk)));
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    try {const address=server.address() as {port:number};const adapter=new RawTcpTransport("loopback","127.0.0.1",address.port,1000);
      expect((await adapter.send(Buffer.from("fixture"))).state).toBe("TRANSPORT_ACCEPTED");
      await new Promise(resolve=>setTimeout(resolve,20));expect(Buffer.concat(chunks).toString()).toBe("fixture");
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it("reports a connection refused without implying printer success",async()=>{
    const server=createServer();await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
    expect((await new RawTcpTransport("closed","127.0.0.1",port,1000).send(Buffer.from("x"))).state).toBe("FAILED");
  });
});
