import { createServer, type Server, type Socket } from "node:net";
import { encodeFrame, FrameDecoder } from "./framing.js";
import type { LocalChannelAuthenticator } from "./authenticator.js";

export type ChannelHandler = (payload: unknown) => Promise<unknown>;
export class LocalChannelServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  constructor(private readonly endpoint: string, private readonly authenticator: LocalChannelAuthenticator, private readonly handler: ChannelHandler, private readonly maxConnections = 32) {}

  async start(): Promise<void> {
    if (this.server) throw new Error("local channel server already started");
    const server = createServer((socket) => {
      if (this.sockets.size >= this.maxConnections) { socket.destroy(); return; }
      this.sockets.add(socket); const decoder = new FrameDecoder();
      let queue = Promise.resolve();
      socket.on("data", (chunk) => {
        try {
          for (const raw of decoder.push(chunk)) {
            queue = queue.then(async () => {
              if (socket.destroyed) return;
              const request = this.authenticator.verify(raw);
              const result = await this.handler(request.payload);
              socket.write(encodeFrame(this.authenticator.sign(result, request.protocol_version, request.session_id, request.sequence + 1)));
            }).catch(() => socket.destroy());
          }
        } catch { socket.destroy(); }
      });
      socket.once("close", () => this.sockets.delete(socket));
      socket.once("error", () => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.endpoint, () => { server.off("error", reject); resolve(); });
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server; if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    this.server = undefined;
  }
}
