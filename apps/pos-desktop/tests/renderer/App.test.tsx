// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../../renderer/src/App.js";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";

/**
 * El doble se deriva de `RENDERER_API_METHODS`, no de una lista a mano.
 *
 * La versión anterior fijaba tres métodos. Cuando `SessionPanel` empezó a
 * consultar al montar, el doble no tenía `session.recover`: la llamada
 * reventaba, el panel degradaba a error y **la suite seguía en verde**, porque
 * ninguna aserción lo miraba. Es la misma deriva de listas fijadas a mano que
 * dejó la superficie comercial inalcanzable durante tres bloques.
 *
 * Una promesa que nunca resuelve deja a cada panel en su estado inicial, que es
 * lo que estas pruebas observan.
 */
function makeService(): Record<string, ReturnType<typeof vi.fn>> {
  const service: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = vi.fn().mockReturnValue(new Promise<never>(() => undefined));
  }
  return service;
}

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: makeService(),
    writable: true,
    configurable: true,
  });
});

describe("App", () => {
  it("renders the POS Local heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /POS Local/i })).toBeTruthy();
  });

  it("monta el panel de sesión primero: es la precondición del resto", () => {
    render(<App />);
    // Sin vínculo de sesión toda operación de abajo se rechaza con
    // `SESSION_NOT_BOUND`; que el panel exista es lo que hace diagnosticable
    // esa situación en un equipo real.
    expect(screen.getByTestId("session-panel")).toBeTruthy();
    expect(screen.getByTestId("session-checking")).toBeTruthy();
    expect(screen.queryByTestId("session-error")).toBeNull();
  });

  it("renders the status panel in loading state initially", () => {
    render(<App />);
    expect(screen.getByTestId("status-loading")).toBeTruthy();
  });

  it("renders the operation panel", () => {
    render(<App />);
    expect(screen.getByTestId("operation-panel")).toBeTruthy();
  });

  it("renders the operation id input", () => {
    render(<App />);
    expect(screen.getByTestId("operation-id-input")).toBeTruthy();
  });

  it("renders get-result and confirm buttons", () => {
    render(<App />);
    expect(screen.getByTestId("get-result-button")).toBeTruthy();
    expect(screen.getByTestId("confirm-button")).toBeTruthy();
  });

  it("reparte los 13 paneles en secciones con un menú lateral, empezando en Inicio", () => {
    const { container } = render(<App />);
    const targets = [...container.querySelectorAll("[data-nav-target]")].map((item) => item.getAttribute("data-nav-target"));
    expect(targets).toEqual(["inicio", "vender", "devoluciones", "catalogo", "inventario", "clientes", "facturacion", "operaciones"]);
    expect(screen.getByTestId("app-section-title").textContent).toBe("Inicio");
    expect(container.querySelector('[data-nav-target="inicio"]')?.getAttribute("aria-current")).toBe("page");
    expect((container.querySelector('[data-nav-section="inicio"]') as HTMLElement).hidden).toBe(false);
    expect((container.querySelector('[data-nav-section="vender"]') as HTMLElement).hidden).toBe(true);
  });

  it("cada panel vive en exactamente una sección y ninguno se queda fuera", () => {
    const { container } = render(<App />);
    const expected: Record<string, string[]> = {
      inicio: ["session-panel"],
      vender: ["sale-panel", "provider-payment-panel", "receipt-panel"],
      devoluciones: ["return-panel"],
      catalogo: ["catalog-import-panel", "catalog-panel"],
      inventario: ["inventory-panel", "lot-panel"],
      clientes: ["customer-panel", "credit-panel"],
      facturacion: ["fiscal-panel"],
      operaciones: ["operation-panel"],
    };
    for (const [section, panels] of Object.entries(expected)) {
      const host = container.querySelector(`[data-nav-section="${section}"]`)!;
      const found = [...host.querySelectorAll('[data-testid$="-panel"]')].map((node) => node.getAttribute("data-testid"));
      expect(found, section).toEqual(panels);
    }
  });

  it("cambiar de sección oculta la anterior sin desmontarla: lo escrito sigue ahí al volver", () => {
    const { container } = render(<App />);
    const input = screen.getByTestId("operation-id-input") as HTMLInputElement;
    fireEvent.click(container.querySelector('[data-nav-target="operaciones"]')!);
    expect(screen.getByTestId("app-section-title").textContent).toBe("Operaciones");
    fireEvent.change(input, { target: { value: "escrito-antes-de-salir" } });

    fireEvent.click(container.querySelector('[data-nav-target="vender"]')!);
    expect((container.querySelector('[data-nav-section="operaciones"]') as HTMLElement).hidden).toBe(true);
    expect(container.querySelector('[data-nav-target="vender"]')?.getAttribute("aria-current")).toBe("page");

    fireEvent.click(container.querySelector('[data-nav-target="operaciones"]')!);
    expect(screen.getByTestId("operation-id-input")).toBe(input);
    expect(input.value).toBe("escrito-antes-de-salir");
  });
});
