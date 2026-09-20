// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionRecoverRequestSchema } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { SessionPanel } from "../../renderer/src/components/SessionPanel.js";

/**
 * La pantalla de sesión contra respuestas controladas.
 *
 * Lo que se prueba es lo que sólo la pantalla puede equivocar: **qué sobre
 * construye** —parseado con el esquema real, no dado por bueno— y **cómo
 * distingue los tres desenlaces**. `NONE` y `UNVERIFIABLE` no son el mismo
 * problema y no se resuelven igual: uno pide activar el equipo, el otro pide
 * mirar por qué la sesión almacenada no se puede verificar.
 */

const SESSION = "0199aa00-0000-7000-8000-00000000f001";

const calls = new Map<string, unknown[]>();

function install(canned: unknown): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      return Promise.resolve(canned);
    };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

function sent(method: string): Record<string, unknown> {
  const seen = calls.get(method) ?? [];
  expect(seen.length).toBeGreaterThan(0);
  return seen[0] as Record<string, unknown>;
}

const active = {
  status: "SUCCEEDED",
  result_code: "ACTIVE",
  result: {
    outcome: "ACTIVE",
    session_id: SESSION,
    offline_valid_until: "2026-09-21T00:00:00.000Z",
    decision: null,
  },
};

const none = {
  status: "SUCCEEDED",
  result_code: "NONE",
  result: { outcome: "NONE", session_id: null, offline_valid_until: null, decision: null },
};

const unverifiable = {
  status: "REJECTED",
  result_code: "UNVERIFIABLE",
  result: {
    outcome: "UNVERIFIABLE",
    session_id: null,
    offline_valid_until: null,
    decision: "AMBIGUOUS_DEVICE_SESSION",
  },
};

beforeEach(() => { calls.clear(); });

describe("SessionPanel", () => {
  it("consulta la sesión al montar, sin que nadie pulse nada", async () => {
    install(active);
    render(<SessionPanel />);
    await screen.findByTestId("session-active");

    expect(calls.get("session.recover")?.length).toBe(1);
  });

  it("el sobre de recuperación cumple el contrato y no lleva identidad", async () => {
    install(active);
    render(<SessionPanel />);
    await screen.findByTestId("session-active");

    const request = sent("session.recover");
    expect(() => SessionRecoverRequestSchema.parse(request)).not.toThrow();
    // El ámbito lo deriva la capa confiable de `installation_id`/`device_id`
    // locales. Nombrarlos aquí sería afirmar identidad desde el renderer.
    expect(request).not.toHaveProperty("tenant_id");
    expect(request).not.toHaveProperty("device_id");
    expect(request).not.toHaveProperty("installation_id");
    expect(request["payload"]).toEqual({});
  });

  it("recuperar no es una mutación: el sobre no lleva marcas de idempotencia", async () => {
    install(active);
    render(<SessionPanel />);
    await screen.findByTestId("session-active");

    const request = sent("session.recover");
    expect(request).not.toHaveProperty("idempotency_key");
    expect(request).not.toHaveProperty("operation_id");
  });

  it("una sesión activa muestra su identificador y su ventana offline literales", async () => {
    install(active);
    render(<SessionPanel />);
    await screen.findByTestId("session-active");

    expect(screen.getByTestId("session-id").textContent).toBe(SESSION);
    expect(screen.getByTestId("session-offline-valid-until").textContent)
      .toBe("2026-09-21T00:00:00.000Z");
    expect(screen.queryByTestId("session-none")).toBeNull();
    expect(screen.queryByTestId("session-unverifiable")).toBeNull();
  });

  it("sin sesión lo dice, y no lo confunde con un fallo", async () => {
    install(none);
    render(<SessionPanel />);
    await screen.findByTestId("session-none");

    expect(screen.queryByTestId("session-active")).toBeNull();
    expect(screen.queryByTestId("session-error")).toBeNull();
  });

  it("una sesión no verificable nombra la causa que emitió el servicio", async () => {
    // Es un rechazo del sobre y aun así un desenlace que el cajero debe ver:
    // tratarlo como error de transporte le ocultaría la única pista útil.
    install(unverifiable);
    render(<SessionPanel />);
    await screen.findByTestId("session-unverifiable");

    expect(screen.getByTestId("session-decision").textContent).toBe("AMBIGUOUS_DEVICE_SESSION");
    expect(screen.queryByTestId("session-none")).toBeNull();
    expect(screen.queryByTestId("session-error")).toBeNull();
  });

  it("reintentar vuelve a preguntar al servicio", async () => {
    install(none);
    render(<SessionPanel />);
    await screen.findByTestId("session-none");

    fireEvent.click(screen.getByTestId("recover-session-button"));
    await waitFor(() => { expect(calls.get("session.recover")?.length).toBe(2); });
  });

  it("no ofrece activar: la SSA la emite una autoridad que aún no existe (D-28)", async () => {
    install(none);
    render(<SessionPanel />);
    await screen.findByTestId("session-none");

    // Un botón de activar aquí tendría que fabricar una SSA. El servicio la
    // rechazaría con `SIGNATURE_INVALID`, y la pantalla habría sugerido que el
    // problema es del cajero.
    expect(calls.get("session.activate")).toBeUndefined();
    expect(screen.queryByTestId("activate-session-button")).toBeNull();
  });

  it("un resultado nulo sí es un fallo, y se muestra por su código", async () => {
    install({ status: "REJECTED", result_code: "SESSION_STORE_UNAVAILABLE", result: null });
    render(<SessionPanel />);
    await screen.findByTestId("session-error");

    expect(screen.getByTestId("session-error").textContent).toBe("SESSION_STORE_UNAVAILABLE");
    expect(screen.queryByTestId("session-active")).toBeNull();
  });
});
