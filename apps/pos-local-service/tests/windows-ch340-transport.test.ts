import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { WindowsScaleProfileSchema, WindowsCh340Transport, loadWindowsScaleProfile } from "../src/hardware/windows-ch340-transport.js";
const profile = {schema_version:"1.0.0",port:"COM5",pnp_device_id:"USB\\VID_1A86&PID_7523\\LAB_DEVICE_1",cash_register_id:randomUUID(),protocol:"TEK_ATLAS_ASCII_CRLF_9600_8N1"};
describe("Windows CH340 trusted configuration",()=>{
  it("requires a selected CH340 instance and register",()=>{
    expect(WindowsScaleProfileSchema.parse(profile).port).toBe("COM5");
    for(const candidate of [{...profile,port:"COM5;whoami"},{...profile,pnp_device_id:"USB\\VID_1A86&PID_7523"},{...profile,pnp_device_id:"USB\\VID_1234&PID_5678\\OTHER"},{...profile,cash_register_id:"wrong"}]){
      expect(WindowsScaleProfileSchema.safeParse(candidate).success).toBe(false);
    }
  });
  it("keeps the scale disabled without a trusted profile",()=>{
    expect(loadWindowsScaleProfile(undefined)).toBeNull();
    expect(()=>loadWindowsScaleProfile("relative.json")).toThrow("SCALE_PROFILE_PATH_MUST_BE_ABSOLUTE");
  });
  it("does not imply connectivity merely because a profile exists",async()=>{
    const transport=new WindowsCh340Transport(WindowsScaleProfileSchema.parse(profile));
    expect(transport.reader.status()).toBe("disconnected");
    expect(transport.reader.consume()).toBeNull();
    await transport.stop();
  });
});
