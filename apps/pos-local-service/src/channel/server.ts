import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import {
  CashShiftCloseResponseSchema,
  CashShiftOpenResponseSchema,
  IpcRequestSchema,
  OperationConfirmResponseSchema,
  OperationResultResponseSchema,
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  PaymentCancelResponseSchema,
  PaymentGetResponseSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentTransferConfirmResponseSchema,
  SaleCreateResponseSchema,
  SessionActivateResponseSchema,
  SessionRecoverResponseSchema,
  negotiateProtocolVersion,
  type ContractVersionRange,
  type IpcRequest,
} from "@pos-platform/contracts";
import { encodeFrame, FrameDecoder } from "./framing.js";
import type { LocalChannelAuthenticator } from "./authenticator.js";
import {
  hardenWindowsNamedPipeSecurity,
  inspectWindowsNamedPipeSecurity,
} from "./windows-pipe-security.js";

/**
 * Contexto de transporte que el servidor entrega al handler — `DEC-015` §3.
 *
 * `transportSessionId` lo elige el cliente y sólo sirve para correlación y
 * anti-replay. `connectionId` lo genera el servidor por conexión aceptada,
 * **nunca viaja por el cable** y no es observable ni elegible por el llamador:
 * por eso es la única clave admisible para vincular identidad de sesión.
 */
export interface ChannelRequestContext {
  readonly transportSessionId: string;
  readonly connectionId: string;
}

export type ChannelHandler = (
  request: IpcRequest,
  signal: AbortSignal,
  context: ChannelRequestContext,
) => Promise<unknown>;

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
    case "operation.confirm":
      return OperationConfirmResponseSchema.parse(input);
    case "session.activate":
      return SessionActivateResponseSchema.parse(input);
    case "session.recover":
      return SessionRecoverResponseSchema.parse(input);
    case "cash.shift.open":
      return CashShiftOpenResponseSchema.parse(input);
    case "cash.shift.close":
      return CashShiftCloseResponseSchema.parse(input);
    case "sale.create":
      return SaleCreateResponseSchema.parse(input);
    case "payment.register.cash":
      return PaymentRegisterCashResponseSchema.parse(input);
    case "payment.register.transfer":
      return PaymentRegisterTransferResponseSchema.parse(input);
    case "payment.transfer.confirm":
      return PaymentTransferConfirmResponseSchema.parse(input);
    case "payment.cancel":
      return PaymentCancelResponseSchema.parse(input);
    case "payment.get":
      return PaymentGetResponseSchema.parse(input);
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
    /**
     * Se invoca al cerrarse la conexión. `DEC-015` §5.6 exige que el cierre
     * invalide el vínculo de sesión: sin este aviso el registro conservaría
     * identidad de una conexión que ya no existe.
     */
    private readonly onConnectionClosed?: (connectionId: string) => void,
  ) {
    if (!Number.isSafeInteger(maxConnections) || maxConnections <= 0) throw new Error("maxConnections must be positive");
    if (!Number.isSafeInteger(maxQueuedRequestsPerConnection) || maxQueuedRequestsPerConnection <= 0) {
      throw new Error("maxQueuedRequestsPerConnection must be positive");
    }
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("requestTimeoutMs must be positive");
  }

  async start(): Promise<void> {
    if (this.server) throw new Error("local channel server already started");
    let acceptingTraffic = process.platform !== "win32";

    const server = createServer((socket) => {
      if (!acceptingTraffic) {
        socket.destroy();
        return;
      }
      if (this.sockets.size >= this.maxConnections) {
        socket.destroy();
        return;
      }

      this.sockets.add(socket);
      const decoder = new FrameDecoder();
      const negotiatedSessions = new Map<string, string>();
      // Identidad de conexión asignada por el servidor. Se crea aquí, vive
      // exactamente lo que vive el socket y no se transmite jamás.
      const connectionId = randomUUID();
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
                    (signal) => this.handler(request, signal, { transportSessionId: frame.session_id, connectionId }),
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
                  (signal) => this.handler(request, signal, { transportSessionId: frame.session_id, connectionId }),
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
        this.onConnectionClosed?.(connectionId);
      });
      socket.once("error", () => socket.destroy());
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("error", onError);
          reject(error);
        };
        server.once("error", onError);
        server.listen(this.endpoint, () => {
          server.off("error", onError);
          try {
            if (process.platform === "win32") {
              hardenWindowsNamedPipeSecurity(this.endpoint);
              inspectWindowsNamedPipeSecurity(this.endpoint);
              setTimeout(() => {
                acceptingTraffic = true;
                resolve();
              }, 25);
              return;
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
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
