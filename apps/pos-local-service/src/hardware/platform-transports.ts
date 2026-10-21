import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import * as z from "zod";
import { HardwareProfileSchema } from "@pos-platform/contracts";
import { RawTcpTransport,type HardwareTransport,type TransportResult } from "./adapters.js";
import type { RegisteredHardware } from "./hardware-service.js";

// Windows API only; no downloaded driver, shell interpolation or electrical default.
const RAW_SPOOL_SCRIPT=String.raw`
$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CamachoRawSpool {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Doc { public string name;public string file;public string type; }
 [DllImport("winspool.drv",EntryPoint="OpenPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool Open(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",EntryPoint="StartDocPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] public static extern int Start(IntPtr handle,int level,ref Doc doc);
 [DllImport("winspool.drv",EntryPoint="WritePrinter",SetLastError=true)] public static extern bool Write(IntPtr handle,byte[] bytes,int length,out int written);
 [DllImport("winspool.drv",EntryPoint="EndDocPrinter",SetLastError=true)] public static extern bool End(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="StartPagePrinter",SetLastError=true)] public static extern bool StartPage(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="EndPagePrinter",SetLastError=true)] public static extern bool EndPage(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="ClosePrinter",SetLastError=true)] public static extern bool Close(IntPtr handle);
}
'@
$h=[IntPtr]::Zero
if(-not [CamachoRawSpool]::Open([string]$request.queue,[ref]$h,[IntPtr]::Zero)){Write-Output 'FAILED';exit 0}
try {
 $d=New-Object CamachoRawSpool+Doc;$d.name='Camacho POS hardware job';$d.type='RAW'
 if([CamachoRawSpool]::Start($h,1,[ref]$d) -eq 0){Write-Output 'FAILED';exit 0}
 if(-not [CamachoRawSpool]::StartPage($h)){Write-Output 'UNKNOWN';exit 0}
 $bytes=[Convert]::FromBase64String([string]$request.bytes);$written=0
 if(-not [CamachoRawSpool]::Write($h,$bytes,$bytes.Length,[ref]$written) -or $written -ne $bytes.Length){Write-Output 'UNKNOWN';exit 0}
 if(-not [CamachoRawSpool]::EndPage($h)){Write-Output 'UNKNOWN';exit 0}
 if(-not [CamachoRawSpool]::End($h)){Write-Output 'UNKNOWN';exit 0}
 Write-Output 'TRANSPORT_ACCEPTED'
} finally {[void][CamachoRawSpool]::Close($h)}
`;
export class WindowsRawSpoolTransport implements HardwareTransport {
  readonly simulated=false;
  constructor(readonly id:string,private readonly queue:string,private readonly timeoutMs:number){}
  send(bytes:Uint8Array):Promise<TransportResult> {
    if(process.platform!=="win32")return Promise.resolve({state:"FAILED",code:"WINDOWS_SPOOLER_UNAVAILABLE"});
    return new Promise(resolve=>{
      const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",RAW_SPOOL_SCRIPT],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
      let settled=false,out="";
      const done=(state:TransportResult["state"],code:string)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({state,code});};
      const timer=setTimeout(()=>{child.kill();done("UNKNOWN","SPOOLER_TIMEOUT_REQUIRES_RECONCILIATION");},this.timeoutMs);
      child.stdout.on("data",value=>{if(out.length<1024)out+=String(value);});
      child.stderr.resume();child.on("error",()=>done("UNKNOWN","SPOOLER_PROCESS_FAILED"));child.stdin.on("error",()=>undefined);
      child.on("exit",code=>{const state=out.trim();done(code===0&&state==="TRANSPORT_ACCEPTED"?"TRANSPORT_ACCEPTED":code===0&&state==="FAILED"?"FAILED":"UNKNOWN",state==="TRANSPORT_ACCEPTED"?"SPOOL_JOB_ACCEPTED_NOT_PHYSICALLY_CONFIRMED":"SPOOLER_ERROR_OR_PERMISSION_DENIED");});
      child.stdin.end(JSON.stringify({queue:this.queue,bytes:Buffer.from(bytes).toString("base64")}));
    });
  }
}
export class CupsRawTransport implements HardwareTransport {
  readonly simulated=false;
  constructor(readonly id:string,private readonly queue:string,private readonly timeoutMs:number){}
  send(bytes:Uint8Array):Promise<TransportResult>{
    if(process.platform!=="linux")return Promise.resolve({state:"FAILED",code:"CUPS_REQUIRES_LINUX"});
    return new Promise(resolve=>{
      const child=spawn("lp",["-d",this.queue,"-o","raw"],{stdio:["pipe","ignore","pipe"]});
      let settled=false;const done=(state:TransportResult["state"],code:string)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({state,code});};
      const timer=setTimeout(()=>{child.kill();done("UNKNOWN","CUPS_TIMEOUT");},this.timeoutMs);
      child.stderr.resume();child.stdin.on("error",()=>undefined);child.once("error",()=>done("FAILED","CUPS_EXECUTABLE_UNAVAILABLE"));
      child.once("exit",code=>done(code===0?"TRANSPORT_ACCEPTED":"UNKNOWN",code===0?"CUPS_JOB_ACCEPTED_NOT_PHYSICALLY_CONFIRMED":"CUPS_JOB_OUTCOME_UNCERTAIN"));child.stdin.end(bytes);
    });
  }
}
const RegistrySchema=z.strictObject({schema_version:z.literal("1.0.0"),devices:z.array(z.strictObject({
  id:z.string().min(1).max(160),profile:HardwareProfileSchema,
  target:z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("TCP"),host:z.string().min(1),port:z.number().int().min(1).max(65535)}),
    z.strictObject({kind:z.enum(["WINDOWS_SPOOLER","CUPS"]),queue:z.string().min(1).max(160).refine(value=>!value.startsWith("-")&&!/[\x00-\x1f]/.test(value))}),
  ]),timeout_ms:z.number().int().min(100).max(30000),
}))});
/** Trusted operator file only; renderer cannot provide endpoints, raw bytes or SDK paths. */
export function loadHardwareRegistry(path:string|undefined):ReadonlyMap<string,RegisteredHardware> {
  if(path===undefined)return new Map();
  if(!isAbsolute(path))throw new Error("HARDWARE_PROFILE_PATH_MUST_BE_ABSOLUTE");
  const parsed=RegistrySchema.parse(JSON.parse(readFileSync(path,"utf8"))),result=new Map<string,RegisteredHardware>();
  for(const device of parsed.devices){
    if(result.has(device.id)||device.target.kind!==device.profile.transport)throw new Error("HARDWARE_PROFILE_TRANSPORT_MISMATCH");
    const target=device.target;
    const transport=target.kind==="TCP"?new RawTcpTransport(device.id,target.host,target.port,device.timeout_ms):target.kind==="WINDOWS_SPOOLER"?new WindowsRawSpoolTransport(device.id,target.queue,device.timeout_ms):new CupsRawTransport(device.id,target.queue,device.timeout_ms);
    result.set(device.id,{transport,profile:device.profile});
  }
  return result;
}
export interface AutomaticDrawerPolicy {readonly binding_id:string;readonly policy_reference:string}
export function loadAutomaticDrawerPolicy(path:string|undefined):AutomaticDrawerPolicy|null {
  if(path===undefined)return null;
  if(!isAbsolute(path))throw new Error("HARDWARE_POLICY_PATH_MUST_BE_ABSOLUTE");
  return z.strictObject({schema_version:z.literal("1.0.0"),binding_id:z.uuid(),policy_reference:z.string().trim().min(3).max(200)}).parse(JSON.parse(readFileSync(path,"utf8")));
}
