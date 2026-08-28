import { randomBytes } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  encodeFrame,
  FrameDecoder,
  LocalChannelAuthenticator,
  LocalChannelClient,
  LocalChannelServer,
  SqliteReplayStateStore,
  inspectWindowsNamedPipeSecurity,
  localChannelEndpoint,
} from "../src/index.js";

const clock = { now: () => new Date("2026-08-28T00:00:00Z") };
const installationId = "018f0000-0000-7000-8000-000000000001";
const deviceId = "018f0000-0000-7000-8000-000000000002";
const sessionId = "018f0000-0000-7000-8000-000000000003";
const requestId = "018f0000-0000-7000-8000-000000000004";
const correlationId = "018f0000-0000-7000-8000-000000000005";
const directories: string[] = [];
const windowsIt = process.platform === "win32" ? it : it.skip;

function runtimeHandshakeRequest(protocolMin = "1.0.0", protocolMax = "1.0.0") {
  return {
    protocol_version: protocolMax,
    message_type: "runtime.handshake" as const,
    request_id: requestId,
    correlation_id: correlationId,
    payload_schema_version: "1.0.0",
    payload: {
      desktop_version: "1.0.0",
      service_version: "1.0.0",
      protocol_min: protocolMin,
      protocol_max: protocolMax,
      installation_id: installationId,
      device_id: deviceId,
      schema_version: "2",
      service_state: "READY",
    },
  };
}

function runtimeStatusRequest(
  id = "018f0000-0000-7000-8000-000000000006",
  protocolVersion = "1.0.0",
) {
  return {
    protocol_version: protocolVersion,
    message_type: "runtime.status.get" as const,
    request_id: id,
    correlation_id: correlationId,
    payload_schema_version: "1.0.0",
    payload: {},
  };
}

