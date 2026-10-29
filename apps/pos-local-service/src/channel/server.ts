import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import {
  IpcRequestSchema,
  RuntimeHandshakeResponseSchema,
  negotiateProtocolVersion,
  type ContractVersionRange,
  type IpcRequest,
} from "@pos-platform/contracts";
import {
  encodeFrame,
  FrameDecoder,
  responseSchemaFor,
  type LocalChannelAuthenticator,
} from "@pos-platform/local-channel";
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
  connectionSignal: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | undefined, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connectionSignal.removeEventListener("abort", onDisconnect);
      if (error) reject(error);
      else resolve(value as T);
    };
    const onDisconnect = () => {
      controller.abort();
      finish(new Error("local channel connection closed"));
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(new Error(`local channel request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    connectionSignal.addEventListener("abort", onDisconnect, { once: true });
    if (connectionSignal.aborted) {
      onDisconnect();
      return;
    }
    try {
      operation(controller.signal).then(
        (value) => finish(undefined, value),
        (error: unknown) => finish(error instanceof Error ? error : new Error("local channel handler failed")),
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error("local channel handler failed"));
    }
  });
}

/**
 * Valida la respuesta contra el esquema que gobierna **esa** operación.
 *
 * Antes era un `switch` con 14 de los 23 `case`. Los nueve que faltaban
 * —`customer.*`, `catalog.*`, `inventory.*`— caían al final sin `default`, la
 * función devolvía `undefined`, y la línea siguiente desreferenciaba
 * `response.protocol_version`: `TypeError` → `.catch(() => socket.destroy())`.
 * **Nueve operaciones mataban la conexión en silencio**, y `tsc` no podía verlo
 * porque el retorno era `unknown` y `undefined` le encaja.
 *
 * La tabla de `@pos-platform/local-channel` es `Record<IpcMessageType, …>`: si
 * el contrato gana una operación y nadie le da respuesta, **no compila**. Y es
 * la misma que usa el cliente, así que ambos extremos no pueden divergir.
 */
function validateResponse(request: IpcRequest, input: unknown): unknown {
  return responseSchemaFor(request.message_type).parse(input);
}

export class LocalChannelServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly connections = new Map<string, { close: () => void; retire: () => void }>();

  /** Privileged Service API. IDs come from this server, never an IPC payload. */
  disconnectConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;
    connection.close();
    return true;
  }

  /** Deny queued/new work now; allow only the current logout response to drain. */
  retireConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;
    connection.retire();
    return true;
  }

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
      const connectionController = new AbortController();
      const decoder = new FrameDecoder();
      const negotiatedSessions = new Map<string, string>();
      // Identidad de conexión asignada por el servidor. Se crea aquí, vive
      // exactamente lo que vive el socket y no se transmite jamás.
      const connectionId = randomUUID();
      let closed = false;
      let retired = false;
      let handling = false;
      const close = () => {
        if (closed) return;
        closed = true;
        connectionController.abort();
        negotiatedSessions.clear();
        this.connections.delete(connectionId);
        this.sockets.delete(socket);
        socket.destroy();
        // Cleanup failure must not keep this connection alive or prevent the
        // remaining connections from being closed on stop/revocation.
        try { this.onConnectionClosed?.(connectionId); } catch { /* fail closed */ }
      };
      this.connections.set(connectionId, { close, retire: () => {
        retired = true;
        socket.pause();
        if (!handling) close();
      } });
      let queuedRequests = 0;
      let queue: Promise<void> = Promise.resolve();

      socket.on("data", (chunk) => {
        if (closed || retired) return;
        try {
          for (const raw of decoder.push(chunk)) {
            queuedRequests += 1;
            if (queuedRequests > this.maxQueuedRequestsPerConnection) {
              close();
              return;
            }

            queue = queue
              .then(async () => {
                if (closed || retired || socket.destroyed) return;
                handling = true;
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
                    connectionController.signal,
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
                  connectionController.signal,
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
                close();
              })
              .finally(() => {
                handling = false;
                queuedRequests -= 1;
                if (retired) close();
              });
          }
        } catch {
          close();
        }
      });

      socket.once("close", close);
      socket.once("error", close);
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
      for (const connection of [...this.connections.values()]) connection.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    for (const connection of [...this.connections.values()]) connection.close();
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
