// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
