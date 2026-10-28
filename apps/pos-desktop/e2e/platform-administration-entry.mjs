// Isolated test driver only. No product preload, Service or authority bypass.
import {app,BrowserWindow,session} from "electron";
import {connect} from "node:net";
import {resolve,join} from "node:path";
import {X509Certificate} from "node:crypto";
import {setTimeout as pause} from "node:timers/promises";
const dir=process.env.CAMACHO_PLATFORM_TEST_DIRECTORY,pipe=process.env.CAMACHO_PLATFORM_TEST_PIPE;
if(process.platform!=="win32"||!dir||!pipe?.startsWith("\\\\.\\pipe\\camacho-platform-test-"))throw Error("ISOLATED_PLATFORM_DRIVER_REQUIRED");
app.setPath("userData",resolve(dir,"profile"));
app.commandLine.appendSwitch("host-resolver-rules","MAP global.example.test 127.0.0.1, EXCLUDE localhost");
app.commandLine.appendSwitch("no-proxy-server");
async function wait(win,source,label){for(let i=0;i<200;i++){
  if(await win.webContents.executeJavaScript(source))return;
  const alerts=await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('[role=alert]')).map(e=>e.textContent)");
  if(alerts.length)throw Error("PLATFORM_UI_REJECTED_"+label+" "+JSON.stringify(alerts));
  await pause(100);
}throw Error("PLATFORM_UI_TIMEOUT_"+label);}
async function run(){
  process.stderr.write("PLATFORM_TEST_CONNECT\n");
  const chunks=[];for await(const b of connect(pipe)){chunks.push(b);if(chunks.reduce((n,c)=>n+c.length,0)>32768)throw Error("PLATFORM_TEST_INPUT_TOO_LARGE");}
  process.stderr.write("PLATFORM_TEST_INPUT_RECEIVED\n");
  const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));chunks.forEach(b=>b.fill(0));
  if(new URL(input.origin).hostname!=="global.example.test")throw Error("PLATFORM_TEST_ORIGIN_REQUIRED");
  await app.whenReady();
  process.stderr.write("PLATFORM_TEST_READY\n");
  const partition=session.fromPartition("platform-test-only");
  partition.setCertificateVerifyProc((request,done)=>{
    let ok=false;try{ok=request.hostname==="global.example.test"&&new X509Certificate(request.certificate.data).fingerprint256===input.fingerprint;}catch{}
    done(ok?0:-3);
  });
  const win=new BrowserWindow({show:false,width:1200,height:950,webPreferences:{partition:"platform-test-only",sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  process.stderr.write("PLATFORM_TEST_WINDOW\n");
  await win.loadURL("about:blank");
  const errors=[];win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)errors.push(String(message).slice(0,200));});
  win.webContents.debugger.attach("1.3");const cdp=(method,params)=>win.webContents.debugger.sendCommand(method,params);
  const requests=[];await cdp("Network.enable");win.webContents.debugger.on("message",(_event,method,data)=>{
    if(method==="Network.responseReceived"&&data.response.url.includes("/v1/platform/"))requests.push({path:new URL(data.response.url).pathname,status:data.response.status});
  });
  process.stderr.write("PLATFORM_TEST_NETWORK\n");
  await cdp("WebAuthn.enable");const authenticator=await cdp("WebAuthn.addVirtualAuthenticator",{options:{protocol:"ctap2",transport:"usb",hasResidentKey:false,
    hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await cdp("WebAuthn.addCredential",{authenticatorId:authenticator.authenticatorId,credential:{credentialId:input.credentialId,isResidentCredential:false,
    rpId:"global.example.test",privateKey:input.privateKey,signCount:input.counter}});input.privateKey="";
  process.stderr.write("PLATFORM_TEST_WEBAUTHN\n");
  await win.loadURL(input.origin+"/platform/");
  process.stderr.write("PLATFORM_TEST_LOADED\n");
  async function login(){
    await wait(win,"Boolean(document.querySelector('input[name=email]'))","LOGIN_ENTRY");
    await win.webContents.executeJavaScript("document.querySelector('input[name=email]').value="+JSON.stringify(input.email)+";document.querySelector('input[name=password]').value="+JSON.stringify(input.password)+";document.querySelector('button[type=submit]').click();");
    try{await wait(win,"Boolean(document.querySelector('[data-testid=admin-panel-superadmin]'))","GLOBAL_AUTHORIZATION");}
    catch(error){throw Error(error.message+" "+JSON.stringify({requests,alerts:await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('[role=alert]')).map(e=>e.textContent)"),errors}));}
  }
  await login();
  process.stderr.write("PLATFORM_TEST_AUTHENTICATED\n");
  const click=async(text)=>win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==="+JSON.stringify(text)+").click()");
  const selectPlan=async(code,status)=>{
    await win.webContents.executeJavaScript("(()=>{const select=document.querySelector('[aria-label=\"Plan del catálogo\"]');const option=Array.from(select.options).find(o=>o.textContent.includes("+JSON.stringify(code)+")&&o.textContent.includes("+JSON.stringify(status)+"));if(!option)throw Error('PLAN_NOT_RECOVERED');select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));})()");
  };
  const confirmPublish=async()=>{
    await wait(win,"document.querySelector('[aria-label=\"Confirmar publicación\"]')?.disabled===false","SELECTED_DRAFT");
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Confirmar publicación\"]').click()");
    await wait(win,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Publicar versión guardada'&&!b.disabled)","PUBLISH_READY");
    await click('Publicar versión guardada');
    await wait(win,"document.body.textContent.includes('Central publicó la versión del plan')","PUBLISHED");
  };
  await click('Preparar catálogo preproducción');
  await wait(win,"document.querySelectorAll('[data-admin-plan-code]').length===3","INITIAL_DRAFTS");
  for(const name of ['Mensual','Anual','Perpetuo']){await selectPlan(name,'Borrador');await confirmPublish();}
  const publicPartition=session.fromPartition('public-prices-test-only');
  publicPartition.setCertificateVerifyProc((request,done)=>{
    let ok=false;try{ok=request.hostname==='global.example.test'&&new X509Certificate(request.certificate.data).fingerprint256===input.fingerprint;}catch{}done(ok?0:-3);
  });
  const publicWindow=new BrowserWindow({show:false,webPreferences:{partition:'public-prices-test-only',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  await publicWindow.loadURL(input.origin+'/pricing/');
  await wait(publicWindow,"document.querySelector('[data-plan-code=CAMACHO_MONTHLY] [data-price-minor=\"4990000\"]')","INITIAL_PUBLIC_PRICE");
  const initial=await publicWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('[data-plan-code]')).map(e=>({code:e.dataset.planCode,minor:e.querySelector('[data-price-minor]').dataset.priceMinor}))");
  if(!initial.some(p=>p.code==='CAMACHO_ANNUAL'&&p.minor==='49900000')||!initial.some(p=>p.code==='CAMACHO_PERPETUAL'&&p.minor==='149000000'))throw Error('INITIAL_PRICES_INCORRECT');
  const beforeAssets=await publicWindow.webContents.executeJavaScript("Array.from(document.scripts).map(s=>s.src).join('|')");
  await selectPlan('Mensual','Publicado');
  await win.webContents.executeJavaScript("document.querySelector('[name=price_minor]').value='59.900';document.querySelector('button[type=submit]').click()");
  await wait(win,"document.querySelector('[data-testid=offer-preview]')","PRICE_PREVIEW");
  await click('Guardar borrador');
  await wait(win,"document.body.textContent.includes('Central guardó el borrador')","DRAFT_PERSISTED");
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await login();
  await selectPlan('Mensual','Borrador');await confirmPublish();
  await publicWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Actualizar precios').click()");
  await wait(publicWindow,"document.querySelector('[data-plan-code=CAMACHO_MONTHLY] [data-price-minor=\"5990000\"]')","PRICE_UPDATED_WITHOUT_BUILD");
  const afterAssets=await publicWindow.webContents.executeJavaScript("Array.from(document.scripts).map(s=>s.src).join('|')");
  if(beforeAssets!==afterAssets)throw Error('PRICE_UPDATE_CHANGED_ASSETS');
  if((await publicPartition.cookies.get({url:input.origin})).length!==0)throw Error('PUBLIC_CATALOG_USED_SESSION');
  await wait(win,"document.querySelector('[data-admin-plan-code=CAMACHO_MONTHLY] strong')?.textContent.includes('59.900')","ADMIN_PRICE_REFRESHED");
  publicWindow.destroy();
  const storage=await win.webContents.executeJavaScript("({local:localStorage.length,session:sessionStorage.length,preload:typeof window.pos})");
  if(storage.local!==0||storage.session!==0||storage.preload!=="undefined")throw Error("PLATFORM_RENDERER_ISOLATION_FAILED");
  const cookies=await partition.cookies.get({url:input.origin});
  if(!cookies.some(c=>c.name==="__Host-camacho_platform"&&c.httpOnly&&c.secure))throw Error("PLATFORM_COOKIE_SECURITY_FAILED");
  const {writeFile}=await import("node:fs/promises");await writeFile(join(dir,"platform-published.png"),(await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cerrar sesión GLOBAL').click()");
  await wait(win,"document.body.textContent.includes('Central confirmó el cierre de sesión')","LOGOUT");
  input.password="";
  process.stdout.write(JSON.stringify({platformUi:true,draftRecovered:true,published:true,dynamicPrice:true,publicUnauthenticated:true,noRecompile:true,logout:true,storage,consoleErrors:errors})+"\n");
  win.destroy();app.quit();
}
run().catch(error=>{process.stderr.write(String(error?.stack??error)+"\n");app.exit(1);});
