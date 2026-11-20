// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../renderer/src/App.js";

function localOperatorResult(
  outcome: "NO_SESSION" | "UNAVAILABLE" | "AUTHENTICATED" | "SIGNED_OUT" = "AUTHENTICATED",
  identity: { username: string; role: string } = { username: "cajero.local", role: "CAJERO" },
) {
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
      username: outcome === "AUTHENTICATED" ? identity.username : null,
      role: outcome === "AUTHENTICATED" ? identity.role : null,
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
      result: { outcome: "AVAILABLE", permissions: ["CATALOG_PRODUCT_READ"], entitlements: [] },
    }),
    "session.recover": vi.fn().mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "NONE",
      result: { outcome: "NONE", session_id: null, offline_valid_until: null, decision: null },
    }),
    "local.operator.session": vi.fn().mockResolvedValue(localOperatorResult("AUTHENTICATED")),
    "local.operator.login": vi.fn().mockResolvedValue(localOperatorResult("AUTHENTICATED")),
    "local.operator.logout": vi.fn().mockResolvedValue(localOperatorResult("SIGNED_OUT")),
    "operation.result.get": vi.fn(),
    "operation.confirm": vi.fn(),
    "catalog.item.list": vi.fn().mockResolvedValue({
      status: "SUCCEEDED", result_code: "FOUND",
      result: { outcome: "FOUND", items: [], has_more: false },
    }),
    "cart.waiting.list": vi.fn().mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "FOUND",
      result: { outcome: "FOUND", carts: [], has_more: false },
    }),
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
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["CATALOG_PRODUCT_READ", "CUSTOMERS_CUSTOMER_READ", "SALES_RECEIPT_READ"],
        entitlements: [],
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
    // CAJERO role order prefers Clientes before Catálogo among these grants.
    expect(screen.getByRole("heading", { name: "Clientes", level: 1 })).toBeTruthy();
    expect(screen.queryByTestId("fiscal-panel")).toBeNull();
  });

  it("does not expose fiscal navigation without the fiscal permission", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE"],
        entitlements: [],
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
        entitlements: [],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Facturación electrónica" })).toBeTruthy();
      expect(screen.getByTestId("fiscal-panel")).toBeTruthy();
    });
  });

  it("shows a non-empty audit nav for SUPERADMINISTRADOR with AUDIT_EVENT_READ only", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["AUDIT_EVENT_READ"],
        entitlements: [],
      },
    });
    vi.mocked(window.posService["local.operator.session"]).mockResolvedValue(
      localOperatorResult("AUTHENTICATED", { username: "superadmin.local", role: "SUPERADMINISTRADOR" }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("navigation")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Auditoría administrativa" })).toBeTruthy();
      expect(screen.getByTestId("admin-panel-audit")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Catálogo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Inventario" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Caja y ventas" })).toBeNull();
  });

  it("materializes the first authorized screen and keeps navigation capability-driven", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: {
        outcome: "AVAILABLE",
        permissions: ["SALES_SALE_CREATE", "CATALOG_PRODUCT_READ"],
        entitlements: [],
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

    // Tip #106 keep-alive: visited sales screen stays mounted (hidden) after nav.
    screen.getByRole("button", { name: "Catálogo" }).click();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Catálogo" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("catalog-panel")).toBeTruthy();
    });
    expect(screen.getByTestId("sale-panel")).toBeTruthy();
  });

  it("shows the local login surface when the backend reports no bound session", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED",
      result_code: "SESSION_NOT_BOUND",
      result: { outcome: "UNAUTHORIZED", permissions: [], entitlements: [] },
    });
    vi.mocked(window.posService["local.operator.session"]).mockResolvedValue(localOperatorResult("NO_SESSION"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("authorization-unauthenticated")).toBeTruthy();
      expect(screen.getByLabelText("Usuario")).toBeTruthy();
      expect(screen.getByRole("img", { name: "Camacho POS Colombia" })).toBeTruthy();
    });

    expect(screen.queryByTestId("sale-panel")).toBeNull();
    expect(screen.queryByTestId("catalog-panel")).toBeNull();
  });

  it("fails closed when effective authorization cannot be loaded", async () => {
    vi.mocked(window.posService["authorization.capabilities.get"]).mockResolvedValue({
      status: "REJECTED",
      result_code: "CHANNEL_BROKEN",
      result: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("authorization-error")).toBeTruthy();
    });

    expect(screen.queryByTestId("sale-panel")).toBeNull();
    expect(screen.queryByTestId("catalog-panel")).toBeNull();
  });

  it("uses the original brand and collapses navigation without changing permissions or the active screen", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Catálogo" })).toBeTruthy());
    const heading = screen.getByRole("heading", { name: "Catálogo", level: 1 });
    expect(screen.getByRole("img", { name: "Camacho POS Colombia" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar menú" }));
    expect(screen.getByRole("button", { name: "Mostrar menú" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Catálogo" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Catálogo", level: 1 })).toBe(heading);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar menú" }));
    expect(screen.getByRole("button", { name: "Catálogo" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Caja y ventas" })).toBeNull();
  });

  it("renders the POS Local heading", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText(/Camacho POS Colombia/i).length).toBeGreaterThan(0);
    });
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
