import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename,dirname,join } from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { AndroidServiceFoundation } from "../src/android/android-service-foundation.js";

const directories:string[]=[];
const services:AndroidServiceFoundation[]=[];
function fixture(directory=mkdtempSync(join(tmpdir(),"camacho-android-service-"))) {
  if(!directories.includes(directory))directories.push(directory);
  const service=new AndroidServiceFoundation(directory);services.push(service);return service;
}
afterEach(async()=>{
  for(const service of services.splice(0)) {
    if(["READY","FAILED"].includes(service.status().state))await service.stop();
  }
  for(const directory of directories.splice(0)) {
    const target=realpathSync(directory);
    if(dirname(target)!==realpathSync(tmpdir())||!basename(target).startsWith("camacho-android-service-"))throw new Error("TEST_CLEANUP_PATH_REJECTED");
    rmSync(target,{recursive:true,force:true});
  }
});
describe("canonical Android foundation without commercial provisioning",()=>{
  it("starts the existing components without granting access or opening a channel",async()=>{
    const service=fixture();await service.start();
    expect(service.status()).toEqual({component:"android-service-foundation",state:"READY",commercial_access:"BLOCKED_PENDING_TRUSTED_PROVISIONING",components:["local-database"],local_security:"NOT_PROVISIONED",external_channel:"CLOSED"});
    await Promise.all([service.stop(),service.stop()]);expect(service.status().state).toBe("STOPPED");
  });
  it("rejects a competing writer and releases ownership on graceful stop",async()=>{
    const first=fixture();await first.start();
    const second=fixture(directories[0]!);await expect(second.start()).rejects.toThrow("runtime start failed");
    expect(second.status().state).toBe("FAILED");
    await second.stop();
    await expect(fixture(directories[0]!).start()).rejects.toThrow("runtime start failed");
    await first.stop();const restarted=fixture(directories[0]!);await restarted.start();
    expect(restarted.status().commercial_access).toBe("BLOCKED_PENDING_TRUSTED_PROVISIONING");
  });
  it("rejects repeated start while keeping commercial access blocked",async()=>{
    const service=fixture();await service.start();
    await expect(service.start()).rejects.toThrow("cannot start runtime from READY");
    expect(service.status().commercial_access).toBe("BLOCKED_PENDING_TRUSTED_PROVISIONING");
  });
});
