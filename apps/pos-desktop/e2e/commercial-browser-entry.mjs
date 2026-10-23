// Isolated integration driver. Never loaded by production-entry.
// Exercises real Electron + Windows service + HTTPS browser + Chromium WebAuthn.
import { app, BrowserWindow, safeStorage, session } from "electron";
import { resolve, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { connect } from "node:net";
import { X509Certificate } from "node:crypto";

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
  const vault = new NativeBusinessCredentialVault(safeStorage);
  const attempt = await beginNativeBusinessLogin({ registration: input.registration, timeoutMs: 60_000, vault,
    openSystemBrowser: url => browser.loadURL(url),
    exchange: (registration, request) => exchangeNativeBusinessCode(registration, request, 5_000),
  });
  process.stderr.write("BROWSER_DRIVER_NATIVE_STARTED\n");
  try {
    await waitFor(() => browser.webContents.executeJavaScript('Boolean(document.querySelector("#login"))'), "HTTPS_FORM");
    const visible = await browser.webContents.executeJavaScript(`({secure:window.isSecureContext,origin:location.origin,node:typeof require,bridge:typeof window.posService})`);
    if (!visible.secure || visible.origin !== "https://business.example.test" || visible.node !== "undefined" || visible.bridge !== "undefined") throw Error("BROWSER_ORIGIN_ISOLATION_FAILED");
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
    await submit(input.password);
    input.password = "";
    const phase = await waitFor(async () => {
      const phase = await browser.webContents.executeJavaScript('document.querySelector("#status").dataset.phase');
      if (phase === "REJECTED") throw Error("REAL_BROWSER_ASSERTION_REJECTED");
      return phase === "BUSINESS_VERIFIED" ? phase : null;
    }, "REAL_WEBAUTHN_BUSINESS");
    const erased = await browser.webContents.executeJavaScript('document.querySelector("[name=password]").value === "" && localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ""');
    const protectedCookie = (await partition.cookies.get({url:"https://business.example.test"})).some(cookie => cookie.httpOnly && cookie.secure);
    if (!protectedCookie) throw Error("BROWSER_COOKIE_PROTECTION_MISSING");
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
  } finally { attempt.cancel(); vault.clear(); browser.destroy(); }
  app.quit();
}
void run().catch(error => { process.stderr.write("REAL_BROWSER_INTEGRATION_FAILED: " + error.message + "\n"); app.exit(1); });
