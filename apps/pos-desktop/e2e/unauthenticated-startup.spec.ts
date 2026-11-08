import { test, expect } from "@playwright/test";
import { _electron, type ElectronApplication } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

// No identity fixtures, signing keys, SSA, snapshots, providers or service mocks.
// Production Electron entry and Windows transport; isolated component host/SQLite.
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const installation = "018f0000-0000-7000-8000-000000000092";
const device = "018f0000-0000-7000-8000-000000000093";
let directory: string;
let service: ChildProcess;
let app: ElectronApplication;
const auditDirectory = process.env.POS_E2E_AUDIT_DIRECTORY;

async function launch(): Promise<ElectronApplication> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const env: Record<string, string> = { ...inherited, POS_DATA_DIRECTORY: directory,
    POS_INSTALLATION_ID: installation, POS_DEVICE_ID: device };
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({ executablePath: require("electron") as string,
    args: [join(here, "..", "dist", "start.bundle.mjs")], env });
}

async function stopService(): Promise<void> {
  if (!service || service.exitCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(Error("Service shutdown timed out")), 10_000);
    service.once("exit", () => { clearTimeout(timer); done(); });
    service.send!("pos-e2e-shutdown");
  });
}

async function emptyState(): Promise<unknown> {
  return new Promise((done, reject) => {
    const receive = (value: unknown): void => {
      if ((value as { type?: string }).type !== "pos-e2e-empty-state") return;
      clearTimeout(timer); service.off("message", receive); done(value);
    };
    const timer = setTimeout(() => { service.off("message", receive); reject(Error("Missing SQLite evidence")); }, 5_000);
    service.on("message", receive);
    service.send!("pos-e2e-empty-state");
  });
}

test.describe.configure({ mode: "serial" });
test.skip(process.platform !== "win32", "Requires actual Windows DPAPI and named pipe");
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "pos-no-session-"));
  const root = join(here, "..", "..", "pos-local-service");
  service = spawn(process.execPath, [createRequire(join(root, "package.json")).resolve("tsx/cli"),
    join(root, "e2e-host", "real-service-host.ts")], {
    cwd: root, stdio: ["pipe", "pipe", "pipe", "ipc"], env: {
      ...process.env, NODE_ENV: "test", POS_E2E_SESSION_MODE: "NONE", POS_E2E_DATA_DIR: directory,
      POS_E2E_INSTALLATION_ID: installation, POS_E2E_DEVICE_ID: device,
      POS_E2E_TENANT_ID: "018f0000-0000-7000-8000-000000000094",
      POS_E2E_COMPANY_ID: "018f0000-0000-7000-8000-000000000095",
      POS_E2E_BRANCH_ID: "018f0000-0000-7000-8000-000000000096",
    },
  });
  await new Promise<void>((done, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Service readiness timed out")), 30_000);
    service.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split("\n").find(value => value.includes('"ready"'));
      if (!line) return;
      clearTimeout(timer);
      try { expect(JSON.parse(line).sessionAssertion).toBeNull(); done(); } catch (error) { reject(error); }
    });
    service.stderr!.on("data", chunk => process.stderr.write(chunk));
    service.once("exit", code => { clearTimeout(timer); reject(Error(`Service exited: ${code}`)); });
  });
  app = await launch();
});

test.afterAll(async () => {
  await app?.close();
  await stopService();
  if (directory) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("pos-no-session-")) {
      throw Error("Refusing cleanup outside isolated temporary directory");
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("production entry crosses real preload and service, without granting access", async () => {
  const page = await app.firstWindow();
  await expect(page.getByTestId("status-connected")).toBeVisible();
  await expect(page.getByTestId("authorization-unauthenticated")).toBeVisible();
  await expect(page.getByTestId("sale-panel")).toHaveCount(0);
  await expect(page.locator(".pos-nav")).toHaveCount(0);
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    // Electron exposes this inspection method at runtime, outside its public typings.
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): Record<string, unknown>;
    };
    const preferences = contents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity };
  });
  expect(preferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { posService: Record<string, (request: unknown) => Promise<unknown>> }).posService;
    const request = (message_type: string, payload: unknown) => ({ protocol_version: "1.0.0", message_type,
      request_id: crypto.randomUUID(), correlation_id: crypto.randomUUID(), payload_schema_version: "1.0.0", payload });
    let mismatchedMethodRejected = false;
    try { await api["session.recover"]!(request("authorization.capabilities.get", {})); }
    catch { mismatchedMethodRejected = true; }
    return { recovery: await api["session.recover"]!(request("session.recover", {})),
      capabilities: await api["authorization.capabilities.get"]!(request("authorization.capabilities.get", {})),
      catalog: await api["catalog.item.list"]!(request("catalog.item.list", { query: "", limit: 10, offset: 0 })),
      administration: await api["admin.metrics.get"]!(request("admin.metrics.get", {})),
      mismatchedMethodRejected, frozen: Object.isFrozen(api),
      node: typeof (globalThis as unknown as { require?: unknown }).require };
  });
  expect(result.node).toBe("undefined");
  expect(result.mismatchedMethodRejected).toBe(true);
  expect(result.frozen).toBe(true);
  expect(result.recovery).toMatchObject({ status: "SUCCEEDED", result_code: "NONE", result: { outcome: "NONE", session_id: null } });
  for (const response of [result.capabilities, result.catalog, result.administration]) {
    expect(response).toMatchObject({ status: "REJECTED", result_code: "SESSION_NOT_BOUND" });
  }
  const sqlite = await emptyState();
  expect(sqlite).toMatchObject({ sessions: 0, snapshots: 0, sales: 0, cashShifts: 0, signingKeys: 0 });
  if (auditDirectory) {
    mkdirSync(auditDirectory, { recursive: true });
    await page.screenshot({ path: join(auditDirectory, "electron-no-session.png"), fullPage: true });
    writeFileSync(join(auditDirectory, "observed-runtime.json"), JSON.stringify({
      observedAt: new Date().toISOString(), platform: process.platform, entry: "dist/start.bundle.mjs",
      versions: await app.evaluate(() => process.versions), preferences, result, sqlite,
      boundary: "Production desktop, DPAPI, named pipe, commercial owners; isolated service host, no DEV-003 activation or central user login",
    }, null, 2));
  }
});

test("retry and actual process restart do not fabricate a durable session", async () => {
  let page = await app.firstWindow();
  await page.getByRole("button", { name: "Comprobar sesión" }).click();
  await expect(page.getByTestId("authorization-unauthenticated")).toBeVisible();
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByTestId("authorization-unauthenticated")).toBeVisible();
  await expect(page.getByTestId("status-connected")).toBeVisible();
  expect(await emptyState()).toMatchObject({ sessions: 0, snapshots: 0, sales: 0, cashShifts: 0 });
});

test("actual service loss becomes unavailable and stays closed", async () => {
  const page = await app.firstWindow();
  await stopService();
  // The existing runtime status poll must invalidate access automatically;
  // an operator click must not be required after loss of the real channel.
  await expect(page.getByTestId("authorization-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("status-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sale-panel")).toHaveCount(0);
  if (auditDirectory) await page.screenshot({ path: join(auditDirectory, "electron-service-unavailable.png"), fullPage: true });
});
