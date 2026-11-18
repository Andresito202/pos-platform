import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import * as z from "zod";
import { Ch340ScaleReader } from "./ch340-scale-reader.js";

export const WindowsScaleProfileSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  port: z.string().regex(/^COM[1-9][0-9]{0,3}$/),
  pnp_device_id: z.string().max(512).regex(/^USB\\VID_1A86&PID_7523\\[A-Z0-9_&.\\-]+$/i),
  cash_register_id: z.uuid(),
  protocol: z.literal("TEK_ATLAS_ASCII_CRLF_9600_8N1"),
});
export type WindowsScaleProfile = z.infer<typeof WindowsScaleProfileSchema>;
export function loadWindowsScaleProfile(path: string | undefined): WindowsScaleProfile | null {
  if (!path) return null;
  if (!isAbsolute(path)) throw new Error("SCALE_PROFILE_PATH_MUST_BE_ABSOLUTE");
  return WindowsScaleProfileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

// Only the service supplies PnP identity and COM port, never renderer arguments.
// The helper emits base64 chunks, not interpreted quantities. No printer access.
const SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$port=$env:CAMACHO_SCALE_PORT
$pnp=$env:CAMACHO_SCALE_PNP
$serial=$null
try {
 $matches=@(Get-CimInstance Win32_PnPEntity | Where-Object {
   $_.PNPDeviceID -ieq $pnp -and $_.ConfigManagerErrorCode -eq 0 -and
   $_.Name -match ('\(' + [regex]::Escape($port) + '\)$')
 })
 if($matches.Count -ne 1){throw 'SCALE_DEVICE_BINDING_MISMATCH'}
 $serial=New-Object System.IO.Ports.SerialPort($port,9600,[System.IO.Ports.Parity]::None,8,[System.IO.Ports.StopBits]::One)
 $serial.ReadTimeout=250
 $serial.Handshake=[System.IO.Ports.Handshake]::None
 $serial.Open()
 [Console]::WriteLine('READY')
 $buffer=New-Object byte[] 256
 while($true){
   try {$count=$serial.Read($buffer,0,$buffer.Length)}
   catch [System.TimeoutException]{continue}
   if($count -gt 0){[Console]::WriteLine([Convert]::ToBase64String($buffer,0,$count))}
 }
} catch {
 [Console]::Error.WriteLine('SCALE_SERIAL_UNAVAILABLE')
 exit 1
} finally {
 if($null -ne $serial){$serial.Dispose()}
}
`;

export class WindowsCh340Transport {
  readonly reader = new Ch340ScaleReader();
  private child: ChildProcess | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  constructor(readonly profile: WindowsScaleProfile) {}

  start(): void {
    if (this.running || process.platform !== "win32") return;
    this.running = true;
    this.open();
  }
  private open(): void {
    if (!this.running || this.child) return;
    let child: ChildProcess;
    try {
      child = spawn("powershell.exe", ["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(SCRIPT,"utf16le").toString("base64")], {
        windowsHide: true, stdio: ["ignore","pipe","pipe"],
        env: {...process.env, CAMACHO_SCALE_PORT: this.profile.port, CAMACHO_SCALE_PNP: this.profile.pnp_device_id},
      });
    } catch { this.schedule(); return; }
    this.child = child;
    this.reader.disconnect();
    let ready = false;
    const clearWatchdog = () => { if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null; };
    const watch = (ms: number) => {
      clearWatchdog();
      this.watchdog = setTimeout(() => {
        if (this.child === child) { this.reader.disconnect(); child.kill(); }
      }, ms);
      this.watchdog.unref?.();
    };
    watch(20_000);
    const stdout = child.stdout;
    if (stdout) {
      const lines = createInterface({input:stdout,crlfDelay:Infinity});
      lines.on("line", line => {
        if (this.child !== child || !this.running) return;
        if (!ready && line === "READY") { ready = true; this.reader.reconnect(); watch(5_000); return; }
        if (!ready || line.length > 344 || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) {
          this.reader.disconnect(); child.kill(); return;
        }
        try { this.reader.feed(Buffer.from(line,"base64")); watch(5_000); }
        catch { this.reader.disconnect(); child.kill(); }
      });
      child.once("close",()=>lines.close());
    }
    child.stderr?.resume();
    child.once("error",()=>{ if(this.child===child) this.reader.disconnect(); });
    child.once("close",()=>{
      if(this.child!==child)return;
      clearWatchdog(); this.child=null; this.reader.disconnect(); this.schedule();
    });
  }
  private schedule(): void {
    if (!this.running || this.retry) return;
    this.retry=setTimeout(()=>{this.retry=null;this.open();},2_000);
    this.retry.unref?.();
  }
  async stop(): Promise<void> {
    this.running=false; this.reader.disconnect();
    if(this.retry)clearTimeout(this.retry);this.retry=null;
    if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;
    const child=this.child;
    if(!child)return;
    await new Promise<void>(resolve=>{
      let timer: ReturnType<typeof setTimeout>;
      const done=()=>{clearTimeout(timer);resolve();};
      child.once("close",done);
      timer=setTimeout(()=>{child.off("close",done);resolve();},5_000);
      child.kill();
    });
    if(this.child===child)this.child=null;
  }
}
