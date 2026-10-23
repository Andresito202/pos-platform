import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

/** Reuses the existing empty real-service host. No signer, SSA, grants or user
 * is installed into SQLite; central password/MFA/BUSINESS must do actual work. */
export async function exerciseElectronCommercialBrowser(input: {
  port: number; certificateFingerprint: string; email: string; password: string;
  credentialId: string; privateKey: string; counter: number;
  registration: { clientId: string; redirectUri: string; authorizationOrigin: string };
  tenantId: string; companyId: string; branchId: string; installationId: string; deviceId: string;
  issuedAssertion?:unknown;
  ssaPublicTrust?:{rootPublicPem:string;artifact:unknown};
}): Promise<Record<string, unknown>> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const desktop = join(root, "pos-desktop"), local = join(root, "pos-local-service");
  const directory = await mkdtemp(join(tmpdir(), "camacho-browser-composition-"));
  let service: ChildProcess | undefined, electron: ChildProcess | undefined;
  const inputPipe = `\\\\.\\pipe\\camacho-browser-test-${randomUUID()}`;
  const inputServer = createServer(socket => { socket.end(JSON.stringify(input)); inputServer.close(); });
  const ready = (child: ChildProcess, predicate: (line: string) => boolean): Promise<string> => new Promise((done, reject) => {
    let output = "", diagnostic = "", settled = false;
    child.stderr!.on("data", (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
    const timeout = setTimeout(() => reject(Error("INTEGRATION_PROCESS_TIMEOUT")), 60_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.split("\n").find(predicate);
      if (match) { settled = true; clearTimeout(timeout); done(match); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); if (!settled) reject(Error("INTEGRATION_PROCESS_FAILED: " + diagnostic)); });
  });
  try {
    await new Promise<void>((done, reject) => { inputServer.once("error", reject); inputServer.listen(inputPipe, () => done()); });
    service = spawn(process.execPath, [createRequire(join(local, "package.json")).resolve("tsx/cli"), join(local, "e2e-host/real-service-host.ts")], {
      cwd: local, stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...process.env, NODE_ENV: "test", POS_E2E_SESSION_MODE: "NONE",
        POS_E2E_DATA_DIR: directory, POS_E2E_TENANT_ID: input.tenantId, POS_E2E_COMPANY_ID: input.companyId,
        POS_E2E_BRANCH_ID: input.branchId, POS_E2E_INSTALLATION_ID: input.installationId, POS_E2E_DEVICE_ID: input.deviceId,
        POS_E2E_SSA_PUBLIC_TRUST:input.ssaPublicTrust?JSON.stringify(input.ssaPublicTrust):"" },
    });
    await ready(service, line => line.includes('"ready":true'));
    const env = { ...process.env, POS_DATA_DIRECTORY: directory, POS_INSTALLATION_ID: input.installationId,
      POS_DEVICE_ID: input.deviceId, CAMACHO_BROWSER_TEST_DIRECTORY: directory, CAMACHO_BROWSER_TEST_PORT: String(input.port),
      CAMACHO_BROWSER_TEST_PIPE: inputPipe };
    delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
    electron = spawn(createRequire(join(desktop, "package.json"))("electron") as string,
      [join(desktop, "e2e/commercial-browser-entry.mjs")], { cwd: desktop, stdio: ["pipe", "pipe", "pipe"], env });
    const result = ready(electron, line => line.includes('"browserIntegration":true'));
    const observed = JSON.parse(await result) as Record<string, unknown>;
    if (process.env.POS_E2E_AUDIT_DIRECTORY) {
      await mkdir(process.env.POS_E2E_AUDIT_DIRECTORY, { recursive: true });
      await writeFile(join(process.env.POS_E2E_AUDIT_DIRECTORY, "browser-observations.json"), JSON.stringify(observed, null, 2));
    }
    return observed;
  } finally {
    inputServer.close();
    if (electron?.exitCode === null) {
      const child = electron;
      await new Promise<void>(done => { child.once("exit", () => done()); child.kill(); });
    }
    if (service?.exitCode === null) {
      const child = service;
      await new Promise<void>(done => { child.once("exit", () => done()); child.send!("pos-e2e-shutdown"); });
    }
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("camacho-browser-composition-")) throw Error("BROWSER_CLEANUP_REJECTED");
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
