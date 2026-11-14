import { test, expect } from "@playwright/test";
import { _electron } from "playwright";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const desktop=join(root,"apps","pos-desktop");
const serviceRoot=join(root,"apps","pos-local-service");
const requireDesktop=createRequire(join(desktop,"package.json"));
const requireService=createRequire(join(serviceRoot,"package.json"));

test.skip(process.platform!=="win32","Physical Windows DPAPI/named-pipe login required");
test("real Electron login -> backend RBAC -> SQLite catalogue -> logout -> cashier isolation", async()=>{
  test.setTimeout(180_000);
  const dir=mkdtempSync(join(tmpdir(),"camacho-real-operator-"));
  const dataDirectory=join(dir,"data");
  mkdirSync(dataDirectory,{recursive:true});
  const usernames=[
    ["admin.local","ADMINISTRADOR"],
    ["supervisor.local","SUPERVISOR"],
    ["cajero.local","CAJERO"],
    ["superadmin.local","SUPERADMINISTRADOR"],
  ] as const;
  const passwords=new Map<string,string>();
  const accounts=usernames.map(([username,role])=>{
    const password=randomBytes(24).toString("base64url");
    passwords.set(username,password);
    const salt=randomBytes(16).toString("hex");
    const hash=scryptSync(password,Buffer.from(salt,"hex"),64,
      {N:32768,r:8,p:1,maxmem:64*1024*1024}).toString("hex");
    return {username,role,scheme:"scrypt-N32768-r8-p1-v1",salt,hash};
  });
  const store=join(dir,"accounts.v1.json");
  writeFileSync(store,JSON.stringify({format:"CAMACHO_DEV_ACCOUNTS_V1",accounts}),"utf8");
  const ids={installation:randomUUID(),device:randomUUID(),tenant:randomUUID(),
    company:randomUUID(),branch:randomUUID()};
  const cleanEnv=Object.fromEntries(Object.entries(process.env)
    .filter((entry):entry is [string,string]=>entry[1]!==undefined &&
      !entry[0].startsWith("POS_")&&entry[0]!=="ELECTRON_RUN_AS_NODE"));
  const env={...cleanEnv,NODE_ENV:"development",POS_DATA_DIRECTORY:dataDirectory,
    POS_INSTALLATION_ID:ids.installation,POS_DEVICE_ID:ids.device,
    POS_TENANT_ID:ids.tenant,POS_COMPANY_ID:ids.company,POS_BRANCH_ID:ids.branch,
    POS_PROTOCOL_MIN:"1.0.0",POS_PROTOCOL_MAX:"1.0.0",POS_SERVICE_VERSION:"1.0.0",
    POS_LOCAL_OPERATOR_AUTH_STORE:store};
  let service:ChildProcessWithoutNullStreams|undefined;
  let electron:Awaited<ReturnType<typeof _electron.launch>>|undefined;
  const startService=async():Promise<ChildProcessWithoutNullStreams>=>{
    const child=spawn(process.execPath,[requireService.resolve("tsx/cli"),join(serviceRoot,"src","main.ts")],
      {cwd:serviceRoot,env,stdio:["pipe","pipe","pipe"]});
    await new Promise<void>((resolveReady,reject)=>{
      let buffer="";
      let stderr="";
      let settled=false;
      const done=(error?:Error)=>{
        if(settled)return;
        settled=true;
        clearTimeout(timeout);
        error?reject(error):resolveReady();
      };
      const timeout=setTimeout(()=>done(new Error("LOCAL_SERVICE_BOOT_TIMEOUT:"+stderr.slice(-1200))),30000);
      child.stdout.on("data",(chunk:Buffer)=>{
        buffer+=chunk.toString("utf8");
        if(buffer.includes('"event":"runtime.started"'))done();
      });
      child.stderr.on("data",(chunk:Buffer)=>{stderr+=chunk.toString("utf8");});
      child.once("exit",code=>done(new Error("LOCAL_SERVICE_EARLY_EXIT_"+code+":"+stderr.slice(-1200))));
    });
    return child;
  };
  try{
    service=await startService();
    electron=await _electron.launch({executablePath:requireDesktop("electron") as string,
      args:[join(desktop,"dist","start.bundle.mjs")],env});
    const page=await electron.firstWindow();
    await expect(page.getByRole("heading",{name:"Ingresar al POS",level:3})).toBeVisible({timeout:20000});
    await page.locator("#pos-local-username").selectOption("admin.local");
    await page.locator("#pos-local-password").fill(passwords.get("admin.local")!);
    await page.getByRole("button",{name:"Ingresar",exact:true}).click();
    await expect(page.locator(".pos-nav")).toBeVisible({timeout:20000});
    await expect(page.getByRole("button",{name:"Catálogo",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Inventario",exact:true})).toBeVisible();
    console.log("REAL_LOCAL_ADMIN_PANEL=PASS");

    const call=async(message_type:string,payload:Record<string,unknown>,mutation=false)=>{
      return page.evaluate(async({message_type,payload,mutation})=>{
        const api=(window as unknown as {posService:Record<string,(x:unknown)=>Promise<unknown>>}).posService;
        return api[message_type]!({protocol_version:"1.0.0",message_type,
          request_id:crypto.randomUUID(),correlation_id:crypto.randomUUID(),
          payload_schema_version:"1.0.0",...(mutation?{
            operation_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()}:{}),payload});
      },{message_type,payload,mutation}) as Promise<{status:string;result_code:string;result?:{outcome?:string}}>;
    };
    const barcode="770"+String(Math.floor(Math.random()*1e10)).padStart(10,"0");
    const registered=await call("catalog.product.register",{
      code:"LOCAL-WINDOWS-TEST",name:"Producto verificado en SQLite real",
      stock_controlled:false,presentation_name:"Unidad",unit_code:"UND",
      unit_precision:0,barcode,price_amount:"2500.000000",currency_code:"COP",
    },true);
    expect(registered.status).toBe("SUCCEEDED");
    expect(registered.result?.outcome).toBe("REGISTERED");
    console.log("REAL_LOCAL_SQLITE_CATALOG_WRITE=PASS");

    await page.getByRole("button",{name:"Cerrar sesión",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Ingresar al POS",level:3})).toBeVisible({timeout:20000});
    const denied=await call("inventory.stock.get",{presentation_id:randomUUID()});
    expect(denied.status).toBe("REJECTED");
    expect(denied.result_code).toBe("SESSION_NOT_BOUND");
    console.log("REAL_LOCAL_LOGOUT_DENIAL=PASS");

    await page.locator("#pos-local-username").selectOption("cajero.local");
    await page.locator("#pos-local-password").fill(passwords.get("cajero.local")!);
    await page.getByRole("button",{name:"Ingresar",exact:true}).click();
    await expect(page.locator(".pos-nav")).toBeVisible({timeout:20000});
    await expect(page.getByRole("button",{name:"Caja y ventas",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Inventario",exact:true})).toHaveCount(0);
    const restricted=await call("inventory.stock.get",{presentation_id:randomUUID()});
    expect(restricted.status).toBe("REJECTED");
    expect(restricted.result_code).toBe("UNAUTHORIZED");
    console.log("REAL_LOCAL_CASHIER_BACKEND_DENIAL=PASS");

    // Restart both production processes against the EXACT SAME SQLite folder.
    // No local identity is auto-restored; the product written above survives.
    await electron.close();
    electron=undefined;
    const priorService=service;
    const exited=new Promise<void>((resolveExit,reject)=>{
      const timeout=setTimeout(()=>reject(Error("LOCAL_SERVICE_RESTART_SHUTDOWN_TIMEOUT")),15000);
      priorService.once("exit",()=>{clearTimeout(timeout);resolveExit();});
    });
    priorService.kill();
    await exited;
    service=await startService();
    electron=await _electron.launch({executablePath:requireDesktop("electron") as string,
      args:[join(desktop,"dist","start.bundle.mjs")],env});
    const afterRestart=await electron.firstWindow();
    await expect(afterRestart.getByRole("heading",{name:"Ingresar al POS",level:3}))
      .toBeVisible({timeout:20000});
    await expect(afterRestart.locator(".pos-nav")).toHaveCount(0);
    await afterRestart.locator("#pos-local-username").selectOption("admin.local");
    await afterRestart.locator("#pos-local-password").fill(passwords.get("admin.local")!);
    await afterRestart.getByRole("button",{name:"Ingresar",exact:true}).click();
    await expect(afterRestart.locator(".pos-nav")).toBeVisible({timeout:20000});
    const found=await afterRestart.evaluate(async value=>{
      const api=(window as unknown as {posService:Record<string,(x:unknown)=>Promise<unknown>>}).posService;
      return api["catalog.item.find"]!({protocol_version:"1.0.0",message_type:"catalog.item.find",
        request_id:crypto.randomUUID(),correlation_id:crypto.randomUUID(),payload_schema_version:"1.0.0",
        payload:{barcode:value}});
    },barcode) as {status:string;result_code:string;result?:{presentation_id:string}};
    expect(found.status).toBe("SUCCEEDED");
    expect(found.result?.presentation_id).toMatch(/^[0-9a-f-]{36}$/);
    console.log("REAL_LOCAL_SQLITE_PERSISTENCE_AFTER_RESTART=PASS");
    console.log("REAL_LOCAL_RELOGIN_REQUIRED_AFTER_RESTART=PASS");
  } finally {
    await electron?.close().catch(()=>undefined);
    service?.kill();
    try{rmSync(dir,{force:true,recursive:true,maxRetries:10,retryDelay:250});}catch{/* Windows file locks may linger */}
  }
});
