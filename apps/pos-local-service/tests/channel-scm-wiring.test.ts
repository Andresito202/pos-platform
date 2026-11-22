import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {ServiceConfig} from "../src/config.js";
import type {LocalDatabaseComponent} from "../src/local-database-component.js";
import type {CommercialComponent} from "../src/commercial/commercial-component.js";
import type {OperationConfirmationComponent} from "../src/operations/operation-confirmation-component.js";
const boundary=vi.hoisted(()=>({read:vi.fn(),secret:vi.fn(),construct:vi.fn(),start:vi.fn(),stop:vi.fn()}));
vi.mock("@pos-platform/local-channel",async original=>({...await original<typeof import("@pos-platform/local-channel")>(),readWindowsScmProvision:boundary.read}));
vi.mock("../src/channel/secret.js",()=>({loadOrCreateWindowsLocalChannelSecret:boundary.secret}));
vi.mock("../src/channel/windows-scm-transport.js",()=>({WindowsScmChannelTransport:class{
 constructor(...args:unknown[]){boundary.construct(...args);}start=boundary.start;stop=boundary.stop;
}}));
import {LocalChannelComponent} from "../src/channel/local-channel-component.js";
const config={installation_id:"018f0000-0000-7000-8000-000000001001",device_id:"018f0000-0000-7000-8000-000000001002",data_directory:"C:\\existing-data",protocol_min:"1.0.0",protocol_max:"1.0.0",windows_scm_handoff_file:"C:\\managed\\service.json"} as ServiceConfig;
const database={database:{}} as LocalDatabaseComponent;
let component:LocalChannelComponent|undefined,secret:Buffer;
beforeEach(()=>{
 vi.clearAllMocks();secret=Buffer.alloc(32,9);boundary.secret.mockReturnValue(secret);
 boundary.read.mockReturnValue({role:"SERVICE"});boundary.start.mockResolvedValue(undefined);boundary.stop.mockResolvedValue(undefined);
});
afterEach(async()=>{await component?.stop();component=undefined;});
function build(){component=new LocalChannelComponent(config,database,()=>"READY",{} as OperationConfirmationComponent,{bindings:{release:vi.fn()}} as unknown as CommercialComponent);return component;}
describe.runIf(process.platform==="win32")("existing LocalChannelComponent SCM wiring (DPAPI/native boundary doubled, real channel server)",()=>{
 it("passes the managed SERVICE binding to the existing SCM transport instead of binding the per-user pipe",async()=>{
  const c=build();await c.start();
  expect(c.endpoint).toBe(`\\\\.\\pipe\\camacho-pos-${config.installation_id}-scm`);
  expect(boundary.read).toHaveBeenCalledWith(config.windows_scm_handoff_file,"SERVICE",config.installation_id,config.device_id);
  expect(boundary.construct).toHaveBeenCalledWith({role:"SERVICE"},database.database,secret);
  expect(boundary.start).toHaveBeenCalledWith(expect.any(Function));expect(secret.equals(Buffer.alloc(32))).toBe(true);
  await c.stop();expect(boundary.stop).toHaveBeenCalledOnce();component=undefined;
 });
 it("rejects invalid provision custody before reading or creating channel key material",async()=>{
  boundary.read.mockImplementationOnce(()=>{throw Error("SCM_PROVISION_BINDING_REJECTED");});
  await expect(build().start()).rejects.toThrow("SCM_PROVISION_BINDING_REJECTED");
  expect(boundary.secret).not.toHaveBeenCalled();expect(boundary.construct).not.toHaveBeenCalled();
 });
 it("does not fall back when the native transport refuses startup",async()=>{
  boundary.start.mockRejectedValueOnce(Error("SCM_NATIVE_PEER_REJECTED"));
  await expect(build().start()).rejects.toThrow("SCM_NATIVE_PEER_REJECTED");
  expect(boundary.start).toHaveBeenCalledOnce();expect(boundary.stop).toHaveBeenCalledOnce();expect(secret.equals(Buffer.alloc(32))).toBe(true);
 });
 it("clears temporary channel key material if SCM transport construction rejects",async()=>{
  boundary.construct.mockImplementationOnce(()=>{throw Error("SCM_SERVICE_PROVISION_REQUIRED");});
  await expect(build().start()).rejects.toThrow("SCM_SERVICE_PROVISION_REQUIRED");
  expect(boundary.start).not.toHaveBeenCalled();expect(secret.equals(Buffer.alloc(32))).toBe(true);
 });
});
