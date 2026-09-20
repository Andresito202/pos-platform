// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CatalogFiscalAttributeSetRequestSchema,
  CatalogPresentationAddRequestSchema,
  CatalogProductRegisterRequestSchema,
  CustomerRegisterRequestSchema,
  FiscalDocumentIssueRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryStockReceiveRequestSchema,
} from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";
import { InventoryPanel } from "../../renderer/src/components/InventoryPanel.js";
import { CustomerPanel } from "../../renderer/src/components/CustomerPanel.js";
import { FiscalPanel } from "../../renderer/src/components/FiscalPanel.js";

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

/**
 * D-19. Sin esta pantalla la operación existe pero no la alcanza nadie: los
 * códigos fiscales sólo se podrían declarar desde una prueba, que es
 * exactamente el estado del que viene la deuda.
 */
describe("CatalogPanel — códigos fiscales (D-19)", () => {
  const SET_OK = {
    status: "SUCCEEDED",
    result_code: "SET",
    result: { outcome: "SET", presentation_id: PRESENTATION, findings: [] },
  };

  function fillFiscal(): void {
    fireEvent.change(screen.getByTestId("fiscal-presentation-id-input"), {
      target: { value: PRESENTATION },
    });
    fireEvent.change(screen.getByTestId("fiscal-code-reference-input"), {
      target: { value: "ARZ-500" },
    });
  }

  it("construye un sobre que el esquema real del contrato acepta", async () => {
    install(SET_OK);
    render(<CatalogPanel />);
    fillFiscal();
    fireEvent.click(screen.getByTestId("set-fiscal-attribute-button"));

    await waitFor(() => {
      expect(screen.getByTestId("fiscal-attribute-outcome").textContent).toBe("SET");
    });

    const envelope = sent("catalog.fiscal.attribute.set");
    expect(() => CatalogFiscalAttributeSetRequestSchema.parse(envelope)).not.toThrow();
    const payload = envelope["payload"] as Record<string, unknown>;
    expect(payload["presentation_id"]).toBe(PRESENTATION);
    // La tasa tecleada como `19` se normaliza a escala 6.
    expect(payload["tax_rate"]).toBe("19.000000");
    expect(payload["unit_measure_code"]).toBe("94");
    expect(envelope["tenant_id"]).toBeUndefined();
  });

  it("rechaza una tasa que no cabe en escala 6 en vez de truncarla", async () => {
    install(SET_OK);
    render(<CatalogPanel />);
    fillFiscal();
    fireEvent.change(screen.getByTestId("fiscal-tax-rate-input"), { target: { value: "19.1234567" } });
    fireEvent.click(screen.getByTestId("set-fiscal-attribute-button"));

    await waitFor(() => {
      expect(screen.getByTestId("catalog-error").textContent).toBe("TAX_RATE_NOT_SCALE6");
    });
    expect(calls.get("catalog.fiscal.attribute.set")).toBeUndefined();
  });

  it("muestra cada hallazgo con su ruta, no un rechazo genérico", async () => {
    install({
      status: "REJECTED",
      result_code: "FISCAL_CODES_NOT_VERIFIED",
      result: {
        outcome: "FISCAL_CODES_NOT_VERIFIED",
        presentation_id: null,
        findings: [
          { code: "UNIT_MEASURE_CODE_NOT_VERIFIED", path: "unitMeasureCode" },
          { code: "TAX_CODE_NOT_VERIFIED", path: "taxes[0].code" },
        ],
      },
    });
    render(<CatalogPanel />);
    fillFiscal();
    fireEvent.click(screen.getByTestId("set-fiscal-attribute-button"));

    await waitFor(() => {
      expect(screen.getByTestId("fiscal-attribute-outcome").textContent)
        .toBe("FISCAL_CODES_NOT_VERIFIED");
    });
    // Sin la ruta el operador tendría que probar los cuatro códigos uno a uno.
    expect(screen.getByTestId("fiscal-finding-unitMeasureCode").textContent)
      .toBe("unitMeasureCode: UNIT_MEASURE_CODE_NOT_VERIFIED");
    expect(screen.getByTestId("fiscal-finding-taxes[0].code").textContent)
      .toBe("taxes[0].code: TAX_CODE_NOT_VERIFIED");
  });

  it("el alta prerrellena la presentación, y el operador puede sustituirla", async () => {
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
    fireEvent.change(screen.getByTestId("product-code-input"), { target: { value: "ARZ-500" } });
    fireEvent.change(screen.getByTestId("product-name-input"), { target: { value: "Arroz" } });
    fireEvent.change(screen.getByTestId("presentation-name-input"), { target: { value: "Bolsa 500g" } });
    fireEvent.change(screen.getByTestId("product-price-input"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("register-product-button"));

    const field = screen.getByTestId("fiscal-presentation-id-input") as HTMLInputElement;
    await waitFor(() => { expect(field.value).toBe(PRESENTATION); });

    // Prerrellenar no es fijar: corregir una presentación anterior es el motivo
    // de que esto sea una operación aparte y no un campo del alta.
    const other = "33333333-3333-4333-8333-333333333333";
    fireEvent.change(field, { target: { value: other } });
    expect(field.value).toBe(other);
  });
});

/**
 * La segunda presentación de un producto. Sin esta pantalla la operación existe
 * y no la alcanza nadie: una tienda de barrio no podría declarar el paquete.
 */
describe("CatalogPanel — otra presentación del mismo producto", () => {
  const PACK = "44444444-4444-4444-8444-444444444444";
  const ADDED = {
    status: "SUCCEEDED",
    result_code: "ADDED",
    result: { outcome: "ADDED", product_id: "11111111-1111-4111-8111-111111111111", presentation_id: PACK },
  };

  function fillPresentation(): void {
    fireEvent.change(screen.getByTestId("add-presentation-product-id-input"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByTestId("add-presentation-name-input"), {
      target: { value: "Paca x12" },
    });
    fireEvent.change(screen.getByTestId("add-presentation-price-input"), {
      target: { value: "180000" },
    });
  }

  it("construye un sobre que el esquema real del contrato acepta", async () => {
    install(ADDED);
    render(<CatalogPanel />);
    fillPresentation();
    fireEvent.change(screen.getByTestId("add-presentation-barcode-input"), {
      target: { value: "7709000000033" },
    });
    fireEvent.click(screen.getByTestId("add-presentation-button"));

    await waitFor(() => {
      expect(screen.getByTestId("add-presentation-outcome").textContent).toBe("ADDED");
    });

    const envelope = sent("catalog.presentation.add");
    expect(() => CatalogPresentationAddRequestSchema.parse(envelope)).not.toThrow();
    const payload = envelope["payload"] as Record<string, unknown>;
    expect(payload["name"]).toBe("Paca x12");
    expect(payload["price_amount"]).toBe("180000.000000");
    expect(payload["barcode"]).toBe("7709000000033");
    expect(envelope["tenant_id"]).toBeUndefined();
  });

  it("un código de barras vacío viaja como null, no como cadena vacía", async () => {
    install(ADDED);
    render(<CatalogPanel />);
    fillPresentation();
    fireEvent.click(screen.getByTestId("add-presentation-button"));

    await waitFor(() => { expect(calls.get("catalog.presentation.add")).toBeDefined(); });
    const payload = sent("catalog.presentation.add")["payload"] as Record<string, unknown>;
    expect(payload["barcode"]).toBeNull();
  });

  it("el duplicado muestra cuál presentación usa ya ese código", async () => {
    install({
      status: "REJECTED",
      result_code: "BARCODE_ALREADY_REGISTERED",
      result: { outcome: "BARCODE_ALREADY_REGISTERED", product_id: null, presentation_id: PRESENTATION },
    });
    render(<CatalogPanel />);
    fillPresentation();
    fireEvent.click(screen.getByTestId("add-presentation-button"));

    await waitFor(() => {
      expect(screen.getByTestId("add-presentation-outcome").textContent)
        .toBe("BARCODE_ALREADY_REGISTERED");
    });
    // Reintentar a ciegas no sirve: hay que ir a la presentación que lo tiene.
    expect(screen.getByTestId("added-presentation-id").textContent).toBe(PRESENTATION);
  });

  it("el alta prerrellena el producto, y el operador puede sustituirlo", async () => {
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
    fireEvent.change(screen.getByTestId("product-code-input"), { target: { value: "ARZ-500" } });
    fireEvent.change(screen.getByTestId("product-name-input"), { target: { value: "Arroz" } });
    fireEvent.change(screen.getByTestId("presentation-name-input"), { target: { value: "Bolsa 500g" } });
    fireEvent.change(screen.getByTestId("product-price-input"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("register-product-button"));

    const field = screen.getByTestId("add-presentation-product-id-input") as HTMLInputElement;
    await waitFor(() => { expect(field.value).toBe("11111111-1111-4111-8111-111111111111"); });

    const other = "55555555-5555-4555-8555-555555555555";
    fireEvent.change(field, { target: { value: other } });
    expect(field.value).toBe(other);
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

/**
 * `FiscalPanel` — `DEC-021` F5, mitad pantalla.
 *
 * La emisión fiscal tiene siete desenlaces y cinco llegan como `REJECTED` con
 * `result` poblado. Lo que se prueba aquí es que la pantalla **los distingue**:
 * un bloqueo por adquiriente genérico no es lo mismo que un fallo de
 * transporte, y un desenlace incierto no es un error que invite a reintentar.
 */
describe("FiscalPanel", () => {
  const SALE = "33333333-3333-4333-8333-333333333333";
  const CUSTOMER = "44444444-4444-4444-8444-444444444444";

  function empty() {
    return {
      document_id: null, transport_status: null, normalized_result: null,
      cufe: null, issued_prefix: null, issued_number: null, attempt_count: null,
      block_code: null, reasons: [],
    };
  }

  function fillSale(): void {
    fireEvent.change(screen.getByTestId("fiscal-sale-id-input"), { target: { value: SALE } });
  }

  it("construye un sobre que el esquema real del contrato acepta", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "ISSUED",
      result: {
        ...empty(),
        outcome: "ISSUED",
        document_id: "55555555-5555-4555-8555-555555555555",
        transport_status: "COMPLETED",
        normalized_result: "ACCEPTED",
        cufe: "a".repeat(96),
        issued_prefix: "SETP",
        issued_number: "990000001",
        attempt_count: 1,
      },
    });
    render(<FiscalPanel />);
    fillSale();
    fireEvent.change(screen.getByTestId("fiscal-customer-id-input"), { target: { value: CUSTOMER } });
    fireEvent.click(screen.getByTestId("issue-identified-button"));

    await waitFor(() => { expect(screen.getByTestId("fiscal-issued")).toBeTruthy(); });

    const envelope = sent("fiscal.document.issue");
    expect(() => FiscalDocumentIssueRequestSchema.parse(envelope)).not.toThrow();
    const payload = envelope["payload"] as Record<string, unknown>;
    // El adquiriente viaja **por referencia**: ni un campo fiscal suelto.
    expect(payload["customer"]).toEqual({ kind: "IDENTIFIED", customer_id: CUSTOMER });
    expect(payload["sale_id"]).toBe(SALE);
    // Emitir es una operación: exige idempotencia, y el sobre no lleva identidad.
    expect(envelope["idempotency_key"]).toBeDefined();
    expect(envelope["operation_id"]).toBeDefined();
    expect(envelope["tenant_id"]).toBeUndefined();
  });

  it("muestra el cufe y el consecutivo cuando la emisión queda evidenciada", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "ISSUED",
      result: {
        ...empty(),
        outcome: "ISSUED", transport_status: "COMPLETED", normalized_result: "ACCEPTED",
        cufe: "b".repeat(96), issued_number: "990000002", attempt_count: 1,
      },
    });
    render(<FiscalPanel />);
    fillSale();
    fireEvent.change(screen.getByTestId("fiscal-customer-id-input"), { target: { value: CUSTOMER } });
    fireEvent.click(screen.getByTestId("issue-identified-button"));

    await waitFor(() => {
      expect(screen.getByTestId("fiscal-issued-cufe").textContent).toBe("b".repeat(96));
    });
    expect(screen.getByTestId("fiscal-issued-number").textContent).toBe("990000002");
  });

  /**
   * `D-13` visto desde la caja. Es el caso mayoritario de un POS colombiano y
   * hoy no tiene salida fiscal: lo que la pantalla debe hacer es **decir por
   * qué**, no fingir un error genérico.
   */
  it("el adquiriente anónimo bloquea, y el motivo se lee entero en pantalla", async () => {
    install({
      status: "REJECTED",
      result_code: "BLOCKED",
      result: {
        ...empty(),
        outcome: "BLOCKED",
        block_code: "PAYLOAD_ASSEMBLY_BLOCKED",
        reasons: [{ code: "GENERIC_ACQUIRER_NOT_VERIFIED", path: "customer" }],
      },
    });
    render(<FiscalPanel />);
    fillSale();
    fireEvent.click(screen.getByTestId("issue-anonymous-button"));

    await waitFor(() => { expect(screen.getByTestId("fiscal-blocked")).toBeTruthy(); });
    expect(screen.getByTestId("fiscal-blocked-code").textContent).toBe("PAYLOAD_ASSEMBLY_BLOCKED");
    expect(screen.getByTestId("fiscal-blocked-reason").textContent)
      .toContain("GENERIC_ACQUIRER_NOT_VERIFIED");
    // Un bloqueo **no** es un fallo de transporte, y no debe presentarse como tal.
    expect(screen.queryByTestId("fiscal-error")).toBeNull();

    const payload = sent("fiscal.document.issue")["payload"] as Record<string, unknown>;
    expect(payload["customer"]).toEqual({ kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" });
  });

  /**
   * Regla 5 de §Idempotencia: un desenlace incierto **no se reintenta**. La
   * pantalla lo separa del resto porque el documento pudo haberse emitido, y
   * volver a intentarlo duplicaría la factura ante la DIAN.
   */
  it("un desenlace incierto se muestra aparte, no como un fallo cualquiera", async () => {
    install({
      status: "REJECTED",
      result_code: "UNCERTAIN",
      result: {
        ...empty(),
        outcome: "UNCERTAIN", transport_status: "UNKNOWN_OUTCOME", attempt_count: 1,
        document_id: "66666666-6666-4666-8666-666666666666",
      },
    });
    render(<FiscalPanel />);
    fillSale();
    fireEvent.change(screen.getByTestId("fiscal-customer-id-input"), { target: { value: CUSTOMER } });
    fireEvent.click(screen.getByTestId("issue-identified-button"));

    await waitFor(() => { expect(screen.getByTestId("fiscal-uncertain")).toBeTruthy(); });
    expect(screen.getByTestId("fiscal-uncertain-status").textContent).toBe("UNKNOWN_OUTCOME");
    expect(screen.queryByTestId("fiscal-issued")).toBeNull();
    expect(screen.queryByTestId("fiscal-blocked")).toBeNull();
  });

  it("un fallo sin `result` sí es error de transporte, y se dice como tal", async () => {
    install({ status: "REJECTED", result_code: "SESSION_NOT_BOUND", result: null });
    render(<FiscalPanel />);
    fillSale();
    fireEvent.click(screen.getByTestId("issue-anonymous-button"));

    await waitFor(() => {
      expect(screen.getByTestId("fiscal-error").textContent).toBe("SESSION_NOT_BOUND");
    });
    expect(screen.queryByTestId("fiscal-blocked")).toBeNull();
  });
});
