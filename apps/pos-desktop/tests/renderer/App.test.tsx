// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "../../renderer/src/App.js";

function makeService() {
  return {
    "runtime.status.get": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
    "authorization.capabilities.get": vi.fn().mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: { outcome: "AVAILABLE", permissions: [] },
    }),
    "operation.result.get": vi.fn(),
    "operation.confirm": vi.fn(),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: makeService(),
    writable: true,
    configurable: true,
  });
});

describe("App", () => {
  it("shows only navigation areas covered by effective permissions", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["CATALOG_PRODUCT_READ", "CUSTOMERS_CUSTOMER_READ", "SALES_RECEIPT_READ"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Catálogo" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clientes" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Comprobantes" })).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Caja y ventas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Inventario" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Catálogo" })).toBeTruthy();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
  });


  it("does not expose fiscal navigation without the fiscal permission", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Caja y ventas" })).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Facturación electrónica" })).toBeNull();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
  });

  it("exposes fiscal navigation only when the effective fiscal permission is present", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["FISCAL_DOCUMENT_ISSUE"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Facturación electrónica" })).toBeTruthy();
      expect(screen.getByTestId("fiscal-panel")).toBeTruthy();
    });
  });

  it("groups authorized screens under their existing navigation sections", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Caja y ventas" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Catálogo" })).toBeTruthy();
    });

    expect(screen.getByText("Operación")).toBeTruthy();
    expect(screen.getByText("Catálogo e inventario")).toBeTruthy();
  });

  it("materializes the first authorized screen and keeps navigation capability-driven", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Caja y ventas" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Catálogo" })).toBeTruthy();
      expect(screen.getByTestId("sale-panel")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Caja y ventas" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByTestId("catalog-panel")).toBeNull();
  });

  it("gives POS inputs accessible names across authorized screens", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: [
          "CASH_SHIFT_OPEN",
          "SALES_SALE_CREATE",
          "FISCAL_DOCUMENT_ISSUE",
          "CATALOG_PRODUCT_READ",
          "INVENTORY_STOCK_READ",
          "CUSTOMERS_CUSTOMER_READ",
          "SALES_RECEIPT_READ",
        ],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "ID de la caja" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Código de barras" })).toBeTruthy();
    });

    await screen.getByRole("button", { name: "Catálogo" }).click();
    expect(screen.getByRole("textbox", { name: "Código interno" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Nombre del producto" })).toBeTruthy();

    await screen.getByRole("button", { name: "Inventario" }).click();
    expect(screen.getByRole("textbox", { name: "ID de presentación" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Fecha de negocio" })).toBeTruthy();

    await screen.getByRole("button", { name: "Clientes" }).click();
    expect(screen.getByRole("textbox", { name: "Identificación del adquiriente" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Correo electrónico" })).toBeTruthy();

    await screen.getByRole("button", { name: "Facturación electrónica" }).click();
    expect(screen.getByRole("textbox", { name: "ID de la venta cobrada" })).toBeTruthy();

    await screen.getByRole("button", { name: "Comprobantes" }).click();
    expect(screen.getByRole("textbox", { name: "ID de la venta" })).toBeTruthy();
  });

  it("exposes only the currently executable administrative surfaces", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["AUDIT_EVENT_READ"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Auditoría administrativa" })).toBeTruthy();
    });

    for (const label of [
      "Reportes", "Usuarios", "Roles y permisos", "Empresa", "Sucursales",
      "Dispositivos", "Configuración", "Licencias", "Planes y suscripciones",
      "Superadministrador", "Soporte",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
  });

  it("does not expose the administrative dashboard from operational permissions alone", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "INVENTORY_STOCK_READ", "CASH_SHIFT_OPEN"],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Caja y ventas" })).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Auditoría administrativa" })).toBeNull();
  });

  it("fails closed when effective authorization cannot be loaded", async () => {
    window.posService["authorization.capabilities.get"].mockResolvedValue({
      status: "REJECTED",
      result_code: "SESSION_NOT_BOUND",
      result: { outcome: "UNAUTHORIZED", permissions: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("authorization-error")).toBeTruthy();
    });

    expect(screen.queryByTestId("sale-panel")).toBeNull();
    expect(screen.queryByTestId("catalog-panel")).toBeNull();
    expect(screen.queryByTestId("inventory-panel")).toBeNull();
    expect(screen.queryByTestId("customer-panel")).toBeNull();
    expect(screen.queryByTestId("receipt-panel")).toBeNull();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
  });


  it("renders the POS Local heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /Camacho POS Colombia/i })).toBeTruthy();
  });

  it("renders the status panel in loading state initially", () => {
    render(<App />);
    expect(screen.getByTestId("status-loading")).toBeTruthy();
  });

  it("renders the operation panel after authorization loads", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("operation-panel")).toBeTruthy());
  });

  it("renders the operation id input", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("operation-id-input")).toBeTruthy());
  });

  it("renders get-result and confirm buttons", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("get-result-button")).toBeTruthy();
      expect(screen.getByTestId("confirm-button")).toBeTruthy();
    });
  });
});
