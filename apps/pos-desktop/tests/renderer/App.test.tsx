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
      expect(screen.getByRole("heading", { name: "Catálogo" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Clientes" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Comprobantes" })).toBeTruthy();
    });

    expect(screen.queryByRole("heading", { name: "Caja y ventas" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Inventario" })).toBeNull();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
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
    expect(screen.getByRole("heading", { name: /POS Local/i })).toBeTruthy();
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
