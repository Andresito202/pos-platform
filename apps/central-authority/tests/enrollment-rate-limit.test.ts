import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { RequestListener, Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ server: null as Server | null, databaseQueries: 0 }));

// Exercise the production request listener over loopback HTTP. TLS termination
// and PostgreSQL are outside this rate-limit regression's scope.
vi.mock("node:https", async () => {
  const { createServer } = await import("node:http");
  return {
    createServer: (_options: unknown, listener: RequestListener) => {
      const server = createServer(listener);
      runtime.server = server;
      const listen = server.listen.bind(server);
      vi.spyOn(server, "listen").mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1);
        return typeof callback === "function"
          ? listen(0, "127.0.0.1", callback as () => void)
          : listen(0, "127.0.0.1");
      });
      return server;
    },
  };
});

vi.mock("@pos-platform/database-postgres", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pos-platform/database-postgres")>();
  return {
    ...actual,
    createPostgresPool: () => ({
      query: () => {
        runtime.databaseQueries += 1;
        throw new Error("invalid transport credentials must not reach PostgreSQL");
      },
      end: async () => undefined,
    }),
  };
});

describe("device-enrollment rate limit through the production listener", () => {
  let directory: string;
  let baseUrl: string;
  const signals = ["SIGINT", "SIGTERM"] as const;
  const originalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "pos-enrollment-limit-"));
    const issuerPath = join(directory, "issuer");
    const tlsPath = join(directory, "unused-tls");
    writeFileSync(issuerPath, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
    writeFileSync(tlsPath, "TLS is replaced only in this HTTP listener test");
    vi.stubEnv("CENTRAL_DATABASE_URL", "postgres://unused:unused@127.0.0.1:1/unused");
    vi.stubEnv("CENTRAL_AUTHORITY_PORT", "0");
    vi.stubEnv("D3_ENROLLMENT_TRANSPORT_TOKEN", "enrollment-rate-limit-test-transport");
    vi.stubEnv("D3_ISSUER_PRIVATE_KEY_FILE", issuerPath);
    vi.stubEnv("CENTRAL_TLS_KEY_FILE", tlsPath);
    vi.stubEnv("CENTRAL_TLS_CERT_FILE", tlsPath);
    vi.stubEnv("SESSION_TRUST_ARTIFACT_FILE", undefined);
    vi.stubEnv("SESSION_TRUST_TRANSPORT_TOKEN_FILE", undefined);

    await import("../src/main.js");
    const server = runtime.server;
    if (server === null) throw new Error("production listener was not created");
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("loopback listener has no TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    const server = runtime.server;
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!originalListeners.get(signal)?.includes(listener)) process.removeListener(signal, listener);
      }
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  it("keeps one remote-address budget when invalid bearer tokens change", async () => {
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await fetch(`${baseUrl}/v1/device-enrollment`, {
        method: "POST",
        headers: { authorization: `Bearer invalid-${attempt}`, "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json() as { result_code: string };
      expect(response.status).toBe(attempt < 30 ? 401 : 429);
      expect(body.result_code).toBe(attempt < 30
        ? "DEVICE_ENROLLMENT_TRANSPORT_UNAUTHORIZED"
        : "DEVICE_ENROLLMENT_RATE_LIMITED");
    }
    expect(runtime.databaseQueries).toBe(0);
    const sessionTrust = await fetch(`${baseUrl}/v1/session-trust`);
    expect(sessionTrust.status).toBe(401);
    await sessionTrust.text();
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    await health.text();
  });
});
