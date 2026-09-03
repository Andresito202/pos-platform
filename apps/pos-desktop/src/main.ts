import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { WINDOW_SECURITY_CONFIG } from "./window-security.js";
import { IPC_ALLOWED_CHANNELS, isAllowedChannel } from "./ipc-allowlist.js";
import { ChannelBridge, type ServiceChannel } from "./channel-bridge.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function registerIpcHandlers(bridge: ChannelBridge): void {
  for (const channel of IPC_ALLOWED_CHANNELS) {
    ipcMain.handle(channel, (_event, payload: unknown) => bridge.handleInvoke(channel, payload));
  }
}

function createWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      ...WINDOW_SECURITY_CONFIG.webPreferences,
      preload: preloadPath,
    },
  });
  win.on("ready-to-show", () => win.show());
  return win;
}

// Validates channel at startup — any channel outside the allowlist would indicate
// a configuration mismatch between ipc-allowlist and channel-bridge.
function assertAllowlistConsistency(): void {
  for (const channel of IPC_ALLOWED_CHANNELS) {
    if (!isAllowedChannel(channel)) {
      throw new Error(`Allowlist inconsistency: ${channel}`);
    }
  }
}

export async function bootstrap(serviceChannel: ServiceChannel): Promise<void> {
  assertAllowlistConsistency();
  const bridge = new ChannelBridge(serviceChannel);
  const preloadPath = join(__dirname, "preload.js");

  await app.whenReady();
  registerIpcHandlers(bridge);
  createWindow(preloadPath);

  app.on("window-all-closed", () => {
    void serviceChannel.close().finally(() => app.quit());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(preloadPath);
    }
  });
}
