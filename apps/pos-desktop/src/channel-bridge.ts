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
    return this.channel.request(payload);
  }
}