function compatibleResponse(request: ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>) {
  if (request.message_type === "runtime.handshake") {
    return {
      protocol_version: "1.0.0",
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      operation_id: null,
      status: "SUCCEEDED",
      result_code: "OK",
      result_schema_version: "1.0.0",
      error: null,
      server_time: "2026-08-28T00:00:00Z",
      result: { status: "COMPATIBLE", negotiated_protocol_version: "1.0.0" },
    };
  }
  return {
    protocol_version: "1.0.0",
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    operation_id: null,
    status: "SUCCEEDED",
    result_code: "OK",
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-08-28T00:00:00Z",
    result: {
      service_version: "1.0.0",
      protocol_version: "1.0.0",
      service_state: "READY",
      schema_version: "2",
    },
  };
}

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-channel-"));
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function receive(socket: Socket): Promise<unknown> {
  const decoder = new FrameDecoder();
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      try {
        const frames = decoder.push(chunk);
        if (frames.length > 0) {
          cleanup();
          resolve(frames[0]);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onClose = () => { cleanup(); reject(new Error("socket closed before response")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

describe("local channel", () => {
  it("decodes fragmented and coalesced frames", () => {
    const decoder = new FrameDecoder();
    const combined = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 2 })]);
    expect(decoder.push(combined.subarray(0, 5))).toEqual([]);
    expect(decoder.push(combined.subarray(5))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("fails closed on oversized frames", () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1_048_577);
    expect(() => new FrameDecoder().push(header)).toThrow("size rejected");
  });

  it("authenticates, detects tampering and rejects replay", () => {
    const auth = new LocalChannelAuthenticator(randomBytes(32), clock);
    const frame = auth.sign({ message_type: "runtime.status.get" }, "1.0.0");
    expect(auth.verify(frame).payload).toEqual({ message_type: "runtime.status.get" });
    expect(() => auth.verify(frame)).toThrow("replay");
    const other = new LocalChannelAuthenticator(randomBytes(32), clock);
    expect(() => other.verify(frame)).toThrow("MAC");
  });

  it("rejects a replay after service restart while the frame is still time-valid", async () => {
    const dir = await directory();
    const secret = randomBytes(32);
    let database = LocalDatabase.open({ dataDirectory: dir });
    const frame = new LocalChannelAuthenticator(secret, clock).sign(
      { message_type: "runtime.status.get" },
      "1.0.0",
      sessionId,
      1,
    );

    const first = new LocalChannelAuthenticator(secret, clock, {
      replayStateStore: new SqliteReplayStateStore(database),
    });
    expect(first.verify(frame).sequence).toBe(1);
    database.close();

    database = LocalDatabase.open({ dataDirectory: dir });
    const afterRestart = new LocalChannelAuthenticator(secret, clock, {
      replayStateStore: new SqliteReplayStateStore(database),
    });
    expect(() => afterRestart.verify(frame)).toThrow("replay");
    database.close();
    secret.fill(0);
  });

  it("rejects canonical status traffic before a session handshake", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    const server = new LocalChannelServer(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      async (request) => compatibleResponse(request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>),
      { min: "1.0.0", max: "1.0.0" },
    );
    let socket: Socket | undefined;

    try {
      await server.start();
      socket = createConnection(endpoint);
      await new Promise<void>((resolve, reject) => {
        socket!.once("connect", resolve);
        socket!.once("error", reject);
      });
      const closed = new Promise<void>((resolve) => socket!.once("close", () => resolve()));
      socket.write(encodeFrame(
        new LocalChannelAuthenticator(secret, clock).sign(runtimeStatusRequest(), "1.0.0", sessionId, 1),
      ));
      await closed;
    } finally {
      socket?.destroy();
      await server.stop();
      secret.fill(0);
    }
  }, 15_000);

  it("uses the real client to negotiate TECH-003 and validate response identity", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    const server = new LocalChannelServer(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      async (request) => compatibleResponse(request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>),
      { min: "1.0.0", max: "1.0.0" },
    );
    const client = new LocalChannelClient(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      { min: "1.0.0", max: "1.0.0" },
    );

    try {
      await server.start();
      await client.connect(runtimeHandshakeRequest());
      await expect(client.request(runtimeStatusRequest())).resolves.toMatchObject({
        status: "SUCCEEDED",
        result: { service_state: "READY", protocol_version: "1.0.0" },
      });
    } finally {
      await client.close();
      await server.stop();
      secret.fill(0);
    }
  }, 15_000);

  it("aborts a timed-out handler and closes the channel fail-closed", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    let aborted = false;
    const server = new LocalChannelServer(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      async (request, signal) => {
        if (request.message_type === "runtime.handshake") {
          return compatibleResponse(runtimeHandshakeRequest());
        }
        return await new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }, { once: true });
        });
      },
      { min: "1.0.0", max: "1.0.0" },
      32,
      64,
      25,
    );
    const client = new LocalChannelClient(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      { min: "1.0.0", max: "1.0.0" },
      500,
    );

    try {
      await server.start();
      await client.connect(runtimeHandshakeRequest());
      await expect(client.request(runtimeStatusRequest())).rejects.toThrow();
      expect(aborted).toBe(true);
    } finally {
      await client.close();
      await server.stop();
      secret.fill(0);
    }
  }, 15_000);

  it("closes a connection when the per-connection server queue exceeds capacity", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    const serverAuthenticator = new LocalChannelAuthenticator(secret, clock);
    const clientAuthenticator = new LocalChannelAuthenticator(secret, clock);
    const server = new LocalChannelServer(
      endpoint,
      serverAuthenticator,
      async (request) => compatibleResponse(
        request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>,
      ),
      { min: "1.0.0", max: "1.0.0" },
      32,
      1,
      5_000,
    );
    let socket: Socket | undefined;

    try {
      await server.start();
      socket = createConnection(endpoint);
      await new Promise<void>((resolve, reject) => {
        socket!.once("connect", resolve);
        socket!.once("error", reject);
      });
      const closed = new Promise<void>((resolve) => socket!.once("close", () => resolve()));
      socket.write(Buffer.concat([
        encodeFrame(clientAuthenticator.sign(runtimeHandshakeRequest(), "1.0.0", sessionId, 1)),
        encodeFrame(clientAuthenticator.sign(runtimeStatusRequest(), "1.0.0", sessionId, 3)),
      ]));
      await closed;
    } finally {
      socket?.destroy();
      await server.stop();
      serverAuthenticator.destroy();
      clientAuthenticator.destroy();
      secret.fill(0);
    }
  }, 15_000);

  it("rejects client requests when the bounded client queue is saturated", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    let releaseStatus!: () => void;
    const statusGate = new Promise<void>((resolve) => { releaseStatus = resolve; });

    const serverAuthenticator = new LocalChannelAuthenticator(secret, clock);
    const clientAuthenticator = new LocalChannelAuthenticator(secret, clock);
    const server = new LocalChannelServer(
      endpoint,
      serverAuthenticator,
      async (request) => {
        if (request.message_type === "runtime.status.get") await statusGate;
        return compatibleResponse(
          request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>,
        );
      },
      { min: "1.0.0", max: "1.0.0" },
    );
    const client = new LocalChannelClient(
      endpoint,
      clientAuthenticator,
      { min: "1.0.0", max: "1.0.0" },
      5_000,
      1,
    );

    try {
      await server.start();
      await client.connect(runtimeHandshakeRequest());
      const first = client.request(runtimeStatusRequest(
        "018f0000-0000-7000-8000-000000000020",
      ));
      await expect(client.request(runtimeStatusRequest(
        "018f0000-0000-7000-8000-000000000021",
      ))).rejects.toThrow("queue capacity exceeded");
      releaseStatus();
      await expect(first).resolves.toMatchObject({ status: "SUCCEEDED" });
    } finally {
      releaseStatus();
      await client.close();
      await server.stop();
      serverAuthenticator.destroy();
      clientAuthenticator.destroy();
      secret.fill(0);
    }
  }, 15_000);

  it("requires canonical TECH-003 handshake before status traffic", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    const serverAuth = new LocalChannelAuthenticator(secret, clock);
    const clientAuth = new LocalChannelAuthenticator(secret, clock);
    const server = new LocalChannelServer(
      endpoint,
      serverAuth,
      async (request) => compatibleResponse(
        request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>,
      ),
      { min: "1.0.0", max: "1.0.0" },
    );
    let socket: Socket | undefined;

    try {
      await server.start();
      socket = createConnection(endpoint);
      await new Promise<void>((resolve, reject) => {
        socket!.once("connect", resolve);
        socket!.once("error", reject);
      });

      const handshake = runtimeHandshakeRequest();
      socket.write(encodeFrame(clientAuth.sign(handshake, "1.0.0", sessionId, 1)));
      const handshakeResponse = clientAuth.verify(await receive(socket));
      expect(handshakeResponse.payload).toMatchObject({
        status: "SUCCEEDED",
        result: { status: "COMPATIBLE", negotiated_protocol_version: "1.0.0" },
      });

      const status = runtimeStatusRequest();
      socket.write(encodeFrame(clientAuth.sign(status, "1.0.0", sessionId, 3)));
      const statusResponse = clientAuth.verify(await receive(socket));
      expect(statusResponse.payload).toMatchObject({
        status: "SUCCEEDED",
        result: { service_state: "READY", schema_version: "2" },
      });
    } finally {
      socket?.destroy();
      await server.stop();
      serverAuth.destroy();
      clientAuth.destroy();
      secret.fill(0);
    }
  }, 15_000);

  windowsIt("keeps the real named-pipe DACL restricted across replenished instances", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    const server = new LocalChannelServer(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      async (request) => compatibleResponse(
        request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>,
      ),
      { min: "1.0.0", max: "1.0.0" },
    );

    try {
      await server.start();
      for (let index = 0; index < 6; index += 1) {
        const report = inspectWindowsNamedPipeSecurity(endpoint);
        expect(report.allowedTrustees).toContain(report.logonSid);
        expect(report.allowedTrustees).not.toContain(report.currentSid);
        expect(report.allowedTrustees).not.toContain("LA");
        expect(report.allowedTrustees).not.toContain("WD");
        expect(report.allowedTrustees).not.toContain("AN");
        expect(report.allowedTrustees).not.toContain("AU");
        expect(report.allowedTrustees).not.toContain("BU");
        expect(report.allowedTrustees).not.toContain("BA");
      }
    } finally {
      await server.stop();
      secret.fill(0);
    }
  }, 30_000);

  it("fails closed when another server already owns the channel endpoint", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(endpoint, () => {
        blocker.off("error", reject);
        resolve();
      });
    });

    const secret = randomBytes(32);
    const server = new LocalChannelServer(
      endpoint,
      new LocalChannelAuthenticator(secret, clock),
      async (request) => compatibleResponse(
        request as ReturnType<typeof runtimeHandshakeRequest> | ReturnType<typeof runtimeStatusRequest>,
      ),
      { min: "1.0.0", max: "1.0.0" },
    );

    try {
      await expect(server.start()).rejects.toThrow();
    } finally {
      secret.fill(0);
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("uses named pipes in production and explicit sockets only in tests", () => {
    expect(localChannelEndpoint(installationId, "win32")).toContain("\\\\.\\pipe\\camacho-pos-");
    expect(() => localChannelEndpoint(installationId, "linux")).toThrow("requires Windows");
    expect(localChannelEndpoint(installationId, "linux", "/tmp")).toContain(".sock");
  });
});
