import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectWindowsNamedPipeSecurity,
  loadOrCreateWindowsLocalChannelSecret,
  LocalChannelAuthenticator,
  LocalChannelClient,
  localChannelEndpoint,
} from "../src/index.js";

const directories: string[] = [];
const processInstallationId = "018f0000-0000-7000-8000-000000000091";
const processDeviceId = "018f0000-0000-7000-8000-000000000092";

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-process-"));
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function serviceEnvironment(dataDirectory?: string): NodeJS.ProcessEnv {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("POS_")),
  );
  return {
    ...base,
    NODE_ENV: "test",
    ...(dataDirectory === undefined ? {} : { POS_DATA_DIRECTORY: dataDirectory }),
    POS_INSTALLATION_ID: processInstallationId,
    POS_DEVICE_ID: processDeviceId,
    POS_SERVICE_VERSION: "1.0.0",
    POS_PROTOCOL_MIN: "1.0.0",
    POS_PROTOCOL_MAX: "1.0.0",
  };
}

function spawnService(environment: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function spawnServiceWithControl(environment: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: process.cwd(),
    env: { ...environment, NODE_ENV: "test" },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  if (!child.stdin || !child.stdout || !child.stderr) {
    child.kill();
    throw new Error("controlled service process did not expose piped stdio");
  }
  return child as ChildProcessWithoutNullStreams;
}

function spawnServiceWithFatal(
  environment: NodeJS.ProcessEnv,
  mode: "uncaughtException" | "unhandledRejection",
): ChildProcessWithoutNullStreams {
  const fault = mode === "uncaughtException"
    ? 'setImmediate(() => { throw new Error("fatal-process-test"); });'
    : 'setImmediate(() => { void Promise.reject(new Error("fatal-process-test")); });';
  const script = `await import("./src/main.ts"); ${fault}`;
  return spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function captureStdout(child: ChildProcessWithoutNullStreams): () => string {
  child.stdout.setEncoding("utf8");
  let output = "";
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  return () => output;
}

function waitForLogEvent(
  child: ChildProcessWithoutNullStreams,
  event: string,
  timeoutMs = 8_000,
): Promise<Record<string, unknown>> {
  child.stdout.setEncoding("utf8");
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: string) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          if (record.event === event) {
            cleanup();
            resolve(record);
            return;
          }
        } catch {
          // pnpm may emit non-JSON lifecycle output around the service logs.
        }
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`service exited before ${event}: code=${code} signal=${signal}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 8_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("service did not exit within shutdown timeout"));
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function waitForClose(child: ChildProcessWithoutNullStreams, timeoutMs = 8_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("service stdio did not close within shutdown timeout"));
    }, timeoutMs);
    timer.unref?.();
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const posixIt = process.platform === "win32" ? it.skip : it;

describe("POS Local Service process boundary", () => {
  posixIt("starts as a real child process and shuts down cleanly on SIGTERM", async () => {
    const dataDirectory = await directory();
    const child = spawnService(serviceEnvironment(dataDirectory));
    await waitForLogEvent(child, "runtime.started");
    expect(child.kill("SIGTERM")).toBe(true);
    expect(await waitForExit(child)).toBe(0);
  });

  posixIt("coalesces near-simultaneous SIGINT and SIGTERM into one shutdown", async () => {
    const dataDirectory = await directory();
    const child = spawnService(serviceEnvironment(dataDirectory));
    const stdout = captureStdout(child);
    await waitForLogEvent(child, "runtime.started");

    const closed = waitForClose(child);
    expect(child.kill("SIGINT")).toBe(true);
    child.kill("SIGTERM");

    expect(await closed).toBe(0);
    expect(stdout().match(/"event":"runtime.stopping"/g) ?? []).toHaveLength(1);
    expect(stdout().match(/"event":"runtime.stopped"/g) ?? []).toHaveLength(1);
  });

  it("performs a graceful real-process shutdown through the parent IPC control channel", async () => {
    const dataDirectory = await directory();
    const child = spawnServiceWithControl(serviceEnvironment(dataDirectory));
    const stdout = captureStdout(child);
    await waitForLogEvent(child, "runtime.started");

    if (process.platform === "win32") {
      const installationId = processInstallationId;
      const deviceId = processDeviceId;
      const endpoint = localChannelEndpoint(installationId);
      const report = inspectWindowsNamedPipeSecurity(endpoint);
      expect(report.allowedTrustees).toContain(report.logonSid);
      expect(report.allowedTrustees).not.toContain(report.currentSid);
      expect(report.allowedTrustees).not.toContain("LA");
      expect(report.allowedTrustees).not.toContain("WD");
      expect(report.allowedTrustees).not.toContain("AN");
      expect(report.allowedTrustees).not.toContain("AU");
      expect(report.allowedTrustees).not.toContain("BU");
      expect(report.allowedTrustees).not.toContain("BA");

      const secret = loadOrCreateWindowsLocalChannelSecret(dataDirectory, installationId);
      const clientAuthenticator = new LocalChannelAuthenticator(secret);
      secret.fill(0);
      const client = new LocalChannelClient(
        endpoint,
        clientAuthenticator,
        { min: "1.0.0", max: "1.0.0" },
        10_000,
      );
      try {
        await client.connect({
          protocol_version: "1.0.0",
          message_type: "runtime.handshake",
          request_id: "018f0000-0000-7000-8000-000000000010",
          correlation_id: "018f0000-0000-7000-8000-000000000011",
          payload_schema_version: "1.0.0",
          payload: {
            desktop_version: "1.0.0",
            service_version: "1.0.0",
            protocol_min: "1.0.0",
            protocol_max: "1.0.0",
            installation_id: installationId,
            device_id: deviceId,
            schema_version: "4",
            service_state: "READY",
          },
        });
        await expect(client.request({
          protocol_version: "1.0.0",
          message_type: "runtime.status.get",
          request_id: "018f0000-0000-7000-8000-000000000012",
          correlation_id: "018f0000-0000-7000-8000-000000000011",
          payload_schema_version: "1.0.0",
          payload: {},
        })).resolves.toMatchObject({
          status: "SUCCEEDED",
          result: {
            service_version: "1.0.0",
            protocol_version: "1.0.0",
            service_state: "READY",
            schema_version: "4",
          },
        });
      } finally {
        await client.close();
        clientAuthenticator.destroy();
      }
    }

    const exited = waitForExit(child);
    expect(child.send({ type: "pos-platform.test.shutdown" })).toBe(true);

    expect(await exited).toBe(0);
    expect(stdout().match(/"event":"runtime.stopping"/g) ?? []).toHaveLength(1);
    expect(stdout().match(/"event":"runtime.stopped"/g) ?? []).toHaveLength(1);
    expect(stdout()).toContain('"reason":"test.control"');
  }, 30_000);

  it("fails closed as a real child process when required config is missing", async () => {
    const child = spawnService(serviceEnvironment(undefined));
    const exitCode = await waitForExit(child);
    expect(exitCode).toBe(1);
  });

  for (const mode of ["uncaughtException", "unhandledRejection"] as const) {
    it(`fails closed and performs bounded shutdown on ${mode}`, async () => {
      const dataDirectory = await directory();
      const child = spawnServiceWithFatal(serviceEnvironment(dataDirectory), mode);
      const stdout = captureStdout(child);
      expect(await waitForExit(child)).toBe(1);
      expect(stdout()).toContain('"event":"runtime.started"');
      expect(stdout()).toContain('"event":"runtime.stopping"');
      expect(stdout()).toContain(`"reason":"${mode}"`);
    }, 30_000);
  }
});
