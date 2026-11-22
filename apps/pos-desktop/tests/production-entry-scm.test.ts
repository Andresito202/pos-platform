import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const boundary=vi.hoisted(()=>({read:vi.fn(),connect:vi.fn(),legacy:vi.fn(),start:vi.fn(),bootstrap:vi.fn(),close:vi.fn()}));
vi.mock("@pos-platform/local-channel",()=>({readWindowsScmProvision:boundary.read,connectWindowsScmClient:boundary.connect,loadProductionDesktopProvisioning:boundary.legacy}));
vi.mock("../src/start.js",()=>({startPosDesktop:boundary.start}));
vi.mock("../src/main.js",()=>({bootstrap:boundary.bootstrap}));
const installation="018f0000-0000-7000-8000-000000001001",device="018f0000-0000-7000-8000-000000001002";
const provision={handoff:{installation_id:installation,device_id:device}};
const channel={request:vi.fn(),close:boundary.close};
const exitCode=process.exitCode;
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();
 vi.stubEnv("POS_WINDOWS_SCM_HANDOFF_FILE","C:\\managed\\desktop.json");
 vi.stubEnv("POS_INSTALLATION_ID",installation);vi.stubEnv("POS_DEVICE_ID",device);
 boundary.read.mockReturnValue(provision);boundary.connect.mockResolvedValue(channel);
 boundary.bootstrap.mockResolvedValue(undefined);boundary.close.mockResolvedValue(undefined);
 vi.spyOn(console,"error").mockImplementation(()=>undefined);process.exitCode=undefined;
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();process.exitCode=exitCode;});
describe("original production entry SCM selection (OS/DPAPI connector boundary doubled)",()=>{
 it("opens the original renderer only after the authenticated SCM connector succeeds, without per-user key loading",async()=>{
  await import("../src/production-entry.js");
  expect(boundary.read).toHaveBeenCalledWith("C:\\managed\\desktop.json","DESKTOP",installation,device);
  expect(boundary.connect).toHaveBeenCalledWith(provision,expect.objectContaining({message_type:"runtime.handshake",payload:expect.objectContaining({installation_id:installation,device_id:device})}),{min:"1.0.0",max:"1.0.0"});
  expect(boundary.bootstrap).toHaveBeenCalledWith(channel);
  expect(boundary.bootstrap.mock.invocationCallOrder[0]).toBeGreaterThan(boundary.connect.mock.invocationCallOrder[0]!);
  expect(boundary.legacy).not.toHaveBeenCalled();expect(boundary.start).not.toHaveBeenCalled();
 });
 it.each(["custody","authentication"])("fails closed on rejected %s without opening a window or falling back",async failure=>{
  if(failure==="custody")boundary.read.mockImplementationOnce(()=>{throw Error("SCM_PROVISION_BINDING_REJECTED");});
  else boundary.connect.mockRejectedValueOnce(Error("SCM_CHANNEL_REJECTED"));
  await import("../src/production-entry.js");
  expect(process.exitCode).toBe(1);expect(boundary.bootstrap).not.toHaveBeenCalled();
  expect(boundary.legacy).not.toHaveBeenCalled();expect(boundary.start).not.toHaveBeenCalled();
  if(failure==="custody")expect(boundary.connect).not.toHaveBeenCalled();
 });
 it("closes the authenticated channel when the original renderer bootstrap fails",async()=>{
  boundary.bootstrap.mockRejectedValueOnce(Error("renderer unavailable"));
  await import("../src/production-entry.js");expect(boundary.close).toHaveBeenCalledOnce();expect(process.exitCode).toBe(1);
 });
 it("retains the existing per-user entry when no SCM provision was selected and clears its temporary secret",async()=>{
  vi.stubEnv("POS_WINDOWS_SCM_HANDOFF_FILE",undefined);
  const secret=Buffer.alloc(32,7);boundary.legacy.mockReturnValue({endpoint:"existing-pipe",channelSecret:secret,installationId:installation,deviceId:device});
  boundary.start.mockResolvedValueOnce(undefined);await import("../src/production-entry.js");
  expect(boundary.start).toHaveBeenCalledOnce();expect(boundary.connect).not.toHaveBeenCalled();expect(boundary.read).not.toHaveBeenCalled();expect(secret.equals(Buffer.alloc(32))).toBe(true);
 });
});
