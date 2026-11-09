// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SalesReceiptGetRequestSchema } from "@pos-platform/contracts";
import { App } from "../../renderer/src/App.js";

function localOperatorResult(outcome: "NO_SESSION" | "UNAVAILABLE" | "AUTHENTICATED" | "SIGNED_OUT" = "NO_SESSION") {
  return {
    protocol_version: "1.0.0",
    request_id: "11111111-1111-4111-8111-111111111111",
    correlation_id: "11111111-1111-4111-8111-111111111112",
    operation_id: null,
    status: "SUCCEEDED",
    result_code: outcome,
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-11-08T00:00:00.000Z",
    result: {
      outcome,
      username: outcome === "AUTHENTICATED" ? "cajero.local" : null,
      role: outcome === "AUTHENTICATED" ? "CAJERO" : null,
      expires_at: outcome === "AUTHENTICATED" ? "2099-01-01T00:00:00.000Z" : null,
    },
  };
}

function makeService() {
  return {
    "runtime.status.get": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
    "authorization.capabilities.get": vi.fn().mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: { outcome: "AVAILABLE", permissions: ["CATALOG_PRODUCT_READ"] },
    }),
    "session.recover": vi.fn().mockResolvedValue({ status: "SUCCEEDED", result_code: "NONE", result: { outcome: "NONE", session_id: null, offline_valid_until: null, decision: null } }),
    "local.operator.session": vi.fn().mockResolvedValue(localOperatorResult("NO_SESSION")),
    "local.operator.login": vi.fn().mockResolvedValue(localOperatorResult("NO_SESSION")),
    "local.operator.logout": vi.fn().mockResolvedValue(localOperatorResult("SIGNED_OUT")),
    "operation.result.get": vi.fn(),
    "operation.confirm": vi.fn(),
    "catalog.item.list": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
    "admin.metrics.get": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
    "license.offers.list": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
    "audit.event.list": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
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
  it("does not open the operational shell for a session with zero capabilities", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED", result_code: "AVAILABLE", result: { outcome: "AVAILABLE", permissions: [] },
    });
    const { container } = render(<App />);
    await screen.findByTestId("authorization-denied");
    expect(container.querySelector(".pos-shell")).toBeNull();
    expect(screen.queryByTestId("operation-panel")).toBeNull();
  });
  it("shows expiration based on a canonical backend decision, without exposing operational screens", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED", result_code: "SESSION_NOT_BOUND", result: { outcome: "UNAUTHORIZED", permissions: [] },
    });
    vi.mocked(window.posService["session.recover"]).mockResolvedValue({
      status: "REJECTED", result_code: "UNVERIFIABLE", result: {
        outcome: "UNVERIFIABLE", session_id: null, offline_valid_until: null, decision: "EXPIRED",
      },
    });
    render(<App />);
    await screen.findByTestId("authorization-expired");
    expect(screen.queryByTestId("sale-panel")).toBeNull();
  });
  it("shows only navigation areas covered by effective permissions", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    expect(screen.getByRole("heading", { name: "Catálogo", level: 1 })).toBeTruthy();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
  });


  it("does not expose fiscal navigation without the fiscal permission", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED",
      result_code: "SESSION_NOT_BOUND",
      result: { outcome: "UNAUTHORIZED", permissions: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("authorization-unauthenticated")).toBeTruthy();
    });

    expect(screen.queryByTestId("sale-panel")).toBeNull();
    expect(screen.queryByTestId("catalog-panel")).toBeNull();
    expect(screen.queryByTestId("inventory-panel")).toBeNull();
    expect(screen.queryByTestId("customer-panel")).toBeNull();
    expect(screen.queryByTestId("receipt-panel")).toBeNull();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
  });


  it("keeps technical diagnostics collapsed in the operator workspace", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("operation-panel")).toBeTruthy());
    const summary = screen.getByText("Herramientas técnicas y diagnóstico");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.hasAttribute("open")).toBe(false);
    expect(screen.queryByRole("button", { name: "Encender lámpara decorativa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apagar lámpara decorativa" })).toBeNull();
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
  it("preserves the cash screen while navigating to another authorized screen", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED", result_code: "AVAILABLE",
      result: { outcome: "AVAILABLE", permissions: ["SALES_SALE_CREATE", "CASH_SHIFT_OPEN", "CATALOG_PRODUCT_READ"] },
    });
    render(<App />);
    const register = await screen.findByTestId("cash-register-input");
    fireEvent.change(register, { target: { value: "11111111-1111-4111-8111-111111111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Catálogo" }));
    fireEvent.click(screen.getByRole("button", { name: "Caja y ventas" }));
    expect((screen.getByTestId("cash-register-input") as HTMLInputElement).value).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("connects product registration to stock entry using the returned presentation ID", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED", result_code: "AVAILABLE", result: { outcome: "AVAILABLE", permissions: ["CATALOG_PRODUCT_REGISTER", "INVENTORY_STOCK_RECEIVE"] },
    });
    Object.defineProperty(window.posService, "catalog.product.register", { value: vi.fn().mockResolvedValue({
      status: "SUCCEEDED", result_code: "REGISTERED", result: { outcome: "REGISTERED", product_id: "11111111-1111-4111-8111-111111111111", presentation_id: "22222222-2222-4222-8222-222222222222" },
    }) });
    render(<App />);
    await screen.findByTestId("catalog-panel");
    for (const [field, value] of [["product-code-input", "ARZ"], ["product-name-input", "Arroz"], ["presentation-name-input", "Bolsa"], ["product-price-input", "1500"]]) {
      fireEvent.change(screen.getByTestId(field!), { target: { value } });
    }
    fireEvent.click(screen.getByTestId("register-product-button"));
    fireEvent.click(await screen.findByTestId("product-receive-stock"));
    await waitFor(() => expect((screen.getByTestId("inventory-presentation-input") as HTMLInputElement).value).toBe("22222222-2222-4222-8222-222222222222"));
    expect(screen.getByRole("heading", { name: "Inventario", level: 1 })).toBeTruthy();
  });

  it("connects the paid sale to its receipt and fiscal form without retyping IDs", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const success = (result: unknown, result_code = "OK") => ({ status: "SUCCEEDED", result_code, result });
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue(success({ outcome: "AVAILABLE", permissions: [
      "CASH_SHIFT_OPEN", "CATALOG_PRODUCT_READ", "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER", "SALES_RECEIPT_READ", "FISCAL_DOCUMENT_ISSUE",
    ] }, "AVAILABLE"));
    const receipt = vi.fn().mockReturnValue(new Promise<never>(() => undefined));
    const fiscal = vi.fn();
    const methods = {
      "cash.shift.open": vi.fn().mockResolvedValue(success({ outcome: "OPENED", shift_id: "44444444-4444-4444-8444-444444444444", version: 1 })),
      "catalog.item.list": vi.fn().mockResolvedValue(success({ outcome: "FOUND", items: [], has_more: false })),
      "catalog.item.find": vi.fn().mockResolvedValue(success({ outcome: "FOUND", product_id: "22222222-2222-4222-8222-222222222222", presentation_id: "33333333-3333-4333-8333-333333333333", name: "Arroz", presentation_name: "Bolsa", price_amount: "3500.000000", currency_code: "COP" })),
      "sale.create": vi.fn().mockResolvedValue(success({ outcome: "CREATED", sale_id: id, payable_amount: "3500.000000" })),
      "payment.register.cash": vi.fn().mockResolvedValue(success({ outcome: "CONFIRMED", sale_completed: true, confirmed_coverage: "3500.000000", change_amount: "0.000000" })),
      "sales.receipt.get": receipt, "fiscal.document.issue": fiscal,
    };
    for (const [method, value] of Object.entries(methods)) Object.defineProperty(window.posService, method, { value });
    render(<App />);
    fireEvent.change(await screen.findByTestId("cash-register-input"), { target: { value: "11111111-1111-4111-8111-111111111111" } });
    fireEvent.click(screen.getByTestId("open-shift-button")); await screen.findByTestId("shift-open");
    fireEvent.change(screen.getByTestId("barcode-input"), { target: { value: "7701234567890" } });
    fireEvent.click(screen.getByTestId("find-item-button")); await screen.findByTestId("found-product-tile");
    fireEvent.click(screen.getByTestId("add-item-button"));
    fireEvent.click(screen.getByTestId("create-sale-button")); await screen.findByTestId("sale-created");
    fireEvent.click(screen.getByTestId("charge-cash-button")); await screen.findByTestId("sale-completed");
    fireEvent.click(screen.getByTestId("sale-view-receipt"));
    await waitFor(() => expect(receipt).toHaveBeenCalledTimes(1));
    const request = receipt.mock.calls[0]?.[0];
    expect(SalesReceiptGetRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ payload: { sale_id: id } });
    fireEvent.click(screen.getByRole("button", { name: "Caja y ventas" }));
    fireEvent.click(screen.getByTestId("sale-issue-invoice"));
    expect((screen.getByTestId("fiscal-sale-id-input") as HTMLInputElement).value).toBe(id);
    expect(fiscal).not.toHaveBeenCalled();
  });

});


