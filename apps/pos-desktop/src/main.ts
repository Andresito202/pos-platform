import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { WINDOW_SECURITY_CONFIG } from "./window-security.js";
import { IPC_ALLOWED_CHANNELS, isAllowedChannel } from "./ipc-allowlist.js";
import { ChannelBridge, type ServiceChannel } from "./channel-bridge.js";
import {
  PRELOAD_FILENAME,
  RENDERER_DIRECTORY,
  RENDERER_ENTRY_FILENAME,
} from "./build-layout.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Structural subset of StructuredLogger: main only reports shutdown and
// renderer-load failures, so it does not depend on the full logger surface.
export interface DesktopLogger {
  log(level: "error", event: string, fields: Readonly<Record<string, unknown>>): void;
}

// The logger is best-effort: StructuredLogger.log throws on a failed sink or an
// exhausted buffer, and a shutdown must never be blocked by its own telemetry.
function reportFailure(
  logger: DesktopLogger | undefined,
  event: string,
  error: unknown,
): void {
  try {
    logger?.log("error", event, {
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Telemetry failure must not mask the original error nor stop the caller.
  }
}

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

// Awaiting close() inside the handler would leave the rejection unhandled, so the
// failure is captured here and app.quit() still runs on every path.
async function closeChannelAndQuit(
  serviceChannel: ServiceChannel,
  logger: DesktopLogger | undefined,
): Promise<void> {
  try {
    await serviceChannel.close();
  } catch (error) {
    reportFailure(logger, "desktop.service_channel_close_failed", error);
  } finally {
    app.quit();
  }
}

export async function bootstrap(
  serviceChannel: ServiceChannel,
  logger?: DesktopLogger,
): Promise<void> {
  assertAllowlistConsistency();
  const bridge = new ChannelBridge(serviceChannel);
  const preloadPath = join(__dirname, PRELOAD_FILENAME);
  const rendererPath = join(__dirname, RENDERER_DIRECTORY, RENDERER_ENTRY_FILENAME);

  await app.whenReady();
  registerIpcHandlers(bridge);
  const win = createWindow(preloadPath);
  await win.loadFile(rendererPath);

  app.on("window-all-closed", () => {
    void closeChannelAndQuit(serviceChannel, logger);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createWindow(preloadPath);
      void reopened.loadFile(rendererPath).catch((error: unknown) => {
        reportFailure(logger, "desktop.renderer_load_failed", error);
      });
    }
  });
}
