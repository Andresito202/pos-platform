import { describe, it, expect, vi, beforeEach } from "vitest";
import { IPC_ALLOWED_CHANNELS, NATIVE_IPC_CHANNELS } from "../src/ipc-allowlist.js";
import { WINDOW_SECURITY_CONFIG } from "../src/window-security.js";
import type { ServiceChannel } from "../src/channel-bridge.js";
import type { QrCheckoutWindowManager } from "../src/qr-checkout-window.js";
import { PRELOAD_FILENAME } from "../src/build-layout.js";

interface CapturedWindow {
  options: Record<string, unknown>;
  loadFile: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
}

const created: CapturedWindow[] = [];
const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
const appEvents = new Map<string, () => void>();
const quit = vi.fn();

vi.mock("electron", () => {
  class BrowserWindow {
    static instances: CapturedWindow[] = created;
    loadFile = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    show = vi.fn();
    constructor(options: Record<string, unknown>) {
      created.push(this as unknown as CapturedWindow);
      (this as unknown as CapturedWindow).options = options;
    }
    static getAllWindows(): CapturedWindow[] {
      return created;
    }
  }
  return {
    app: {
      whenReady: () => Promise.resolve(),
      on: (event: string, listener: () => void) => {
        appEvents.set(event, listener);
      },
      quit,
    },
    BrowserWindow,
    ipcMain: {
      handle: (channel: string, listener: (event: unknown, payload: unknown) => unknown) => {
        handlers.set(channel, listener);
      },
    },
  };
});

