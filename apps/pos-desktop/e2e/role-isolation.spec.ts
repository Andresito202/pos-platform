import {test,expect} from "@playwright/test";
import {_electron,type ElectronApplication} from "playwright";
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,mkdirSync,lstatSync,openSync,closeSync,unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {loadOrCreateWindowsLocalChannelSecret} from "@pos-platform/local-channel";

// Integration of actual Electron renderer/preload/socket/CommercialRequestHandler/SQLite
// with a temporary signed role snapshot. NOT a login or Central BUSINESS issuance.
const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const roles=["CAJERO","SUPERVISOR","ADMINISTRADOR","SUPERADMINISTRADOR"] as const;
const installation="018f0000-0000-7000-8000-0000000000a2";
const device="018f0000-0000-7000-8000-0000000000a3";
const role=process.env.POS_E2E_ROLE;
if(role!==undefined&&!roles.includes(role as typeof roles[number]))throw Error("ROLE_E2E_UNRECOGNIZED_PROFILE");
test.skip(role===undefined,"Explicit POS_E2E_ROLE required for this laboratory test");
test.skip(process.platform!=="win32","Windows role E2E requires real DPAPI/named-pipe backend");
test("role-scoped menus and server decisions follow signed authorization, not a renderer role switch",async()=>{
  if(process.env.POS_E2E_INTERACTIVE==="1")test.setTimeout(0);
  const durable=process.env.POS_E2E_PERSISTENT_DEV==="1";
  if(durable&&(process.platform!=="win32"||!process.env.POS_E2E_INTERACTIVE||
     process.env.CI||!process.env.LOCALAPPDATA))throw Error("PERSISTENT_PREVIEW_REQUIRES_LOCAL_WINDOWS_INTERACTIVE");
  const workspace=join(process.env.LOCALAPPDATA??tmpdir(),"CamachoPOS","development","role-data");
  if(durable){
    let path=resolve(process.env.LOCALAPPDATA!);
    for(const part of ["CamachoPOS","development","role-data",role!]){
      path=join(path,part);
      mkdirSync(path,{recursive:false});
      if(lstatSync(path).isSymbolicLink())throw Error("DEV_DATA_SYMLINK_REJECTED");
    }
  }
  const dir=durable?join(workspace,role!):mkdtempSync(join(tmpdir(),"camacho-e2e-role-"));
  let lockFd:number|undefined;
  const lock=join(dir,".camacho-preview.lock");
  if(durable)lockFd=openSync(lock,"wx",0o600);
  const serviceRoot=join(here,"..","..","pos-local-service");
  let service:ChildProcessWithoutNullStreams|undefined;
  let app:ElectronApplication|undefined;
  try{
    const secret=(process.platform==="win32"?loadOrCreateWindowsLocalChannelSecret(dir,installation):randomBytes(32)).toString("hex");
    service=spawn(process.execPath,[createRequire(join(serviceRoot,"package.json")).resolve("tsx/cli"),join(serviceRoot,"e2e-host","real-service-host.ts")],{
      cwd:serviceRoot,stdio:["pipe","pipe","pipe","ipc"],
      env:{...process.env,NODE_ENV:"test",POS_E2E_ROLE:role,POS_E2E_DATA_DIR:dir,POS_E2E_CHANNEL_SECRET:secret,POS_E2E_PERSISTENT_DEV:durable?"1":"0",
        POS_E2E_TENANT_ID:"018f0000-0000-7000-8000-0000000000a4",
        POS_E2E_COMPANY_ID:"018f0000-0000-7000-8000-0000000000a5",
        POS_E2E_BRANCH_ID:"018f0000-0000-7000-8000-0000000000a6",
        POS_E2E_INSTALLATION_ID:installation,POS_E2E_DEVICE_ID:device,
        POS_E2E_USER_ID:"018f0000-0000-7000-8000-0000000000a1",
        POS_E2E_REGISTER_ID:"018f0000-0000-7000-8000-00000000aa01"}
    }) as ChildProcessWithoutNullStreams;
    const activeService=service;
    const ready=await new Promise<{endpoint:string;sessionAssertion:unknown}>((resolve,reject)=>{
      let buffer="";
      const timeout=setTimeout(()=>reject(Error("ROLE_E2E_SERVICE_TIMEOUT")),30000);
      activeService.stdout.on("data",(chunk:Buffer)=>{
        buffer+=chunk.toString("utf8");
        const line=buffer.split("\n").find(x=>x.includes('"ready"'));
        if(!line)return;
        clearTimeout(timeout);
        try{resolve(JSON.parse(line) as {endpoint:string;sessionAssertion:unknown});}catch(e){reject(e);}
      });
      activeService.stderr.on("data",(chunk:Buffer)=>process.stderr.write(chunk));
      activeService.once("exit",code=>{clearTimeout(timeout);reject(Error("ROLE_E2E_SERVICE_EXIT_"+code));});
    });
    const launchEnv=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined&&entry[0]!=="ELECTRON_RUN_AS_NODE"));
    app=await _electron.launch({executablePath:require("electron") as string,
      args:[join(here,"real-channel-entry.mjs")],
      env:{...launchEnv,POS_E2E_CHANNEL_ENDPOINT:ready.endpoint,POS_E2E_CHANNEL_SECRET:secret,
        POS_E2E_INSTALLATION_ID:installation,POS_E2E_DEVICE_ID:device}});
    const page=await app.firstWindow();
    await expect(page.getByTestId("authorization-unauthenticated")).toBeVisible();
    const activated=await page.evaluate(async assertion=>{
      const api=(globalThis as unknown as {posService:Record<string,(request:unknown)=>Promise<unknown>>}).posService;
      return api["session.activate"]!({protocol_version:"1.0.0",message_type:"session.activate",
        request_id:crypto.randomUUID(),correlation_id:crypto.randomUUID(),payload_schema_version:"1.0.0",
        payload:{session_assertion:assertion}});
    },ready.sessionAssertion);
    expect(activated).toMatchObject({status:"SUCCEEDED"});
    await page.reload();
    const authorized=role!=="SUPERADMINISTRADOR";
    if(authorized){
      await expect(page.locator(".pos-nav")).toBeVisible();
    }else{
      await expect(page.getByTestId("no-authorized-screens")).toBeVisible();
      await expect(page.locator(".pos-nav button")).toHaveCount(0);
    }
    const names=await page.locator(".pos-nav button").allTextContents();
    const has=(name:string)=>names.includes(name);
    const request=async(message_type:string,payload:unknown)=>{
      return page.evaluate(async ({message_type,payload})=>{
        const api=(globalThis as unknown as {posService:Record<string,(request:unknown)=>Promise<unknown>>}).posService;
        return api[message_type]!({protocol_version:"1.0.0",message_type,
          request_id:crypto.randomUUID(),correlation_id:crypto.randomUUID(),
          payload_schema_version:"1.0.0",payload});
      },{message_type,payload});
    };
    // Verify service-side denial even if someone invokes the allowed preload
    // RPC directly: client-side visibility is NOT an authorization boundary.
    const inventory=await request("inventory.stock.get",{presentation_id:randomUUID()}) as {result_code:string;status:string};
    if(role==="CAJERO"||role==="SUPERADMINISTRADOR"){
      expect(inventory.status).toBe("REJECTED");
      expect(has("Inventario")).toBe(false);
    }else{
      expect(inventory.result_code).not.toBe("PERMISSION_DENIED");
      expect(has("Inventario")).toBe(true);
    }
    if(role==="CAJERO"||role==="SUPERVISOR"||role==="ADMINISTRADOR")expect(has("Caja y ventas")).toBe(true);
    if(role==="SUPERADMINISTRADOR")expect(has("Caja y ventas")).toBe(false);
    if(role==="CAJERO")expect(has("Impresora y cajón")).toBe(false);
    if(role==="ADMINISTRADOR")expect(has("Impresora y cajón")).toBe(true);
    console.log("ROLE_E2E_ISOLATED="+role+":PASS");
    if(process.env.POS_E2E_INTERACTIVE==="1"){
      // Interactive UI preview is strictly test-only, without live Central
      // identity or commercial payments. Visual banner is never shipped.
      await page.evaluate(({profile,durable})=>{
        const banner=document.createElement("div");
        banner.textContent="LABORATORIO LOCAL · "+profile+" · "+(durable?"DATOS DE DESARROLLO PERSISTENTES":"DATOS TEMPORALES")+" · NO ES LOGIN COMERCIAL";
        banner.setAttribute("role","status");
        Object.assign(banner.style,{position:"fixed",left:"0",right:"0",bottom:"0",zIndex:"2147483647",
          background:"#5b210a",color:"#fff",padding:"9px",fontSize:"13px",fontWeight:"bold",textAlign:"center"});
        document.body.appendChild(banner);
      },{profile:role,durable});
      console.log("ROLE_PREVIEW_OPEN="+role+(durable?" (profile-scoped development SQLite retained)":" (temporary data deleted on close)"));
      await new Promise<void>(resolve=>app!.once("close",()=>resolve()));
    }
  }finally{
    await app?.close().catch(()=>undefined);
    if(service&&service.exitCode===null){
      const child=service;
      await new Promise<void>(resolve=>{
        const timer=setTimeout(()=>{child.kill();resolve();},10000);
        child.once("exit",()=>{clearTimeout(timer);resolve();});
        child.send?.("pos-e2e-shutdown");
      });
    }
    if(durable){
      if(lockFd!==undefined)closeSync(lockFd);
      // Only the lease marker is released. Local SQLite is never erased by
      // this preview and must not be mistaken for an enrolled commercial DB.
      if(lockFd!==undefined)unlinkSync(lock);
    }else rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