describe("Role-ordered navigation keeps permissions authoritative", () => {
  function authenticateLocal(role: "CAJERO" | "SUPERVISOR" | "ADMINISTRADOR" | "SUPERADMINISTRADOR", username: string): void {
    vi.mocked(window.posService["local.operator.session"]).mockResolvedValue({
      protocol_version: "1.0.0",
      request_id: "11111111-1111-4111-8111-111111111111",
      correlation_id: "11111111-1111-4111-8111-111111111112",
      operation_id: null,
      status: "SUCCEEDED",
      result_code: "AUTHENTICATED",
      result_schema_version: "1.0.0",
      error: null,
      server_time: "2026-11-08T00:00:00.000Z",
      result: {
        outcome: "AUTHENTICATED",
        username,
        role,
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    });
  }

  it("opens Caja for CAJERO when sales permissions are effective", async () => {
    authenticateLocal("CAJERO", "cajero.local");
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ", "CUSTOMERS_CUSTOMER_READ", "SALES_RECEIPT_READ"],
      },
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Caja y ventas" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("sale-panel")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Inventario" })).toBeNull();
  });

  it("opens Inventario for SUPERVISOR when that surface is authorized", async () => {
    authenticateLocal("SUPERVISOR", "supervisor.local");
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ", "INVENTORY_STOCK_READ", "PAYMENTS_PAYMENT_CANCEL"],
      },
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inventario" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("inventory-panel")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
  });

  it("opens Dashboard for ADMINISTRADOR instead of the cart", async () => {
    authenticateLocal("ADMINISTRADOR", "admin.local");
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ", "INVENTORY_STOCK_READ", "AUDIT_EVENT_READ"],
      },
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("heading", { name: "Dashboard", level: 1 })).toBeTruthy();
    });
    expect(screen.queryByTestId("sale-panel")).toBeNull();
  });

  it("shows only authorized audit surfaces for SUPERADMINISTRADOR", async () => {
    authenticateLocal("SUPERADMINISTRADOR", "superadmin.local");
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
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
    expect(screen.queryByRole("button", { name: "Licencias" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Superadministrador" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Caja y ventas" })).toBeNull();
  });

  it("resets the active screen after logout", async () => {
    authenticateLocal("CAJERO", "cajero.local");
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: { outcome: "AVAILABLE", permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ"] },
    });
    render(<App />);
    await screen.findByTestId("sale-panel");
    fireEvent.click(screen.getByRole("button", { name: "Catálogo" }));
    expect(screen.getByRole("heading", { name: "Catálogo", level: 1 })).toBeTruthy();

    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED",
      result_code: "SESSION_NOT_BOUND",
      result: { outcome: "UNAUTHORIZED", permissions: [] },
    });
    vi.mocked(window.posService["local.operator.session"]).mockResolvedValue(localOperatorResult("NO_SESSION"));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByTestId("authorization-unauthenticated");
    expect(screen.queryByTestId("sale-panel")).toBeNull();
    expect(screen.queryByTestId("catalog-panel")).toBeNull();
  });
});

