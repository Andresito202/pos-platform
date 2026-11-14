import {describe,expect,it} from "vitest";
import {spawnSync} from "node:child_process";
import {existsSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

// The production service entry, not a mocked guard or text-matching test.
// This intentionally supplies a nonexistent SCM provision: the commercial
// release gate must reject BEFORE opening it, allocating a DB or loading DPAPI.
// Never inject a bypass flag, actual keys, tenant identities or Central access.
describe.runIf(process.platform==="win32")("Windows SCM commercial entry fails closed",()=>{
 it("denies SCM commercial startup before provisioning or SQLite side effects",()=>{
  const root=mkdtempSync(join(tmpdir(),"camacho-scm-deny-"));
  const data=join(root,"db-must-not-exist");
  const fakeProvision=join(root,"scm-must-not-exist.json");
  const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>!k.startsWith("POS_")&&v!==undefined));
  const env={...cleanEnv,
   POS_DATA_DIRECTORY:data,
   POS_INSTALLATION_ID:"018f0000-0000-7000-8000-000000001001",
   POS_DEVICE_ID:"018f0000-0000-7000-8000-000000001002",
   POS_TENANT_ID:"018f0000-0000-7000-8000-000000001003",
   POS_COMPANY_ID:"018f0000-0000-7000-8000-000000001004",
   POS_BRANCH_ID:"018f0000-0000-7000-8000-000000001005",
   POS_SERVICE_VERSION:"1.0.0",POS_PROTOCOL_MIN:"1.0.0",POS_PROTOCOL_MAX:"1.0.0",
   POS_WINDOWS_SCM_HANDOFF_FILE:fakeProvision,
  };
  try{
   const result=spawnSync(process.execPath,["--import","tsx",fileURLToPath(new URL("../src/main.ts",import.meta.url))],
    {cwd:fileURLToPath(new URL("../",import.meta.url)),env,encoding:"utf8",windowsHide:true,timeout:15_000,maxBuffer:64*1024});
   expect(result.error).toBeUndefined();
   expect(result.status).toBe(1);
   const output=(result.stdout??"")+(result.stderr??"");
   expect(output).toContain("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
   expect(output).toContain("runtime.start_failed");
   expect(output).not.toContain("runtime.started");
   expect(existsSync(data)).toBe(false);
   expect(existsSync(fakeProvision)).toBe(false);
  }finally{
   rmSync(root,{recursive:true,force:true});
  }
 },20_000);
});
