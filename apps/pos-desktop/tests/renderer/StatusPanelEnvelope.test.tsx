// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RuntimeStatusRequestSchema } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { StatusPanel } from "../../renderer/src/components/StatusPanel.js";

/**
 * El panel de estado contra el contrato real del sobre.
 *
 * Esto fija un defecto que estuvo vivo y no se veía: el hook enviaba el payload
 * **desnudo** (`{}`), y `channel/server.ts` valida **todo** request entrante con
 * `IpcRequestSchema`. `RuntimeStatusRequestSchema` exige el sobre completo, así
 * que el servicio rechazaba la consulta siempre y el panel mostraba «Sin
 * conexión» con el servicio vivo al otro lado del socket.
 *
 * Ninguna prueba lo detectaba porque todas usaban un doble que aceptaba
 * cualquier cosa. La diferencia está en parsear el sobre con el esquema real.
 */

const calls: unknown[] = [];

function install(response: unknown): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => { calls.push(payload); return Promise.resolve(response); };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

const connected = {
  status: "SUCCEEDED",
  result_code: "OK",
  result: { service_version: "1.0.0", protocol_version: "1.0.0" },
};

beforeEach(() => { calls.length = 0; });

describe("StatusPanel", () => {
  it("la consulta de estado viaja en un sobre que el contrato acepta", async () => {
    install(connected);
    render(<StatusPanel />);
    await waitFor(() => { expect(calls.length).toBeGreaterThan(0); });

    // La aserción que importa: el sobre real, no uno que el doble tolere.
    expect(() => RuntimeStatusRequestSchema.parse(calls[0])).not.toThrow();
  });

  it("no lleva identidad: el ámbito lo deriva la capa confiable", async () => {
    install(connected);
    render(<StatusPanel />);
    await waitFor(() => { expect(calls.length).toBeGreaterThan(0); });

    const request = calls[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty("tenant_id");
    expect(request).not.toHaveProperty("device_id");
    // Es una lectura: no muta y no lleva marcas de idempotencia.
    expect(request).not.toHaveProperty("idempotency_key");
  });

  it("un rechazo del servicio se muestra como desconexión, no como conectado", async () => {
    install({ status: "REJECTED", result_code: "PROTOCOL_VIOLATION", result: null });
    render(<StatusPanel />);
    await screen.findByTestId("status-error");

    expect(screen.queryByTestId("status-connected")).toBeNull();
    expect(screen.getByTestId("status-error").textContent).toContain("PROTOCOL_VIOLATION");
  });
});
