import { createServer, type Server, type Socket } from "node:net";
import {
  IpcRequestSchema,
  OperationResultResponseSchema,
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  negotiateProtocolVersion,
  type ContractVersionRange,
  type IpcRequest,
} from "@pos-platform/contracts";
import { encodeFrame, FrameDecoder } from "./framing.js";
import type { LocalChannelAuthenticator } from "./authenticator.js";
import {
  inspectWindowsNamedPipeSecurity,
  restrictCurrentProcessNamedPipeDefaults,
} from "./windows-pipe-security.js";

export type ChannelHandler = (request: IpcRequest, signal: AbortSignal) => Promise<unknown>;

function requestWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`local channel request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    operation(controller.signal).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function validateResponse(request: IpcRequest, input: unknown): unknown {
  switch (request.message_type) {
    case "runtime.handshake":
      return RuntimeHandshakeResponseSchema.parse(input);
    case "runtime.status.get":
      return RuntimeStatusResponseSchema.parse(input);
    case "operation.result.get":
      return OperationResultResponseSchema.parse(input);
  }
}

export class LocalChannelServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly endpoint: string,
    private readonly authenticator: LocalChannelAuthenticator,
    private readonly handler: ChannelHandler,
    private readonly localProtocolRange: ContractVersionRange,
    private readonly maxConnections = 32,
    private readonly maxQueuedRequestsPerConnection = 64,
    private readonly requestTimeoutMs = 5_000,
  ) {
    if (!Number.isSafeInteger(maxConnections) || maxConnections <= 0) throw new Error("maxConnections must be positive");
    if (!Number.isSafeInteger(maxQueuedRequestsPerConnection) || maxQueuedRequestsPerConnection <= 0) {
      throw new Error("maxQueuedRequestsPerConnection must be positive");
    }
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("requestTimeoutMs must be positive");
  }

  async start(): Promise<void> {
    if (this.server) throw new Error("local channel server already started");
    if (process.platform === "win32") {
      restrictCurrentProcessNamedPipeDefaults();
    }

    const server = createServer((socket) => {
      if (this.sockets.size >= this.maxConnections) {
        socket.destroy();
        return;
      }

      this.sockets.add(socket);
      const decoder = new FrameDecoder();
      const negotiatedSessions = new Map<string, string>();
      let queuedRequests = 0;
      let queue: Promise<void> = Promise.resolve();

      socket.on("data", (chunk) => {
        try {
          for (const raw of decoder.push(chunk)) {
            queuedRequests += 1;
            if (queuedRequests > this.maxQueuedRequestsPerConnection) {
              socket.destroy(new Error("local channel request queue capacity exceeded"));
              return;
            }

            queue = queue
              .then(async () => {
                if (socket.destroyed) return;
                const frame = this.authenticator.verify(raw);
                const request = IpcRequestSchema.parse(frame.payload);
                if (request.protocol_version !== frame.protocol_version) {
                  throw new Error("local channel transport/request protocol mismatch");
                }

                const existingProtocol = negotiatedSessions.get(frame.session_id);
                if (request.message_type === "runtime.handshake") {
                  if (existingProtocol !== undefined) throw new Error("local channel session already negotiated");
                  const expectedProtocol = negotiateProtocolVersion(this.localProtocolRange, {
                    min: request.payload.protocol_min,
                    max: request.payload.protocol_max,
                  });
                  const rawResponse = await requestWithTimeout(
                    (signal) => this.handler(request, signal),
                    this.requestTimeoutMs,
                  );
                  const response = RuntimeHandshakeResponseSchema.parse(rawResponse);
                  const outcome = response.result;
                  if (outcome?.status === "COMPATIBLE") {
                    if (expectedProtocol === null || outcome.negotiated_protocol_version !== expectedProtocol) {
                      throw new Error("local channel handshake negotiation mismatch");
                    }
                    if (response.protocol_version !== expectedProtocol) {
                      throw new Error("local channel handshake response protocol mismatch");
                    }
                    negotiatedSessions.set(frame.session_id, expectedProtocol);
                  } else if (outcome?.negotiated_protocol_version !== null) {
                    throw new Error("local channel incompatible handshake advertised a protocol");
                  }
                  await this.write(socket, encodeFrame(
                    this.authenticator.sign(response, response.protocol_version, frame.session_id, frame.sequence + 1),
                  ));
                  return;
                }

                if (existingProtocol === undefined) throw new Error("local channel handshake required");
                if (request.protocol_version !== existingProtocol) {
                  throw new Error("local channel negotiated protocol mismatch");
                }

                const rawResponse = await requestWithTimeout(
                  (signal) => this.handler(request, signal),
                  this.requestTimeoutMs,
                );
                const response = validateResponse(request, rawResponse) as { protocol_version: string };
                if (response.protocol_version !== existingProtocol) {
                  throw new Error("local channel response protocol mismatch");
                }
                await this.write(socket, encodeFrame(
                  this.authenticator.sign(response, existingProtocol, frame.session_id, frame.sequence + 1),
                ));
              })
              .catch(() => {
                socket.destroy();
              })
              .finally(() => {
                queuedRequests -= 1;
              });
          }
        } catch {
          socket.destroy();
        }
      });

      socket.once("close", () => {
        negotiatedSessions.clear();
        this.sockets.delete(socket);
      });
      socket.once("error", () => socket.destroy());
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.endpoint, () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      if (process.platform === "win32") {
        inspectWindowsNamedPipeSecurity(this.endpoint);
      }
      this.server = server;
    } catch (error) {
      for (const socket of this.sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    this.server = undefined;
  }

  private write(socket: Socket, buffer: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (socket.destroyed) {
        reject(new Error("local channel socket is closed"));
        return;
      }
      socket.write(buffer, (error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
