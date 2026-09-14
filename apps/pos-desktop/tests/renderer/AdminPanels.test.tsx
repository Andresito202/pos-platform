// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CatalogProductRegisterRequestSchema,
  CustomerRegisterRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryStockReceiveRequestSchema,
} from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";
import { InventoryPanel } from "../../renderer/src/components/InventoryPanel.js";
import { CustomerPanel } from "../../renderer/src/components/CustomerPanel.js";

/**
 * Las tres pantallas de administración contra respuestas controladas.
 *
 * El canal es un doble a propósito: lo que se prueba aquí es **qué sobre
 * construye la pantalla** y **cómo lee el desenlace**. Que el sobre sea
 * aceptable no se afirma: se comprueba parseándolo con el esquema real del
 * contrato, que es lo único que distingue «la prueba se lo cree» de «el
 * servidor lo aceptaría».
 *
 * El alcance real lo acredita el E2E de Electron contra el servicio de verdad.
 */

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
  return seen[seen.length - 1] as Record<string, unknown>;
}

beforeEach(() => { calls.clear(); });

const PRESENTATION = "22222222-2222-4222-8222-222222222222";

describe("CatalogPanel", () => {
  function fillProduct(price = "1500"): void {
    fireEvent.change(screen.getByTestId("product-code-input"), { target: { value: "ARZ-500" } });
    fireEvent.change(screen.getByTestId("product-name-input"), { target: { value: "Arroz" } });
    fireEvent.change(screen.getByTestId("presentation-name-input"), { target: { value: "Bolsa 500g" } });
    fireEvent.change(screen.getByTestId("product-price-input"), { target: { value: price } });
  }

  it("construye un sobre que el esquema real del contrato acepta", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "REGISTERED",
      result: {
        outcome: "REGISTERED",
        product_id: "11111111-1111-4111-8111-111111111111",
        presentation_id: PRESENTATION,
      },
    });
    render(<CatalogPanel />);
    fillProduct();
    fireEvent.change(screen.getByTestId("product-barcode-input"), { target: { value: "7700000000017" } });
    fireEvent.click(screen.getByTestId("register-product-button"));

    await waitFor(() => { expect(screen.getByTestId("product-registered")).toBeTruthy(); });

    const envelope = sent("catalog.product.register");
    expect(() => CatalogProductRegisterRequestSchema.parse(envelope)).not.toThrow();
    const payload = envelope["payload"] as Record<string, unknown>;
    // El precio tecleado se normaliza a escala 6; enviarlo crudo lo rechazaria
    // la frontera.
    expect(payload["price_amount"]).toBe("1500.000000");
    expect(payload["barcode"]).toBe("7700000000017");
    // El sobre no lleva identidad: la operación la rechaza si la lleva.
    expect(envelope["tenant_id"]).toBeUndefined();
    expect(envelope["branch_id"]).toBeUndefined();
  });

  it("expone el presentation_id, que es lo que la entrada de existencia necesita", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "REGISTERED",
      result: {
        outcome: "REGISTERED",
        product_id: "11111111-1111-4111-8111-111111111111",
        presentation_id: PRESENTATION,
      },
    });
    render(<CatalogPanel />);
    fillProduct();
    fireEvent.click(screen.getByTestId("register-product-button"));

    await waitFor(() => {
      expect(screen.getByTestId("presentation-id").textContent).toBe(PRESENTATION);
    });
    expect(screen.getByTestId("product-outcome").textContent).toBe("REGISTERED");
  });

  it("un código de barras vacío viaja como null, no como cadena vacía", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "REGISTERED",
      result: { outcome: "REGISTERED", product_id: "11111111-1111-4111-8111-111111111111", presentation_id: PRESENTATION },
    });
    render(<CatalogPanel />);
    fillProduct();
    fireEvent.click(screen.getByTestId("register-product-button"));

    await waitFor(() => { expect(screen.getByTestId("product-registered")).toBeTruthy(); });
    const payload = sent("catalog.product.register")["payload"] as Record<string, unknown>;
    expect(payload["barcode"]).toBeNull();
  });

  it("rechaza un precio que no cabe en escala 6 en vez de truncarlo", async () => {
    install({ status: "SUCCEEDED", result_code: "REGISTERED", result: null });
    render(<CatalogPanel />);
    fillProduct("1500.1234567");
    fireEvent.click(screen.getByTestId("register-product-button"));

    await waitFor(() => {
      expect(screen.getByTestId("catalog-error").textContent).toBe("PRICE_NOT_SCALE6");
    });
    // Y no llegó a salir nada por el canal.
    expect(calls.get("catalog.product.register")).toBeUndefined();
  });

  it("muestra el desenlace cuando el alta se rechaza sin identificadores", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "UNAUTHORIZED",
      result: { outcome: "UNAUTHORIZED", product_id: null, presentation_id: null },
    });
    render(<CatalogPanel />);
    fillProduct();
    fireEvent.click(screen.getByTestId("register-product-button"));

    await waitFor(() => {
      expect(screen.getByTestId("product-rejected").textContent).toBe("UNAUTHORIZED");
    });
    expect(screen.queryByTestId("product-registered")).toBeNull();
  });
});

