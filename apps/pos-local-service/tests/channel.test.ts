import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";
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
  LocalChannelServer,
  SqliteReplayStateStore,
  localChannelEndpoint,
} from "../src/index.js";

const clock = { now: () => new Date("2026-08-28T00:00:00Z") };
const installationId = "018f0000-0000-7000-8000-000000000001";
const deviceId = "018f0000-0000-7000-8000-000000000002";
const sessionId = "018f0000-0000-7000-8000-000000000003";
const requestId = "018f0000-0000-7000-8000-000000000004";
const correlationId = "018f0000-0000-7000-8000-000000000005";
const directories: string[] = [];

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

  it("requires canonical TECH-003 handshake before status traffic", async () => {
    const dir = await directory();
    const endpoint = localChannelEndpoint(installationId, process.platform, dir);
    const secret = randomBytes(32);
    const serverAuth = new LocalChannelAuthenticator(secret, clock);
    const clientAuth = new LocalChannelAuthenticator(secret, clock);

    const server = new LocalChannelServer(
      endpoint,
      serverAuth,
      async (request) => {
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
        if (request.message_type === "runtime.status.get") {
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
        throw new Error("unexpected request");
      },
      { min: "1.0.0", max: "1.0.0" },
    );

    await server.start();
    const socket = createConnection(endpoint);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const handshake = {
      protocol_version: "1.0.0",
      message_type: "runtime.handshake",
      request_id: requestId,
      correlation_id: correlationId,
      payload_schema_version: "1.0.0",
      payload: {
        desktop_version: "1.0.0",
        service_version: "1.0.0",
        protocol_min: "1.0.0",
        protocol_max: "1.0.0",
        installation_id: installationId,
        device_id: deviceId,
        schema_version: "2",
        service_state: "READY",
      },
    };
    socket.write(encodeFrame(clientAuth.sign(handshake, "1.0.0", sessionId, 1)));
    const handshakeResponse = clientAuth.verify(await receive(socket));
    expect(handshakeResponse.payload).toMatchObject({
      status: "SUCCEEDED",
      result: { status: "COMPATIBLE", negotiated_protocol_version: "1.0.0" },
    });

    const status = {
      protocol_version: "1.0.0",
      message_type: "runtime.status.get",
      request_id: "018f0000-0000-7000-8000-000000000006",
      correlation_id: correlationId,
      payload_schema_version: "1.0.0",
      payload: {},
    };
    socket.write(encodeFrame(clientAuth.sign(status, "1.0.0", sessionId, 3)));
    const statusResponse = clientAuth.verify(await receive(socket));
    expect(statusResponse.payload).toMatchObject({
      status: "SUCCEEDED",
      result: { service_state: "READY", schema_version: "2" },
    });

    socket.destroy();
    await server.stop();
  });

  it("uses named pipes in production and explicit sockets only in tests", () => {
    expect(localChannelEndpoint(installationId, "win32")).toContain("\\\\.\\pipe\\camacho-pos-");
    expect(() => localChannelEndpoint(installationId, "linux")).toThrow("requires Windows");
    expect(localChannelEndpoint(installationId, "linux", "/tmp")).toContain(".sock");
  });
});
