import { isAllowedChannel } from "./ipc-allowlist.js";

export interface ServiceChannel {
  request(requestInput: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export class ChannelBridge {
  constructor(private readonly channel: ServiceChannel) {}

  async handleInvoke(ipcChannel: string, payload: unknown): Promise<unknown> {
    if (!isAllowedChannel(ipcChannel)) {
      throw new Error(`IPC channel not allowed: ${ipcChannel}`);
    }
    // Never forward a different request type through an allowlisted IPC method.
    // The service validates the rest of the canonical envelope.
    const messageType = ipcChannel.slice("pos:".length);
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      !("message_type" in payload) ||
      payload.message_type !== messageType
    ) {
      throw new Error(`IPC message type does not match channel: ${ipcChannel}`);
    }
    return this.channel.request(payload);
  }
}