describe("InventoryPanel", () => {
  function targetPresentation(): void {
    fireEvent.change(screen.getByTestId("inventory-presentation-input"), {
      target: { value: PRESENTATION },
    });
  }

  it("recibir y ajustar construyen sobres que sus esquemas reales aceptan", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "POSTED",
      result: { outcome: "POSTED", stock_sequence: 1, quantity_after: "12.000000", available: null },
    });
    render(<InventoryPanel />);
    targetPresentation();

    fireEvent.change(screen.getByTestId("receive-quantity-input"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("receive-stock-button"));
    await waitFor(() => { expect(screen.getByTestId("inventory-movement")).toBeTruthy(); });
    expect(() => InventoryStockReceiveRequestSchema.parse(sent("inventory.stock.receive"))).not.toThrow();

    fireEvent.change(screen.getByTestId("adjust-quantity-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("adjust-stock-button"));
    await waitFor(() => {
      expect((calls.get("inventory.stock.adjust") ?? []).length).toBe(1);
    });
    expect(() => InventoryStockAdjustRequestSchema.parse(sent("inventory.stock.adjust"))).not.toThrow();
  });

  it("los motivos de entrada y de ajuste son listas disjuntas", () => {
    install({ status: "SUCCEEDED", result_code: "POSTED", result: null });
    render(<InventoryPanel />);

    const receive = Array.from(
      screen.getByTestId("receive-movement-select").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));
    const adjust = Array.from(
      screen.getByTestId("adjust-movement-select").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));

    expect(receive).toEqual(["OPENING_COUNT", "PURCHASE_RECEIPT", "TRANSFER_IN"]);
    expect(adjust).toEqual([
      "ADJUSTMENT_POSITIVE", "ADJUSTMENT_NEGATIVE", "SHRINKAGE", "TRANSFER_OUT",
    ]);
    // Que sean disjuntas es lo que impide registrar una merma como una compra.
    expect(receive.filter((movement) => adjust.includes(movement))).toEqual([]);
  });

  it("enseña la existencia disponible cuando el movimiento se rechaza por faltante", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "INSUFFICIENT_STOCK",
      result: {
        outcome: "INSUFFICIENT_STOCK",
        stock_sequence: null,
        quantity_after: null,
        available: "3.000000",
      },
    });
    render(<InventoryPanel />);
    targetPresentation();
    fireEvent.change(screen.getByTestId("adjust-quantity-input"), { target: { value: "9" } });
    fireEvent.click(screen.getByTestId("adjust-stock-button"));

    await waitFor(() => {
      expect(screen.getByTestId("movement-outcome").textContent).toBe("INSUFFICIENT_STOCK");
    });
    expect(screen.getByTestId("movement-available").textContent).toBe("3.000000");
    expect(screen.queryByTestId("movement-quantity-after")).toBeNull();
  });

  it("no colapsa «sin movimientos» con existencia cero", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "NOT_FOUND",
      result: {
        outcome: "NOT_FOUND",
        presentation_id: null,
        quantity_on_hand: null,
        last_movement_sequence: null,
      },
    });
    render(<InventoryPanel />);
    targetPresentation();
    fireEvent.click(screen.getByTestId("get-stock-button"));

    await waitFor(() => { expect(screen.getByTestId("stock-not-found")).toBeTruthy(); });
    expect(screen.queryByTestId("stock-found")).toBeNull();
    expect(screen.queryByTestId("stock-quantity")).toBeNull();
  });

  it("rechaza una cantidad fuera de escala 6 sin tocar el canal", async () => {
    install({ status: "SUCCEEDED", result_code: "POSTED", result: null });
    render(<InventoryPanel />);
    targetPresentation();
    fireEvent.change(screen.getByTestId("receive-quantity-input"), { target: { value: "1.0000001" } });
    fireEvent.click(screen.getByTestId("receive-stock-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inventory-error").textContent).toBe("QUANTITY_NOT_SCALE6");
    });
    expect(calls.get("inventory.stock.receive")).toBeUndefined();
  });
});

