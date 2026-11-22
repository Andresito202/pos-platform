import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {ServiceConfig} from "../src/config.js";
import type {LocalDatabaseComponent} from "../src/local-database-component.js";
import type {CommercialComponent} from "../src/commercial/commercial-component.js";
import type {OperationConfirmationComponent} from "../src/operations/operation-confirmation-component.js";
import type {DeviceCredentialProvider} from "../src/sync/device-credential.js";
import type {EncryptedFileSecretStore} from "../src/security/encrypted-secret-store.js";
const boundary=vi.hoisted(()=>({read:vi.fn(),readCentral:vi.fn(),secret:vi.fn(),construct:vi.fn(),guard:vi.fn(),start:vi.fn(),stop:vi.fn()}));
vi.mock("@pos-platform/local-channel",async original=>({...await original<typeof import("@pos-platform/local-channel")>(),readWindowsScmProvision:boundary.read}));
vi.mock("../src/channel/secret.js",()=>({loadOrCreateWindowsLocalChannelSecret:boundary.secret}));
vi.mock("../src/channel/scm-central-checkpoint.js",()=>({
 readScmCentralProvision:boundary.readCentral,
 ScmCentralCheckpointGuard:class{constructor(...args:unknown[]){boundary.guard(...args);}},
}));
vi.mock("../src/channel/windows-scm-transport.js",()=>({WindowsScmChannelTransport:class{
 constructor(...args:unknown[]){boundary.construct(...args);}start=boundary.start;stop=boundary.stop;
}}));
import {LocalChannelComponent} from "../src/channel/local-channel-component.js";
const handoff="C:\\managed\\service.json";
const central="C:\\managed\\central.json";
const config={installation_id:"018f0000-0000-7000-8000-000000001001",device_id:"018f0000-0000-7000-8000-000000001002",data_directory:"C:\\existing-data",protocol_min:"1.0.0",protocol_max:"1.0.0",windows_scm_handoff_file:handoff,windows_scm_central_provision_file:central} as ServiceConfig;
const database={database:{}} as LocalDatabaseComponent;
const credentials={} as DeviceCredentialProvider;
const store={} as EncryptedFileSecretStore;
const centralProvision={origin:"https://central.example.invalid"};
let component:LocalChannelComponent|undefined,secret:Buffer;
beforeEach(()=>{
 vi.clearAllMocks();secret=Buffer.alloc(32,9);boundary.secret.mockReturnValue(secret);
 boundary.read.mockReturnValue({role:"SERVICE"});boundary.readCentral.mockReturnValue(centralProvision);
 boundary.start.mockResolvedValue(undefined);boundary.stop.mockResolvedValue(undefined);
});
afterEach(async()=>{await component?.stop();component=undefined;});
function build(overrides: Partial<ServiceConfig> = {}, withDependencies = true){
 component=new LocalChannelComponent(
  {...config,...overrides} as ServiceConfig,
  database,
  ()=>"READY",
  {} as OperationConfirmationComponent,
  {bindings:{release:vi.fn()}} as unknown as CommercialComponent,
  undefined,
  withDependencies ? () => ({credentials, store}) : undefined,
 );
 return component;
}
describe.runIf(process.platform==="win32")("existing LocalChannelComponent SCM wiring (DPAPI/native boundary doubled, real channel server)",()=>{
 it("passes the managed SERVICE binding and Central guard to the existing SCM transport instead of binding the per-user pipe",async()=>{
  const c=build();await c.start();
  expect(c.endpoint).toBe(`\\\\.\\pipe\\camacho-pos-${config.installation_id}-scm`);
  expect(boundary.read).toHaveBeenCalledWith(handoff,"SERVICE",config.installation_id,config.device_id);
  expect(boundary.readCentral).toHaveBeenCalledWith(central);
  expect(boundary.guard).toHaveBeenCalledWith(centralProvision,{role:"SERVICE"},credentials,store);
  expect(boundary.construct).toHaveBeenCalledWith({role:"SERVICE"},database.database,secret,undefined,expect.any(Object));
  expect(boundary.start).toHaveBeenCalledWith(expect.any(Function));expect(secret.equals(Buffer.alloc(32))).toBe(true);
  await c.stop();expect(boundary.stop).toHaveBeenCalledOnce();component=undefined;
 });
 it("rejects SCM handoff without authenticated Central provision before constructing transport",async()=>{
  await expect(build({windows_scm_central_provision_file:undefined}).start()).rejects.toThrow("SCM_CENTRAL_PROVISION_REQUIRED");
  expect(boundary.secret).toHaveBeenCalledOnce();
  expect(boundary.readCentral).not.toHaveBeenCalled();
  expect(boundary.construct).not.toHaveBeenCalled();
  expect(secret.equals(Buffer.alloc(32))).toBe(true);
 });
 it("rejects SCM handoff without Central credential dependencies before constructing transport",async()=>{
  await expect(build({}, false).start()).rejects.toThrow("SCM_CENTRAL_PROVISION_REQUIRED");
  expect(boundary.construct).not.toHaveBeenCalled();
  expect(secret.equals(Buffer.alloc(32))).toBe(true);
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
