import { describe, expect, it, vi, beforeEach } from "vitest";
import { WINDOW_SECURITY_CONFIG } from "../src/window-security.js";
import {
  WOMPI_CHECKOUT_RETURN_URL,
  extractTransactionId,
  matchesReturnUrl,
} from "../src/qr-checkout-window.js";

describe("matchesReturnUrl", () => {
  it("matches when origin and pathname are exactly equal", () => {
    expect(matchesReturnUrl(
      `${WOMPI_CHECKOUT_RETURN_URL}?id=1292-160-1&environment=test`,
    )).toBe(true);
  });

  it("does not match a different origin, even with the same path", () => {
    expect(matchesReturnUrl("https://checkout.wompi.co/wompi/return?id=1")).toBe(false);
  });

  it("does not match a different pathname on the same origin", () => {
    expect(matchesReturnUrl("https://payments.camacho.internal/other/path?id=1")).toBe(false);
  });

  it("does not match by substring — a query string cannot fake the origin", () => {
    expect(matchesReturnUrl(
      `https://attacker.test/?next=${encodeURIComponent(WOMPI_CHECKOUT_RETURN_URL)}`,
    )).toBe(false);
  });

  it("returns false for a malformed URL instead of throwing", () => {
    expect(matchesReturnUrl("not a url")).toBe(false);
  });

  it("accepts an overridden return URL", () => {
    const custom = "pos-camacho://payments/wompi/return";
    expect(matchesReturnUrl(`${custom}?id=1`, custom)).toBe(true);
    expect(matchesReturnUrl(`${WOMPI_CHECKOUT_RETURN_URL}?id=1`, custom)).toBe(false);
  });
});

describe("extractTransactionId", () => {
  it("reads Wompi's id query parameter", () => {
    expect(extractTransactionId(`${WOMPI_CHECKOUT_RETURN_URL}?id=1292-1602113476-10985`))
      .toBe("1292-1602113476-10985");
  });

  it("returns null when id is absent", () => {
    expect(extractTransactionId(WOMPI_CHECKOUT_RETURN_URL)).toBeNull();
  });

  it("returns null for a blank id", () => {
    expect(extractTransactionId(`${WOMPI_CHECKOUT_RETURN_URL}?id=`)).toBeNull();
  });

  it("returns null for a malformed URL instead of throwing", () => {
    expect(extractTransactionId("not a url")).toBeNull();
  });
});

// ── QrCheckoutWindowManager ──────────────────────────────────────────────────

interface FakeEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}

/**
 * `vi.mock` se eleva por encima de **todos** los imports del archivo,
 * incluidos los estáticos de `matchesReturnUrl`/`extractTransactionId` de
 * más arriba — que ya fuerzan la carga de `qr-checkout-window.ts` (y, con
 * ella, la resolución de este mock) antes de que el resto del módulo de
 * prueba se termine de ejecutar. `vi.hoisted` es lo único que garantiza que
 * `FakeBrowserWindow` exista para entonces.
 */
const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    options: Record<string, unknown>;
    loadURL = vi.fn().mockResolvedValue(undefined);
    closed = false;
    private readonly closedHandlers: Array<() => void> = [];
    private readonly webContentsHandlers = new Map<string, Array<(event: FakeEvent, url: string) => void>>();
    readonly webContents = {
      on: (event: string, handler: (event: FakeEvent, url: string) => void) => {
        const handlers = this.webContentsHandlers.get(event) ?? [];
        handlers.push(handler);
        this.webContentsHandlers.set(event, handlers);
      },
      setWindowOpenHandler: vi.fn(),
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeBrowserWindow.instances.push(this);
    }

    on(event: string, handler: () => void): void {
      if (event === "closed") this.closedHandlers.push(handler);
    }

    close(): void {
      if (this.closed) return;
      this.closed = true;
      for (const handler of [...this.closedHandlers]) handler();
    }

    /** Simula que `webContents` dispara `event` navegando a `url`. */
    emit(event: "will-navigate" | "will-redirect", url: string): FakeEvent {
      const fakeEvent: FakeEvent = { preventDefault: vi.fn() };
      for (const handler of this.webContentsHandlers.get(event) ?? []) handler(fakeEvent, url);
      return fakeEvent;
    }
  }
  return { FakeBrowserWindow };
});

vi.mock("electron", () => ({ BrowserWindow: FakeBrowserWindow }));

beforeEach(() => {
  FakeBrowserWindow.instances.length = 0;
});

async function importManager() {
  const mod = await import("../src/qr-checkout-window.js");
  return mod.QrCheckoutWindowManager;
}

