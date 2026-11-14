/** Isolated laboratory only. Never provisions a commercial identity or real hardware. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync,rmSync,mkdirSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateWindowsLocalChannelSecret } from "../../packages/local-channel/src/index.js";

if(process.platform!=="win32"||!process.argv.includes("--laboratory"))throw new Error("WINDOWS_LABORATORY_FLAG_REQUIRED");
const root=fileURLToPath(new URL("../../",import.meta.url));
const desktop=createRequire(join(root,"apps/pos-desktop/package.json"));
const local=createRequire(join(root,"apps/pos-local-service/package.json"));
const { _electron:electron }=desktop("playwright");
const data=mkdtempSync(join(tmpdir(),"camacho-hardware-lab-"));
const installation="018f0000-0000-7000-8000-0000000000a2",device="018f0000-0000-7000-8000-0000000000a3";
const secret=loadOrCreateWindowsLocalChannelSecret(data,installation).toString("hex");
const evidence=resolve(root,"artifacts/hardware/2026-10-21");mkdirSync(evidence,{recursive:true});
const service=spawn(process.execPath,[local.resolve("tsx/cli"),join(root,"apps/pos-local-service/e2e-host/real-service-host.ts")],{
  windowsHide:true,stdio:["pipe","pipe","pipe","ipc"],env:{...process.env,NODE_ENV:"test",
    POS_E2E_DATA_DIR:data,POS_E2E_CHANNEL_SECRET:secret,POS_E2E_INSTALLATION_ID:installation,POS_E2E_DEVICE_ID:device,
    POS_E2E_TENANT_ID:"018f0000-0000-7000-8000-0000000000a4",POS_E2E_COMPANY_ID:"018f0000-0000-7000-8000-0000000000a5",
    POS_E2E_BRANCH_ID:"018f0000-0000-7000-8000-0000000000a6",POS_E2E_USER_ID:"018f0000-0000-7000-8000-0000000000a1",POS_E2E_REGISTER_ID:"018f0000-0000-7000-8000-00000000aa01"},
});
let app:any;
try{
  const ready=await new Promise<any>((ok,fail)=>{
    let buffer="";const timer=setTimeout(()=>fail(new Error("LAB_SERVICE_TIMEOUT")),30000);
    service.stdout!.on("data",chunk=>{buffer+=chunk.toString();const line=buffer.split("\n").find(x=>x.includes('"ready":true'));if(line){clearTimeout(timer);ok(JSON.parse(line));}});
    service.stderr!.on("data",chunk=>process.stderr.write(chunk));
    service.once("exit",code=>{clearTimeout(timer);fail(new Error(`LAB_SERVICE_EXIT_${code}`));});
  });
  const desktopEnvironment={...process.env};delete desktopEnvironment.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:desktop("electron"),args:[join(root,"apps/pos-desktop/e2e/real-channel-entry.mjs")],env:{...desktopEnvironment,POS_E2E_CHANNEL_ENDPOINT:ready.endpoint,POS_E2E_CHANNEL_SECRET:secret,POS_E2E_INSTALLATION_ID:installation,POS_E2E_DEVICE_ID:device}});
  const page=await app.firstWindow();
  await page.getByTestId("status-connected").waitFor();
  const activation=await page.evaluate(async(assertion:any)=>await (globalThis as any).posService["session.activate"]({protocol_version:"1.0.0",message_type:"session.activate",request_id:crypto.randomUUID(),correlation_id:crypto.randomUUID(),payload_schema_version:"1.0.0",payload:{session_assertion:assertion}}),ready.sessionAssertion);
  if(activation.status!=="SUCCEEDED")throw new Error("LAB_ACTIVATION_FAILED");
  await page.reload();
  await page.getByRole("button",{name:"Impresora y cajón",exact:true}).click();
  await page.getByRole("button",{name:"Detectar y diagnosticar",exact:true}).click();
  await page.getByTestId("hardware-panel").locator("pre").filter({hasText:"DIAGNOSED"}).waitFor();
  await app.evaluate(({BrowserWindow,app}:any)=>{
    BrowserWindow.getAllWindows()[0].setTitle("Camacho POS — LABORATORIO — identidades de prueba");
    if(app.commandLine.hasSwitch("no-sandbox"))throw new Error("SANDBOX_DISABLED");
  });
  await page.evaluate(()=>{const banner=document.createElement("p");banner.textContent="LABORATORIO AISLADO · SSA e identidad de prueba · Sin login comercial ni hardware físico validado";banner.setAttribute("role","note");document.body.prepend(banner);});
  const security=await app.evaluate(({BrowserWindow}:any)=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
  if(!security.sandbox||!security.contextIsolation||security.nodeIntegration)throw new Error("LAB_SECURITY_REGRESSION");
  const diagnostic=await page.getByTestId("hardware-panel").locator("pre").innerText();
  writeFileSync(join(evidence,"electron-hardware.json"),JSON.stringify({kind:"ISOLATED_LAB",security,diagnostic:JSON.parse(diagnostic),physicalTest:false,loginTest:false},null,2));
  await page.screenshot({path:join(evidence,"electron-hardware.png"),fullPage:true});
  console.log("LAB_VERIFIED: Electron sandbox + real channel + SQLite + native inventory. No commercial login or physical effect.");
  if(!process.argv.includes("--verify-and-close"))await new Promise<void>(done=>app.on("close",done));
}finally{
  if(app)await app.close();
  if(service.exitCode===null)await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>fail(new Error("LAB_SHUTDOWN_TIMEOUT")),10000);service.once("exit",()=>{clearTimeout(timer);done();});service.send("pos-e2e-shutdown");});
  rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