function makeServiceChannel(): ServiceChannel & {
  request: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn().mockResolvedValue({ status: "SUCCEEDED" }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeQrCheckoutWindowManager(): QrCheckoutWindowManager & { openCheckout: ReturnType<typeof vi.fn> } {
  return { openCheckout: vi.fn().mockResolvedValue({ outcome: "CLOSED_BY_USER", paymentId: "payment-1" }) } as never;
}

async function bootstrapWith(
  channel: ServiceChannel,
  qrCheckoutWindowManager?: QrCheckoutWindowManager,
): Promise<void> {
  const { bootstrap } = await import("../src/main.js");
  await bootstrap(channel, undefined, qrCheckoutWindowManager);
}

beforeEach(() => {
  created.length = 0;
  handlers.clear();
  appEvents.clear();
  quit.mockClear();
  vi.resetModules();
});

const ALL_REGISTERED_CHANNELS = [...IPC_ALLOWED_CHANNELS, ...NATIVE_IPC_CHANNELS];

describe("main bootstrap IPC registration", () => {
  it("registers a handler for every allowlisted channel, commercial and native", async () => {
    await bootstrapWith(makeServiceChannel());
    expect([...handlers.keys()].sort()).toEqual([...ALL_REGISTERED_CHANNELS].sort());
  });

  it("registers no channel outside the allowlists", async () => {
    await bootstrapWith(makeServiceChannel());
    for (const channel of handlers.keys()) {
      expect(ALL_REGISTERED_CHANNELS).toContain(channel);
    }
  });

  it("forwards an allowlisted invoke to the service channel", async () => {
    const service = makeServiceChannel();
    await bootstrapWith(service);
    const handler = handlers.get("pos:operation.confirm");
    const payload = { operation_id: "op-99" };
    await handler?.({}, payload);
    expect(service.request).toHaveBeenCalledWith(payload);
  });

  it("propagates service channel failures to the caller", async () => {
    const service = makeServiceChannel();
    service.request.mockRejectedValue(new Error("servicio local caido"));
    await bootstrapWith(service);
    const handler = handlers.get("pos:runtime.status.get");
    await expect(handler?.({}, {})).rejects.toThrow("servicio local caido");
  });
});

describe("main bootstrap — pos:payment.qr.checkout.open (native, not forwarded)", () => {
  it("opens the checkout window against the current main window, not the service channel", async () => {
    const service = makeServiceChannel();
    const manager = fakeQrCheckoutWindowManager();
    await bootstrapWith(service, manager);

    const handler = handlers.get("pos:payment.qr.checkout.open");
    const payload = { paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" };
    await handler?.({}, payload);

    expect(manager.openCheckout).toHaveBeenCalledWith(payload, created[0]);
    expect(service.request).not.toHaveBeenCalled();
  });

  it("rejects a payload missing paymentId or checkoutUrl without ever opening a window", async () => {
    const manager = fakeQrCheckoutWindowManager();
    await bootstrapWith(makeServiceChannel(), manager);

    const handler = handlers.get("pos:payment.qr.checkout.open");
    // El handler lanza de forma síncrona — Electron envuelve ese throw en una
    // promesa rechazada para el renderer; el arnés de prueba, al invocarlo
    // directamente, no reproduce ese envoltorio.
    expect(() => handler?.({}, { paymentId: "payment-1" })).toThrow();
    expect(manager.openCheckout).not.toHaveBeenCalled();
  });
});

describe("main bootstrap window security", () => {
  it("creates the window with the hardened webPreferences", async () => {
    await bootstrapWith(makeServiceChannel());
    const prefs = created[0]?.options["webPreferences"] as Record<string, unknown>;
    for (const [key, value] of Object.entries(WINDOW_SECURITY_CONFIG.webPreferences)) {
      expect(prefs[key]).toBe(value);
    }
  });

  it("enforces contextIsolation, sandbox and no nodeIntegration", async () => {
    await bootstrapWith(makeServiceChannel());
    const prefs = created[0]?.options["webPreferences"] as Record<string, unknown>;
    expect(prefs["contextIsolation"]).toBe(true);
    expect(prefs["sandbox"]).toBe(true);
    expect(prefs["nodeIntegration"]).toBe(false);
  });

  it("attaches a preload script to the window", async () => {
    await bootstrapWith(makeServiceChannel());
    const prefs = created[0]?.options["webPreferences"] as Record<string, unknown>;
    // Se compara contra `PRELOAD_FILENAME`, no contra un literal: fue un
    // literal el que hizo que esta prueba siguiera verde mientras el preload
    // real dejaba de cargarse.
    expect(String(prefs["preload"]).endsWith(PRELOAD_FILENAME)).toBe(true);
  });

  it("loads the local renderer entry point instead of a remote URL", async () => {
    await bootstrapWith(makeServiceChannel());
    const loaded = String(created[0]?.loadFile.mock.calls[0]?.[0]);
    expect(loaded).toMatch(/renderer[\\/]index\.html$/);
  });
});

describe("main bootstrap lifecycle", () => {
  it("closes the service channel when all windows are closed", async () => {
    const service = makeServiceChannel();
    await bootstrapWith(service);
    appEvents.get("window-all-closed")?.();
    await vi.waitFor(() => expect(service.close).toHaveBeenCalledTimes(1));
  });

  it("quits the app after closing the service channel", async () => {
    const service = makeServiceChannel();
    await bootstrapWith(service);
    appEvents.get("window-all-closed")?.();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
  });

  it("still quits when closing the service channel fails", async () => {
    const service = makeServiceChannel();
    service.close.mockRejectedValue(new Error("cierre sucio"));
    await bootstrapWith(service);
    appEvents.get("window-all-closed")?.();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
  });

  it("reports the close failure through the injected logger", async () => {
    const service = makeServiceChannel();
    service.close.mockRejectedValue(new Error("cierre sucio"));
    const logger = { log: vi.fn() };
    const { bootstrap } = await import("../src/main.js");
    await bootstrap(service, logger);
    appEvents.get("window-all-closed")?.();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "desktop.service_channel_close_failed",
      { error: "cierre sucio" },
    );
  });

  it("does not leak an unhandled rejection when close fails", async () => {
    const service = makeServiceChannel();
    service.close.mockRejectedValue(new Error("cierre sucio"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await bootstrapWith(service);
      appEvents.get("window-all-closed")?.();
      await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("still quits when the logger itself throws", async () => {
    const service = makeServiceChannel();
    service.close.mockRejectedValue(new Error("cierre sucio"));
    const logger = {
      log: vi.fn(() => {
        throw new Error("log sink is failed");
      }),
    };
    const { bootstrap } = await import("../src/main.js");
    await bootstrap(service, logger);
    appEvents.get("window-all-closed")?.();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
  });
});
