import { createConnection, type Socket } from "node:net";
import {
  IpcRequestSchema,
  OperationResultResponseSchema,
  RuntimeHandshakeRequestSchema,
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  isContractVersionCompatible,
  type ContractVersionRange,
  type IpcRequest,
} from "@pos-platform/contracts";
import { randomUUID } from "node:crypto";
import type { LocalChannelAuthenticator } from "./authenticator.js";
import { encodeFrame, FrameDecoder } from "./framing.js";

type NonHandshakeRequest = Exclude<IpcRequest, { message_type: "runtime.handshake" }>;

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class LocalChannelClient {
  private socket: Socket | undefined;
  private decoder = new FrameDecoder();
  private readonly sessionId = randomUUID();
  private negotiatedProtocol: string | undefined;
  private nextRequestSequence = 1;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly endpoint: string,
    private readonly authenticator: LocalChannelAuthenticator,
    private readonly protocolRange: ContractVersionRange,
    private readonly timeoutMs = 5_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("local channel client timeout must be a positive integer");
    }
  }

  async connect(handshakeInput: unknown): Promise<void> {
    if (this.socket) throw new Error("local channel client already connected");
    const handshake = RuntimeHandshakeRequestSchema.parse(handshakeInput);
    const socket = createConnection(this.endpoint);
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        }),
        this.timeoutMs,
        "local channel connect",
        () => socket.destroy(),
      );
      this.socket = socket;

      const response = await this.exchange(handshake, RuntimeHandshakeResponseSchema);
      const outcome = response.result;
      if (
        response.status !== "SUCCEEDED"
        || outcome?.status !== "COMPATIBLE"
        || outcome.negotiated_protocol_version === null
      ) {
        throw new Error(`local channel handshake rejected: ${outcome?.status ?? response.result_code}`);
      }
      if (!isContractVersionCompatible(outcome.negotiated_protocol_version, this.protocolRange)) {
        throw new Error("local channel negotiated protocol is outside client range");
      }
      this.negotiatedProtocol = outcome.negotiated_protocol_version;
    } catch (error) {
      socket.destroy();
      this.socket = undefined;
      throw error;
    }
  }

  request(requestInput: unknown): Promise<unknown> {
    const request = IpcRequestSchema.parse(requestInput);
    if (request.message_type === "runtime.handshake") {
      return Promise.reject(new Error("local channel handshake is only allowed during connect"));
    }

    return new Promise((resolve, reject) => {
      const run = this.requestQueue.then(async () => {
        try {
          const response = request.message_type === "runtime.status.get"
            ? await this.exchange(request, RuntimeStatusResponseSchema)
            : await this.exchange(request, OperationResultResponseSchema);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
      this.requestQueue = run.catch(() => undefined);
    });
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.negotiatedProtocol = undefined;
    if (!socket) return;

    await new Promise<void>((resolve) => {
      if (socket.destroyed) {
        resolve();
        return;
      }
      socket.once("close", () => resolve());
      socket.end();
      const timer = setTimeout(() => socket.destroy(), this.timeoutMs);
      timer.unref?.();
      socket.once("close", () => clearTimeout(timer));
    });
  }

  private async exchange<T extends { parse(input: unknown): any }>(
    request: NonHandshakeRequest | ReturnType<typeof RuntimeHandshakeRequestSchema.parse>,
    schema: T,
  ): Promise<ReturnType<T["parse"]>> {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("local channel client is not connected");

    if (request.message_type !== "runtime.handshake") {
      if (!this.negotiatedProtocol) throw new Error("local channel handshake is not complete");
      if (request.protocol_version !== this.negotiatedProtocol) {
        throw new Error("local channel request protocol does not match negotiated version");
      }
    }

    const requestSequence = this.nextRequestSequence;
    this.nextRequestSequence += 2;
    const expectedResponseSequence = requestSequence + 1;
    const protocolVersion = request.message_type === "runtime.handshake"
      ? request.protocol_version
      : this.negotiatedProtocol!;

    const responsePromise = this.receiveOne();
    socket.write(encodeFrame(
      this.authenticator.sign(request, protocolVersion, this.sessionId, requestSequence),
    ));

    try {
      const raw = await withTimeout(
        responsePromise,
        this.timeoutMs,
        "local channel request",
        () => socket.destroy(),
      );
      const frame = this.authenticator.verify(raw);
      if (frame.session_id !== this.sessionId || frame.sequence !== expectedResponseSequence) {
        throw new Error("local channel response transport identity mismatch");
      }

      const response = schema.parse(frame.payload);
      if (response.request_id !== request.request_id || response.correlation_id !== request.correlation_id) {
        throw new Error("local channel response request identity mismatch");
      }
      return response;
    } catch (error) {
      socket.destroy();
      this.socket = undefined;
      this.negotiatedProtocol = undefined;
      throw error;
    }
  }

  private receiveOne(): Promise<unknown> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("local channel client is not connected"));
    return new Promise((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        try {
          const frames = this.decoder.push(chunk);
          if (frames.length === 0) return;
          cleanup();
          if (frames.length !== 1) {
            reject(new Error("local channel client received unexpected coalesced responses"));
            return;
          }
          resolve(frames[0]);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const onClose = () => { cleanup(); reject(new Error("local channel socket closed before response")); };
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
}
