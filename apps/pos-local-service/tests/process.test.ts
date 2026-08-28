import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

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
    ...(dataDirectory === undefined ? {} : { POS_DATA_DIRECTORY: dataDirectory }),
    POS_INSTALLATION_ID: "018f0000-0000-7000-8000-000000000001",
    POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
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

describe("POS Local Service process boundary", () => {
  it("starts as a real child process and shuts down cleanly on SIGTERM", async () => {
    const dataDirectory = await directory();
    const child = spawnService(serviceEnvironment(dataDirectory));
    await waitForLogEvent(child, "runtime.started");
    expect(child.kill("SIGTERM")).toBe(true);
    expect(await waitForExit(child)).toBe(0);
  });

  it("fails closed as a real child process when required config is missing", async () => {
    const child = spawnService(serviceEnvironment(undefined));
    const exitCode = await waitForExit(child);
    expect(exitCode).toBe(1);
  });
});
