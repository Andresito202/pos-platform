// Isolated integration driver. Never loaded by production-entry.
// Exercises real Electron + Windows service + HTTPS browser + Chromium WebAuthn.
import { app, BrowserWindow, safeStorage, session } from "electron";
import { resolve, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { connect } from "node:net";
import { X509Certificate,createPrivateKey } from "node:crypto";
import {request as httpsRequest} from "node:https";

const directory = process.env.CAMACHO_BROWSER_TEST_DIRECTORY;
const port = Number(process.env.CAMACHO_BROWSER_TEST_PORT);
if (process.platform !== "win32" || !directory || !Number.isSafeInteger(port) || port < 1) throw Error("ISOLATED_BROWSER_DRIVER_REQUIRED");
app.setPath("userData", resolve(directory, "electron-profile"));
app.commandLine.appendSwitch("host-resolver-rules", `MAP business.example.test 127.0.0.1:${port}, EXCLUDE localhost`);
app.commandLine.appendSwitch("no-proxy-server");

async function waitFor(check, label) {
  for (let i = 0; i < 200; i++) { const result = await check(); if (result) return result; await pause(100); }
  throw Error(`BROWSER_INTEGRATION_TIMEOUT_${label}`);
}

async function run() {
  const chunks = [];
  const pipe = process.env.CAMACHO_BROWSER_TEST_PIPE;
  if (!pipe?.startsWith("\\\\.\\pipe\\camacho-browser-test-")) throw Error("BROWSER_TEST_PIPE_REQUIRED");
  const inputSocket = connect(pipe);
  for await (const chunk of inputSocket) { chunks.push(chunk); if (chunks.reduce((n, b) => n + b.length, 0) > 32768) throw Error("BROWSER_TEST_INPUT_TOO_LARGE"); }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stderr.write("BROWSER_DRIVER_INPUT_READY\n");
  chunks.forEach(chunk => chunk.fill(0));
  await import("../dist/start.bundle.mjs");
  await app.whenReady();
  const pos = await waitFor(async () => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith("file:"));
    return window && await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=authorization-unauthenticated]"))') ? window : null;
  }, "POS_BOOT");
  process.stderr.write("BROWSER_DRIVER_POS_READY\n");
  if(input.issuedAssertion){
    const {exerciseNativeAssertion}=await import("../dist/ssa-native-transport-probe.mjs");
    const observed=await exerciseNativeAssertion(input.issuedAssertion);
    if(observed.activated!=="ACTIVATED"||observed.replay!=="REJECTED"||observed.recovered!=="ACTIVE"||
      observed.capabilities.result_code!=="AUTHORIZATION_SNAPSHOT_UNAVAILABLE")throw Error("SSA_DELIVERY_BOUNDARY_FAILED");
    await pos.webContents.executeJavaScript('document.querySelector("button").click()');
    await waitFor(()=>pos.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=authorization-error]")) && !document.querySelector(".pos-shell")'),"SSA_WITHOUT_GRANTS");
    if(process.env.POS_E2E_AUDIT_DIRECTORY){
      const {mkdir,writeFile}=await import("node:fs/promises");
      await mkdir(process.env.POS_E2E_AUDIT_DIRECTORY,{recursive:true});
      await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY,"ssa-active-without-grants.png"),(await pos.capturePage()).toPNG());
    }
    process.stdout.write(JSON.stringify({browserIntegration:true,scope:"ISOLATED_VALIDATION",nativeSsa:observed,grantsFabricated:false,dashboardClosed:true})+"\n");
    app.quit();return;
  }
  const partition = session.fromPartition("browser-integration-only");
  // Trust only the ephemeral fixture certificate and exact hostname, never a
  // wildcard/global --ignore-certificate-errors or a persistent OS root change.
  partition.setCertificateVerifyProc((request, done) => {
    let accepted = false;
    try { accepted = request.hostname === "business.example.test" &&
      new X509Certificate(request.certificate.data).fingerprint256 === input.certificateFingerprint; } catch { /* reject */ }
    done(accepted ? 0 : -3);
  });
  const browser = new BrowserWindow({ width: 1100, height: 850, webPreferences: {
    partition: "browser-integration-only", sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
  } });
  browser.webContents.debugger.attach("1.3");
  const cdp = (method, params) => browser.webContents.debugger.sendCommand(method, params);
  await cdp("WebAuthn.enable");
  process.stderr.write("BROWSER_DRIVER_WEBAUTHN_READY\n");
  const authenticator = await cdp("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "usb", hasResidentKey: false, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await cdp("WebAuthn.addCredential", { authenticatorId: authenticator.authenticatorId, credential: {
    credentialId: input.credentialId, isResidentCredential: false, rpId: "business.example.test",
    privateKey: input.privateKey, signCount: input.counter,
  } });
  input.privateKey = "";
  const { beginNativeBusinessLogin, NativeBusinessCredentialVault, exchangeNativeBusinessCode } = await import("../dist/native-browser-login-probe.mjs");
  const Vault=input.privilegedService?(await import("../dist/ssa-native-transport-probe.mjs")).NativeBusinessCredentialVault:NativeBusinessCredentialVault;
  const vault = new Vault(safeStorage);
  let nativePost;
  if(input.nativeBinding){
    const {createDeviceRequestAuthorization}=await import("../dist/device-proof-lab-probe.mjs");
    const {uuidV7}=await import("../dist/ssa-native-transport-probe.mjs");
    const deviceKey=createPrivateKey(input.nativeBinding.devicePrivatePem);input.nativeBinding.devicePrivatePem="";
    nativePost=async(path,payload,signed=true,access,testPhase)=>{
      const serviceSas=path==="__SAS_SERVICE_REQUEST__";
      if(serviceSas)path="/v1/business-session/authorization";
      const body=JSON.stringify(payload),requestId=uuidV7(),correlationId=uuidV7();
      const headers={host:"business.example.test","content-type":"application/json","content-length":Buffer.byteLength(body),
        ...(signed?{authorization:createDeviceRequestAuthorization({method:"POST",path,requestId,correlationId,body,
          credentialId:input.nativeBinding.deviceCredentialId},deviceKey),"x-request-id":requestId,"x-correlation-id":correlationId}:{}),
        ...(access?{"x-isolated-business-access":access}:{})};
      if(serviceSas)return new Promise((resolve,reject)=>{
        const socket=connect(pipe);let response="";
        socket.setTimeout(10000,()=>socket.destroy(Error("SAS_SERVICE_TIMEOUT")));socket.on("error",reject);
        socket.on("connect",()=>socket.write(JSON.stringify({mode:"ISOLATED_VALIDATION",port,ca:input.nativeBinding.ca,accessToken:access,
          authorization:headers.authorization,requestId,correlationId,body,timeoutMs:5000,testPhase})+"\n"));
        socket.on("data",chunk=>{response+=chunk;});socket.on("end",()=>{try{resolve(JSON.parse(response));}catch(e){reject(e);}});
      });
      return new Promise((resolve,reject)=>{
        const req=httpsRequest({host:"127.0.0.1",port,servername:"business.example.test",ca:input.nativeBinding.ca,
          method:"POST",path,headers,agent:false},res=>{
          let raw="";res.on("data",chunk=>{raw+=chunk;if(raw.length>32768)res.destroy();});res.on("error",reject);
          res.on("end",()=>{process.stderr.write("NATIVE_LAB_RESPONSE_"+path.split("/").at(-1)+"_"+res.statusCode+"\n");
            if(res.statusCode!==200){reject(Error("NATIVE_LAB_HTTP_"+res.statusCode));return;}
            try{resolve(JSON.parse(raw));}catch(e){reject(e);}});
        });req.setTimeout(5000,()=>req.destroy(Error("NATIVE_LAB_TIMEOUT")));req.on("error",reject);req.end(body);
      });
    };
  }
  const privileged=input.privilegedService?await import("../dist/ssa-native-transport-probe.mjs"):undefined;
  const nativeConnection=privileged?await privileged.openNativeServiceChannel():undefined;
  const account=privileged?new privileged.DesktopCommercialAccount({registration:input.registration,attempt_timeout_ms:60_000},async()=>nativeConnection.channel,vault,url=>browser.loadURL(url)):undefined;
  const attempt = account?{result:account.login(),cancel:()=>account.stop()}:await beginNativeBusinessLogin({ registration: input.registration, timeoutMs: 60_000, vault,
    openSystemBrowser: url => browser.loadURL(url),
    ...(nativePost?{prepareAuthorization:async parameters=>{
      const challenge=await nativePost("/v1/commercial/native-request-challenges",parameters,false);
      const request=await nativePost("/v1/commercial/native-requests",{...parameters,purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",
        challenge_id:challenge.challenge_id,challenge:challenge.challenge});return request.authorization_url;
    }}:{}),
    exchange: (registration, request) => nativePost?nativePost("/v1/commercial/token",{grant_type:"authorization_code",code:request.code,
      code_verifier:request.verifier,state:request.state,client_id:registration.clientId,redirect_uri:registration.redirectUri}):exchangeNativeBusinessCode(registration, request, 5_000),
  });
  process.stderr.write("BROWSER_DRIVER_NATIVE_STARTED\n");
  try {
    await Promise.race([waitFor(() => browser.webContents.executeJavaScript('Boolean(document.querySelector("#login"))'), "HTTPS_FORM"),
      attempt.result.then(status=>{throw Error("NATIVE_ATTEMPT_ENDED_BEFORE_FORM_"+status);})]);
    process.stderr.write("BROWSER_DRIVER_FORM_READY\n");
    const visible = await browser.webContents.executeJavaScript(`({secure:window.isSecureContext,origin:location.origin,node:typeof require,bridge:typeof window.posService})`);
    if (!visible.secure || visible.origin !== "https://business.example.test" || visible.node !== "undefined" || visible.bridge !== "undefined") throw Error("BROWSER_ORIGIN_ISOLATION_FAILED");
    if(process.env.POS_E2E_AUDIT_DIRECTORY){
      const {mkdir,writeFile}=await import("node:fs/promises");
      await mkdir(process.env.POS_E2E_AUDIT_DIRECTORY,{recursive:true});
      // Capture before filling either credential field; no secrets in evidence.
      await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY,"central-https-login.png"),(await browser.capturePage()).toPNG());
    }
    await browser.webContents.executeJavaScript(`(() => {
      window.__labPhases=[];
      new MutationObserver(() => window.__labPhases.push(document.querySelector("#status").dataset.phase))
        .observe(document.querySelector("#status"), {attributes:true,attributeFilter:["data-phase"]});
    })()`);
    // A wrong password must reach the actual password verifier first.
    const submit = async password => browser.webContents.executeJavaScript(`(() => {
      const form=document.querySelector("#login"); form.elements.email.value=${JSON.stringify(input.email)};
      form.elements.password.value=${JSON.stringify(password)}; form.requestSubmit();
    })()`);
    await submit("incorrect-" + input.password);
    await waitFor(() => browser.webContents.executeJavaScript('document.querySelector("#status").dataset.phase === "REJECTED"'), "WRONG_PASSWORD");
    process.stderr.write("BROWSER_DRIVER_WRONG_PASSWORD_REJECTED\n");
    await submit(input.password);
    input.password = "";
    const phase = await waitFor(async () => {
      const phase = await browser.webContents.executeJavaScript('document.querySelector("#status").dataset.phase');
      if (phase === "REJECTED") throw Error("REAL_BROWSER_ASSERTION_REJECTED");
      return phase === "BUSINESS_VERIFIED" ? phase : null;
    }, "REAL_WEBAUTHN_BUSINESS");
    process.stderr.write("BROWSER_DRIVER_BUSINESS_VERIFIED\n");
    const erased = await browser.webContents.executeJavaScript('document.querySelector("[name=password]").value === "" && localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ""');
    const protectedCookie = (await partition.cookies.get({url:"https://business.example.test"})).some(cookie => cookie.httpOnly && cookie.secure);
    if (!protectedCookie) throw Error("BROWSER_COOKIE_PROTECTION_MISSING");
    if(nativePost||privileged){
      const destination=await browser.webContents.executeJavaScript('document.querySelector("#destination").textContent');
      if(!destination.includes(input.deviceId)||!destination.includes(input.installationId))throw Error("NATIVE_DESTINATION_NOT_DISPLAYED");
      await browser.webContents.executeJavaScript('document.querySelector("#confirm").click()');
      process.stderr.write("BROWSER_DRIVER_DESTINATION_CONFIRMED\n");
      if(privileged){
        if(input.nativeBinding)throw Error("PRIVATE_DEVICE_MATERIAL_REACHED_MAIN");
        if(await attempt.result!=="SESSION_ACTIVATED")throw Error("SERVICE_NATIVE_SESSION_NOT_ACTIVATED");
        await nativeConnection.close();
        const observed=await privileged.inspectNativeAuthorization();
        if(observed.recovery.result_code!=="ACTIVE"||observed.capabilities.result.permissions.join()!=="AUDIT_EVENT_READ"||observed.forbidden.result_code!=="UNAUTHORIZED")throw Error("SERVICE_NATIVE_CAPABILITIES_REJECTED");
        await pos.webContents.executeJavaScript('document.querySelector("button").click()');
        await waitFor(()=>pos.webContents.executeJavaScript('Boolean(document.querySelector(".pos-shell"))'),"SERVICE_CUSTODY_DASHBOARD");
        if(process.env.POS_E2E_AUDIT_DIRECTORY){
          const {writeFile,mkdir}=await import("node:fs/promises");
          // Focusing the POS legitimately revalidates capabilities. Wait for
          // that transition and painted frames before recording the dashboard.
          pos.focus();let stable=0;
          await waitFor(async()=>{
            const ready=await pos.webContents.executeJavaScript('Boolean(document.querySelector(".pos-shell")) && document.querySelector(".pos-header h1")?.textContent === "Dashboard"');
            stable=ready?stable+1:0;return stable>=3;
          },"SERVICE_CUSTODY_VISUAL_STABLE");
          await pos.webContents.executeJavaScript('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
          await mkdir(process.env.POS_E2E_AUDIT_DIRECTORY,{recursive:true});
          await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY,"service-custody-dashboard.png"),(await pos.capturePage()).toPNG());
        }
        process.stdout.write(JSON.stringify({browserIntegration:true,scope:"ISOLATED_VALIDATION",serviceCustody:true,devicePrivateKeyInMain:false,
          dashboardAuthorized:true,wrongPasswordRejected:true,erased,observed,authenticator:"CHROMIUM_VIRTUAL_CTAP2_NOT_HUMAN"})+"\n");return;
      }
      if(await attempt.result!=="CREDENTIALS_STORED")throw Error("NATIVE_BOUND_CODE_NOT_STORED");
      const assertion=await vault.use(async tokens=>{
        // JWT payload is a selector only; Central verifies signature/current
        // state + exact credential proof before deriving any SSA identity.
        const payload=JSON.parse(Buffer.from(tokens.accessToken.split(".")[1],"base64url").toString());
        return nativePost("/v1/business-session/assertions",{session_id:payload.sid},true,tokens.accessToken);
      });
      const {exerciseNativeAssertion}=await import("../dist/ssa-native-transport-probe.mjs");
      const acquireSas=(input.sasPublicTrust||input.sasTrustCandidate)?async(testPhase)=>{
        // Request construction remains in main; the service is the SAS HTTP
        // consumer. This privileged fixture handoff is not exposed to React.
        const result=await vault.use(async tokens=>{
          const payload=JSON.parse(Buffer.from(tokens.accessToken.split(".")[1],"base64url").toString());
          return nativePost("__SAS_SERVICE_REQUEST__",{session_id:payload.sid},true,tokens.accessToken,testPhase);
        });
        if(result?.kind!=="ACQUIRED")throw Error("CENTRAL_SAS_NOT_ACQUIRED");
        return result;
      }:undefined;
      const nativeSsa=await exerciseNativeAssertion(assertion,acquireSas);
      if(nativeSsa.activated!=="ACTIVATED"||nativeSsa.recovered!=="ACTIVE")throw Error("NATIVE_BOUND_SSA_NOT_ACTIVE");
      await pos.webContents.executeJavaScript('document.querySelector("button").click()');
      if(acquireSas){
        await waitFor(()=>pos.webContents.executeJavaScript('Boolean(document.querySelector(".pos-shell")) && [...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Dashboard")'),"CENTRAL_SAS_DASHBOARD");
        await pos.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Dashboard").click()');
      }else await waitFor(()=>pos.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=authorization-error]")) && !document.querySelector(".pos-shell")'),"BOUND_SSA_WITHOUT_GRANTS");
      if(process.env.POS_E2E_AUDIT_DIRECTORY){
        const {mkdir,writeFile}=await import("node:fs/promises");await mkdir(process.env.POS_E2E_AUDIT_DIRECTORY,{recursive:true});
        await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY,acquireSas?"central-sas-dashboard.png":"bound-ssa-without-grants.png"),(await pos.capturePage()).toPNG());
      }
      let revocationDenied=false,revokedAuthorization;
      if(acquireSas){
        const refresh=await acquireSas("REVOKE");if(refresh.sequence!==2)throw Error("SAS_REVOCATION_SEQUENCE_MISMATCH");
        revokedAuthorization=await exerciseNativeAssertion(assertion);
        if(revokedAuthorization.capabilities.result.permissions.length!==0||revokedAuthorization.audit.result_code!=="UNAUTHORIZED")throw Error("SAS_REVOCATION_NOT_ENFORCED");
        pos.webContents.reload();
        await waitFor(()=>pos.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=authorization-denied]")) && !document.querySelector(".pos-shell")'),"SAS_REVOKED_DASHBOARD");
        revocationDenied=true;
        if(process.env.POS_E2E_AUDIT_DIRECTORY){const {writeFile}=await import("node:fs/promises");await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY,"central-sas-revoked.png"),(await pos.capturePage()).toPNG());}
      }
      vault.clear();
      const custodyCleared=await vault.use(async()=>false)===null;
      process.stdout.write(JSON.stringify({browserIntegration:true,scope:"ISOLATED_VALIDATION",boundNative:true,destinationConfirmed:true,
        wrongPasswordRejected:true,erased,custodyCleared,nativeSsa,grantsFabricated:false,dashboardClosed:!acquireSas||revocationDenied,
        dashboardAuthorized:Boolean(acquireSas),revocationDenied,revokedAuthorization,centralSas:Boolean(acquireSas),authenticator:"CHROMIUM_VIRTUAL_CTAP2_NOT_HUMAN"})+"\n");
      return;
    }
    const posStillClosed = await pos.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=authorization-unauthenticated]")) && !document.querySelector(".pos-shell")');
    if (process.env.POS_E2E_AUDIT_DIRECTORY) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(process.env.POS_E2E_AUDIT_DIRECTORY, { recursive: true });
      await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY, "browser-business-verified.png"), (await browser.capturePage()).toPNG());
      await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY, "pos-awaiting-device-binding.png"), (await pos.capturePage()).toPNG());
    }
    await browser.webContents.executeJavaScript('document.querySelector("#logout").click()');
    await waitFor(() => browser.webContents.executeJavaScript('document.querySelector("#status").dataset.phase === "SIGNED_OUT"'), "CENTRAL_LOGOUT");
    attempt.cancel();
    const cancelled = await attempt.result;
    const credentialCustodyEmpty = await vault.use(async () => false) === null;
    const phases = await browser.webContents.executeJavaScript("window.__labPhases");
    process.stdout.write(JSON.stringify({ browserIntegration: true, phase, erased, posStillClosed, credentialCustodyEmpty,
      cancelled, wrongPasswordRejected: true, centralLogout: true, protectedCookie, phases, secure: visible.secure, platform: process.platform,
      authenticator: "CHROMIUM_VIRTUAL_CTAP2_REAL_SIGNATURE_NOT_A_HUMAN", scope: "ISOLATED_VALIDATION" }) + "\n");
  } finally { attempt.cancel(); vault.clear(); browser.destroy();if(nativePost)app.quit(); }
  app.quit();
}
void run().catch(error => { process.stderr.write("REAL_BROWSER_INTEGRATION_FAILED: " + error.message + "\n"); app.exit(1); });
