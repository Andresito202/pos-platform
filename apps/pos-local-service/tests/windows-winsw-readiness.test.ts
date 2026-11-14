import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildServiceDescriptor } from "../src/windows-service-descriptor.js";

const script=resolve("../../tools/operators/windows-winsw-readiness.ps1");
const windowsIt=process.platform==="win32"?it:it.skip;
describe("operator WinSW readiness is inspection, not commercial activation",()=>{
 windowsIt("reports missing binary and retains all certification gates",()=>{
   const result=spawnSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-File",script,"-Json"],{encoding:"utf8",windowsHide:true,timeout:20000});
   expect(result.status).toBe(2);
   const value=JSON.parse(result.stdout);
   expect(value.Blocks).toContain("WINSW_AUTHORIZED_BINARY_MISSING");
   expect(value.BinaryReviewReady).toBe(false);
   expect(value.ScmCommercialLoginReady).toBe(false);
   expect(value.HumanLoginCertified).toBe(false);
 },25000);
 windowsIt("a matching SHA alone never approves an unsigned or mutable executable",()=>{
   const directory=mkdtempSync(join(tmpdir(),"pos-winsw-inspection-"));
   const file=join(directory,"unauthorized.exe");
   // A fake .exe is rejected before hash inspection on some Windows hosts.
   // Copy the signed runner Node binary without executing the copied fixture.
   // Even a matching hash must not authorize this non-WinSW binary.
   copyFileSync(process.execPath,file);
   try{
     const result=spawnSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-File",script,"-Json","-WinSWPath",file,"-ExpectedSha256",createHash("sha256").update(readFileSync(file)).digest("hex"),"-ApprovedSignerThumbprint","0".repeat(40)],{encoding:"utf8",windowsHide:true,timeout:20000});
     expect(result.status).toBe(2);
     const value=JSON.parse(result.stdout);
     // Some hosted Windows ACLs reject the fixture before SHA inspection.
     // A failed inspection must remain a denial; never accept a hash-only binary.
     if(value.BinaryHashMatched!==true)expect(value.Blocks).toContain("WINSW_FILE_OR_ACL_REJECTED");
     expect(value.Blocks).toContain("WINSW_APPROVED_AUTHENTICODE_SIGNER_REQUIRED");
     expect(value.Blocks).toContain("WINSW_APPROVED_VERSION_MISMATCH");
     expect(value.PathAclAccepted).toBe(false);
     expect(value.BinaryReviewReady).toBe(false);
   }finally{if(!directory.startsWith(join(tmpdir(),"pos-winsw-inspection-")))throw Error("TEST_PATH_REJECTED");rmSync(directory,{recursive:true,force:true});}
 },25000);
 it("keeps the existing SCM commercial rejection until native interoperability is proven",()=>{
   expect(()=>buildServiceDescriptor({nodeExecutable:"C:\\installed\\node.exe",bundle:"C:\\installed\\service.cjs",workingDirectory:"C:\\installed",environment:{},commercialLogin:true})).toThrow("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
 });
});