describe("CustomerPanel", () => {
  function fillCustomer(): void {
    fireEvent.change(screen.getByTestId("customer-document-code-input"), { target: { value: "13" } });
    fireEvent.change(screen.getByTestId("customer-identification-input"), { target: { value: "1020304050" } });
    fireEvent.change(screen.getByTestId("customer-legal-organization-input"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("customer-tribute-input"), { target: { value: "ZZ" } });
    fireEvent.change(screen.getByTestId("customer-names-input"), { target: { value: "Ana Perez" } });
  }

  it("construye un sobre que el esquema real del contrato acepta", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "REGISTERED",
      result: {
        outcome: "REGISTERED",
        customer_id: "33333333-3333-4333-8333-333333333333",
        version: 1,
        findings: [],
      },
    });
    render(<CustomerPanel />);
    fillCustomer();
    fireEvent.change(screen.getByTestId("customer-responsibilities-input"), {
      target: { value: "R-99-PN, O-13" },
    });
    fireEvent.click(screen.getByTestId("register-customer-button"));

    await waitFor(() => { expect(screen.getByTestId("customer-registered")).toBeTruthy(); });
    const envelope = sent("customer.register");
    expect(() => CustomerRegisterRequestSchema.parse(envelope)).not.toThrow();
    const payload = envelope["payload"] as Record<string, unknown>;
    // Lista, no un solo código, y sin espacios pegados.
    expect(payload["fiscal_responsibility_codes"]).toEqual(["R-99-PN", "O-13"]);
    // Los opcionales vacíos viajan como null, no como cadena vacía.
    expect(payload["company"]).toBeNull();
    expect(payload["email"]).toBeNull();
    expect(payload["verification_digit"]).toBeNull();
  });

  it("muestra los findings cuando el alta fiscal se rechaza", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "INVALID",
      result: {
        outcome: "INVALID",
        customer_id: null,
        version: null,
        findings: [{ code: "TRIBUTE_CODE_UNKNOWN", path: "tribute_code" }],
      },
    });
    render(<CustomerPanel />);
    fillCustomer();
    fireEvent.click(screen.getByTestId("register-customer-button"));

    await waitFor(() => { expect(screen.getByTestId("customer-rejected")).toBeTruthy(); });
    expect(screen.getByTestId("customer-rejected-outcome").textContent).toBe("INVALID");
    expect(screen.getByTestId("customer-finding").textContent).toContain("TRIBUTE_CODE_UNKNOWN");
  });

  it("distingue encontrado de no registrado en la búsqueda", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "NOT_FOUND",
      result: {
        outcome: "NOT_FOUND",
        customer_id: null,
        identification_document_code: null,
        identification: null,
        verification_digit: null,
        legal_organization_code: null,
        company: null,
        names: null,
        tribute_code: null,
        fiscal_responsibility_codes: [],
        email: null,
        phone: null,
        address: null,
        country_code: null,
        municipality_code: null,
        version: null,
      },
    });
    render(<CustomerPanel />);
    fillCustomer();
    fireEvent.click(screen.getByTestId("find-customer-button"));

    await waitFor(() => { expect(screen.getByTestId("customer-not-found")).toBeTruthy(); });
    expect(screen.queryByTestId("customer-found")).toBeNull();
    // Una lectura no lleva idempotencia: el sobre la rechazaría.
    const envelope = sent("customer.find");
    expect(envelope["idempotency_key"]).toBeUndefined();
    expect(envelope["operation_id"]).toBeUndefined();
  });
});
