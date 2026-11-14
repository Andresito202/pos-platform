import {describe,expect,it,vi} from "vitest";
import {WindowsNativePipeAdapter,loadWindowsNativePipeAdapter,type NativePipeBinding} from "../src/windows-native-pipe.js";
import {WindowsScmHandoffProvisionSchema,type WindowsScmHandoffProvision} from "@pos-platform/contracts";
const handoff={service_sid:"S-1-5-80-1-2-3-4-5",installation_id:"018f0000-0000-7000-8000-000000000001",recipient_sid:"S-1-5-21-1-2-3-1001",recipient_logon_sid:"S-1-5-5-1-2",recipient_session_id:1};
const p={role:"SERVICE",handoff} as WindowsScmHandoffProvision;
function binding(){return {listen:vi.fn(),accept:vi.fn(),connect:vi.fn(),stop:vi.fn(),adopt:vi.fn(),release:vi.fn(),recheck:vi.fn()} satisfies NativePipeBinding;}
const peer={sid:handoff.recipient_sid,logonSid:handoff.recipient_logon_sid,sessionId:1,pid:123,creationTime:"1234"};
describe("native adapter fail-closed boundary (injected native results)",()=>{
 it.each([{sid:"S-1-5-21-1-2-3-9999"},{logonSid:"S-1-5-5-8-9"},{sessionId:2}])("rejects a mismatched peer %j before socket adoption",async diff=>{
  const n=binding(),handle={};n.accept.mockResolvedValue({fd:99,handle,peer:{...peer,...diff}});
  await expect(new WindowsNativePipeAdapter(p,n).accept({})).rejects.toThrow();expect(n.adopt).not.toHaveBeenCalled();expect(n.release).toHaveBeenCalledExactlyOnceWith(handle);
 });
 it("rejects a kernel re-attestation failure before adopting a descriptor",async()=>{
  const n=binding();n.accept.mockResolvedValue({fd:99,handle:{},peer});n.recheck.mockImplementation(()=>{throw Error("changed");});
  await expect(new WindowsNativePipeAdapter(p,n).accept({})).rejects.toThrow();expect(n.adopt).not.toHaveBeenCalled();expect(n.release).toHaveBeenCalledOnce();
 });
 it("releases even malformed native records",async()=>{
  const n=binding();n.accept.mockResolvedValue({fd:-1,handle:{},peer});await expect(new WindowsNativePipeAdapter(p,n).accept({})).rejects.toThrow();expect(n.release).toHaveBeenCalledOnce();
 });
 it("forbids role confusion",async()=>{
  const n=binding();await expect(new WindowsNativePipeAdapter(p,n).connect()).rejects.toThrow();expect(()=>new WindowsNativePipeAdapter({...p,role:"DESKTOP"},n).listen()).toThrow();
 });
 it.skipIf(process.platform==="win32")("does not fall back to simulated Windows identity on Linux",()=>{expect(()=>loadWindowsNativePipeAdapter(p)).toThrow("WINDOWS_NATIVE_PIPE_REQUIRED");});
 it("does not accept an enabling boolean or an incomplete provisioning document",()=>{expect(WindowsScmHandoffProvisionSchema.safeParse({...p,enabled:true}).success).toBe(false);});
});
