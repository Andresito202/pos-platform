import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { WINDOW_SECURITY_CONFIG } from "./window-security.js";
import { IPC_ALLOWED_CHANNELS, isAllowedChannel } from "./ipc-allowlist.js";
import { ChannelBridge, type ServiceChannel } from "./channel-bridge.js";
import { QrCheckoutWindowManager, type QrCheckoutOpenRequest } from "./qr-checkout-window.js";
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

function isQrCheckoutOpenRequest(payload: unknown): payload is QrCheckoutOpenRequest {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Record<string, unknown>;
  return typeof candidate["paymentId"] === "string" && candidate["paymentId"].trim() !== ""
    && typeof candidate["checkoutUrl"] === "string" && candidate["checkoutUrl"].trim() !== "";
}

/**
 * Canales nativos — nunca pasan por `ChannelBridge`, no hay servicio local
 * que consultar. `payment.qr.checkout.open` no lleva el sobre comercial
 * (`operation_id`/`idempotency_key`/`correlation_id`): abrir una ventana no
 * es una operación financiera, así que no necesita esa disciplina —
 * `ReconcileProviderPaymentUseCase`, que sí lo es, la sigue exigiendo por su
 * propio canal (`pos:payment.qr.reconcile`, en `IPC_ALLOWED_CHANNELS`).
 */
function registerNativeIpcHandlers(
  qrCheckoutWindowManager: QrCheckoutWindowManager,
  getMainWindow: () => BrowserWindow | undefined,
): void {
  ipcMain.handle("pos:payment.qr.checkout.open", (_event, payload: unknown) => {
    if (!isQrCheckoutOpenRequest(payload)) {
      throw new Error("payment.qr.checkout.open: paymentId and checkoutUrl are required");
    }
    return qrCheckoutWindowManager.openCheckout(payload, getMainWindow());
  });
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
  qrCheckoutWindowManager: QrCheckoutWindowManager = new QrCheckoutWindowManager(),
): Promise<void> {
  assertAllowlistConsistency();
  const bridge = new ChannelBridge(serviceChannel);
  const preloadPath = join(__dirname, PRELOAD_FILENAME);
  const rendererPath = join(__dirname, RENDERER_DIRECTORY, RENDERER_ENTRY_FILENAME);

  let currentWindow: BrowserWindow | undefined;

  await app.whenReady();
  registerIpcHandlers(bridge);
  registerNativeIpcHandlers(qrCheckoutWindowManager, () => currentWindow);
  currentWindow = createWindow(preloadPath);
  await currentWindow.loadFile(rendererPath);

  app.on("window-all-closed", () => {
    void closeChannelAndQuit(serviceChannel, logger);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createWindow(preloadPath);
      currentWindow = reopened;
      void reopened.loadFile(rendererPath).catch((error: unknown) => {
        reportFailure(logger, "desktop.renderer_load_failed", error);
      });
    }
  });
}