describe("QrCheckoutWindowManager", () => {
  it("opens the checkout window with the hardened webPreferences and no preload", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    void manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });

    const win = FakeBrowserWindow.instances[0];
    expect(win).toBeDefined();
    const prefs = win?.options["webPreferences"] as Record<string, unknown>;
    for (const [key, value] of Object.entries(WINDOW_SECURITY_CONFIG.webPreferences)) {
      expect(prefs[key]).toBe(value);
    }
    expect(prefs["preload"]).toBeUndefined();
  });

  it("loads the checkout URL and denies any popup the checkout tries to open", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    void manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });

    const win = FakeBrowserWindow.instances[0]!;
    expect(win.loadURL).toHaveBeenCalledWith("https://checkout.wompi.co/p/?ref=1");
    const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as () => { action: string };
    expect(openHandler()).toEqual({ action: "deny" });
  });

  it("resolves REDIRECTED and closes the window when the return URL is navigated to", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;

    const event = win.emit("will-redirect", "https://payments.camacho.internal/wompi/return?id=TX-1");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.closed).toBe(true);

    await expect(result).resolves.toEqual({
      outcome: "REDIRECTED", paymentId: "payment-1", providerTransactionId: "TX-1",
    });
  });

  it("also catches a client-side redirect via will-navigate", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;
    win.emit("will-navigate", "https://payments.camacho.internal/wompi/return?id=TX-2");

    await expect(result).resolves.toEqual({
      outcome: "REDIRECTED", paymentId: "payment-1", providerTransactionId: "TX-2",
    });
  });

  it("ignores an intermediate navigation that does not match the return URL", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;

    // Un salto intermedio del flujo real (banco, 3DS) no debe cerrar la ventana.
    const intermediate = win.emit("will-navigate", "https://bank.example.test/3ds/challenge");
    expect(intermediate.preventDefault).not.toHaveBeenCalled();
    expect(win.closed).toBe(false);

    win.emit("will-redirect", "https://payments.camacho.internal/wompi/return?id=TX-3");
    await expect(result).resolves.toMatchObject({ outcome: "REDIRECTED" });
  });

  it("resolves REDIRECT_MISSING_TRANSACTION_ID when Wompi's redirect carries no id", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;
    win.emit("will-redirect", "https://payments.camacho.internal/wompi/return");

    await expect(result).resolves.toEqual({
      outcome: "REDIRECT_MISSING_TRANSACTION_ID", paymentId: "payment-1",
    });
  });

  it("resolves CLOSED_BY_USER when the window closes without ever matching the return URL", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;
    win.close();

    await expect(result).resolves.toEqual({ outcome: "CLOSED_BY_USER", paymentId: "payment-1" });
  });

  it("resolves INVALID_CHECKOUT_URL without ever opening a window for a malformed checkout URL", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = await manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "not a url" });

    expect(result).toEqual({ outcome: "INVALID_CHECKOUT_URL", paymentId: "payment-1" });
    expect(FakeBrowserWindow.instances).toHaveLength(0);
  });

  it("never resolves twice — a redirect followed by the window's own close event keeps the first result", async () => {
    const QrCheckoutWindowManager = await importManager();
    const manager = new QrCheckoutWindowManager();

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;
    win.emit("will-redirect", "https://payments.camacho.internal/wompi/return?id=TX-4");
    // `close()` inside the handler already fired "closed"; firing it again
    // (as a real window's own close sequence might) must not change the result.
    win.close();

    await expect(result).resolves.toEqual({
      outcome: "REDIRECTED", paymentId: "payment-1", providerTransactionId: "TX-4",
    });
  });

  it("uses a custom configured return URL instead of the default", async () => {
    const QrCheckoutWindowManager = await importManager();
    const customReturnUrl = "pos-camacho://payments/wompi/return";
    const manager = new QrCheckoutWindowManager(customReturnUrl);

    const result = manager.openCheckout({ paymentId: "payment-1", checkoutUrl: "https://checkout.wompi.co/p/?ref=1" });
    const win = FakeBrowserWindow.instances[0]!;

    // El sentinel por defecto ya no coincide con el retorno configurado.
    const missed = win.emit("will-navigate", `${WOMPI_CHECKOUT_RETURN_URL}?id=TX-WRONG`);
    expect(missed.preventDefault).not.toHaveBeenCalled();

    win.emit("will-navigate", `${customReturnUrl}?id=TX-5`);
    await expect(result).resolves.toEqual({
      outcome: "REDIRECTED", paymentId: "payment-1", providerTransactionId: "TX-5",
    });
  });
});
