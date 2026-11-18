import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { HardwareProfile } from "@pos-platform/contracts";

export interface DiscoveredPeripheral {
  readonly id:string;readonly name:string;readonly driver:string|null;
  readonly transport:string;readonly observable_state:string;
}
export interface TransportResult {readonly state:"TRANSPORT_ACCEPTED"|"FAILED"|"UNKNOWN";readonly code:string}
/** Hardware transport only; an accepted write never proves physical printing/opening. */
export interface HardwareTransport {
  readonly id:string;readonly simulated:boolean;
  send(bytes:Uint8Array):Promise<TransportResult>;
}
export class RawTcpTransport implements HardwareTransport {
  readonly simulated=false;
  constructor(readonly id:string,private readonly host:string,private readonly port:number,private readonly timeoutMs:number) {
    if (!host || !Number.isInteger(port) || port<1 || port>65535 || timeoutMs<=0) throw new Error("HARDWARE_ENDPOINT_INVALID");
  }
  send(bytes:Uint8Array):Promise<TransportResult> {
    return new Promise(resolve=>{
      let attempted=false,settled=false;
      const socket=createConnection({host:this.host,port:this.port});
      const finish=(state:TransportResult["state"],code:string)=>{if(settled)return;settled=true;socket.destroy();resolve({state,code});};
      socket.setTimeout(this.timeoutMs,()=>finish(attempted?"UNKNOWN":"FAILED","TRANSPORT_TIMEOUT"));
      socket.once("error",()=>finish(attempted?"UNKNOWN":"FAILED","TRANSPORT_DISCONNECTED"));
      socket.once("connect",()=>{attempted=true;socket.end(bytes,()=>finish("TRANSPORT_ACCEPTED","BYTES_ACCEPTED_NO_PHYSICAL_CONFIRMATION"));});
      socket.once("close",()=>{if(!settled)finish(attempted?"UNKNOWN":"FAILED","TRANSPORT_CLOSED");});
    });
  }
}
/** Read-only OS inventory, no status/capability inferred from an installed queue. */
export function discoverSystemPrinters(platform:NodeJS.Platform=process.platform):Promise<DiscoveredPeripheral[]> {
  const windows=platform==="win32";
  if (!windows && platform!=="linux") return Promise.resolve([]);
  const file=windows?"powershell.exe":"lpstat";
  const args=windows?["-NoProfile","-NonInteractive","-Command","@(Get-Printer | Select-Object Name,DriverName,PrinterStatus) | ConvertTo-Json -Compress"]:["-p"];
  return new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:5000,maxBuffer:256*1024},(error,out)=>{
    if(error){reject(new Error(windows?"WINDOWS_SPOOLER_INVENTORY_FAILED":"CUPS_INVENTORY_UNAVAILABLE"));return;}
    if(windows){
      try {const parsed:unknown=out.trim()?JSON.parse(out):[];const rows=Array.isArray(parsed)?parsed:[parsed];
        resolve(rows.map(row=>({id:"spooler-"+createHash("sha256").update(String(row.Name)).digest("hex").slice(0,24),name:String(row.Name),driver:String(row.DriverName),transport:"WINDOWS_SPOOLER",observable_state:"QUEUE_INSTALLED_CAPABILITIES_UNVERIFIED"})));}
      catch {reject(new Error("HARDWARE_INVENTORY_INVALID"));}
    }else resolve(out.split("\n").filter(line=>line.startsWith("printer ")).map(line=>({id:"cups-"+createHash("sha256").update(line.split(" ")[1]!).digest("hex").slice(0,24),name:line.split(" ")[1]!,driver:null,transport:"CUPS",observable_state:"QUEUE_INSTALLED_CAPABILITIES_UNVERIFIED"})));
  }));
}
export function requirePhysicalProfile(profile:HardwareProfile,transport:HardwareTransport):void {
  if (profile.support_status==="SIMULATED" && !transport.simulated) throw new Error("SIMULATED_PROFILE_CANNOT_DRIVE_PHYSICAL_HARDWARE");
  if (!transport.simulated && !["LAB_VALIDATED","PILOT_VALIDATED","CERTIFIED","CONDITIONAL"].includes(profile.support_status)) throw new Error("PHYSICAL_HARDWARE_PROFILE_NOT_VALIDATED");
}
