import { join } from "node:path";
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function localChannelEndpoint(installationId: string, platform: NodeJS.Platform = process.platform, testDirectory?: string): string {
  if (!INSTALLATION_ID.test(installationId)) throw new Error("invalid installation id for local channel");
  const safeId = installationId.toLowerCase();
  if (platform === "win32") return `\\\\.\\pipe\\camacho-pos-${safeId}`;
  if (!testDirectory) throw new Error("production local channel requires Windows named pipes");
  return join(testDirectory, `camacho-pos-${safeId}.sock`);
}
