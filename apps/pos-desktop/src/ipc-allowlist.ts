export const IPC_ALLOWED_CHANNELS = [
  "pos:runtime.status.get",
  "pos:operation.result.get",
  "pos:operation.confirm",
] as const;

export type IpcAllowedChannel = (typeof IPC_ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is IpcAllowedChannel {
  return (IPC_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}