describe("Entry and navigation preserve authorization boundaries", () => {
  it("retries canonical recovery without granting any permissions", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED", result_code: "SESSION_NOT_BOUND", result: { outcome: "UNAUTHORIZED", permissions: [] },
    });
    render(<App />);
    await screen.findByTestId("authorization-unauthenticated");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar acceso" }));
    await screen.findByTestId("authorization-unauthenticated");
    expect(window.posService["session.recover"]).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("sale-panel")).toBeNull();
  });

  it("keeps unavailable recovery fail-closed", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED", result_code: "SESSION_NOT_BOUND", result: { outcome: "UNAUTHORIZED", permissions: [] },
    });
    vi.mocked(window.posService["session.recover"]).mockResolvedValue({ status: "REJECTED", result_code: "UNVERIFIABLE",
      result: { outcome: "UNVERIFIABLE", session_id: null, offline_valid_until: null, decision: "SESSION_EXPIRED" } });
    render(<App />);
    await screen.findByTestId("authorization-error");
    expect(screen.queryByTestId("sale-panel")).toBeNull();
  });

  it("changes visual area only after an authorized navigation event", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED", result_code: "AVAILABLE",
      result: { outcome: "AVAILABLE", permissions: ["SALES_SALE_CREATE", "AUDIT_EVENT_READ"] },
    });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: "Caja y ventas" });
    expect(container.querySelector(".pos-shell")?.getAttribute("data-visual-area")).toBe("operation");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(container.querySelector(".pos-shell")?.getAttribute("data-visual-area")).toBe("administration");
    fireEvent.click(screen.getByRole("button", { name: "Auditoría administrativa" }));
    expect(container.querySelector(".pos-shell")?.getAttribute("data-visual-area")).toBe("platform");
    expect(window.posService["authorization.capabilities.get"]).toHaveBeenCalledTimes(1);
  });

  it("keeps the branded entry screen fail-closed while authorization is pending", () => {
    const { container } = render(<App />);
    expect(screen.getByTestId("authorization-loading")).toBeTruthy();
    expect(container.querySelector(".pos-entry-logo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Caja y ventas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar sesión" })).toBeNull();
  });

  it("does not render decorative controls or operational screens when authorization fails", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED", result_code: "SESSION_NOT_BOUND",
      result: { outcome: "UNAUTHORIZED", permissions: [] },
    });
    render(<App />);
    await screen.findByTestId("authorization-unauthenticated");
    expect(screen.queryByRole("button", { name: "Apagar lámpara decorativa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Caja y ventas" })).toBeNull();
  });
});
