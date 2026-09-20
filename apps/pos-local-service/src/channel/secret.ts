import { loadOrCreateWindowsLocalChannelSecret as loadSharedWindowsLocalChannelSecret } from "@pos-platform/local-channel";

export function loadOrCreateWindowsLocalChannelSecret(
  dataDirectory: string,
  installationId: string,
  platform: NodeJS.Platform = process.platform,
): Buffer {
  return loadSharedWindowsLocalChannelSecret(dataDirectory, installationId, platform);
}
