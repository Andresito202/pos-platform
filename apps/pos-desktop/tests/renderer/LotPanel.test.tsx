// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { LotPanel } from "../../renderer/src/components/LotPanel.js";

/**
 * La pantalla de lotes contra respuestas controladas.
 *
 * El canal es un doble a propósito: lo que se prueba aquí es lo que la vista
 * hace con cada desenlace —que no enseñe el comprador de otra venta y que no
 * descarte en silencio a quien no pudo leer—. Que la cadena real llegue del
 * lote a la persona lo demuestra el E2E de Electron contra el servicio real.
 */

const PRESENTATION = "11111111-1111-4111-8111-111111111111";
const SALE_ANA = "22222222-2222-4222-8222-22222222000a";
const SALE_BETO = "22222222-2222-4222-8222-22222222000b";
const SALE_MOSTRADOR = "22222222-2222-4222-8222-22222222000c";
const SALE_PERDIDA = "22222222-2222-4222-8222-22222222000d";
const ANA = "33333333-3333-4333-8333-33333333000a";
const BETO = "33333333-3333-4333-8333-33333333000b";

const outflow = (saleId: string) => ({
  movement_type: "SALE", quantity: "1.000000", sale_id: saleId,
  reason_code: "SALE_COMPLETED", business_date: "2026-09-22", occurred_at: "2026-09-22T10:00:00.000Z",
});

const TRACE = {
  status: "SUCCEEDED", result_code: "FOUND",
  result: {
    outcome: "FOUND",
    lot: {
      lot_id: "44444444-4444-4444-8444-444444444444", lot_code: "L-1",
      received_date: "2026-09-20", manufactured_date: null, expiry_date: "2026-12-31",
      quantity_on_hand: "6.000000", status: "ACTIVE",
    },
    quantity_received: "10.000000",
    origin_lot: null,
    derived_lots: [],
    inflows: [],
    outflows: [
      outflow(SALE_ANA), outflow(SALE_BETO), outflow(SALE_MOSTRADOR), outflow(SALE_PERDIDA),
    ],
    truncated: false,
  },
};

const receipt = (saleId: string, number: number, customerId: string | null) => ({
  status: "SUCCEEDED", result_code: "FOUND",
  result: {
    outcome: "FOUND", sale_id: saleId, document_series: "POS1", sale_number: number,
    customer_id: customerId, currency_code: "COP", business_date: "2026-09-22",
    completed_at: "2026-09-22T10:00:00.000Z", lines: [], subtotal_amount: "0.000000",
    discount_amount: "0.000000", tax_amount: "0.000000", fiscal_total_amount: "0.000000",
    commercial_rounding_adjustment: "0.000000", payable_amount: "0.000000", payments: [],
    calculation_checksum: "a".repeat(64),
  },
});

const RECEIPTS: Record<string, unknown> = {
  [SALE_ANA]: receipt(SALE_ANA, 1, ANA),
  [SALE_BETO]: receipt(SALE_BETO, 2, BETO),
  [SALE_MOSTRADOR]: receipt(SALE_MOSTRADOR, 3, null),
  [SALE_PERDIDA]: { status: "REJECTED", result_code: "NOT_FOUND", result: { outcome: "NOT_FOUND" } },
};

const CUSTOMERS: Record<string, unknown> = {
  [ANA]: {
    status: "SUCCEEDED", result_code: "FOUND",
    result: {
      outcome: "FOUND", customer_id: ANA, identification_document_code: "13",
      identification: "52123456", verification_digit: null, legal_organization_code: "2",
      company: null, names: "Ana Compradora", tribute_code: "ZZ",
      fiscal_responsibility_codes: ["R-99-PN"], email: "ana@example.com", phone: "3001234567",
      address: null, country_code: null, municipality_code: null, version: 1,
    },
  },
  // Sin permiso de leer clientes: el comprador existe y no se puede ver.
  [BETO]: { status: "REJECTED", result_code: "UNAUTHORIZED", result: { outcome: "UNAUTHORIZED" } },
};

type Envelope = { payload: Record<string, string> };

function install(): void {
  const service: Record<string, (request: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = () => Promise.reject(new Error(`inesperado: ${method}`));
  }
  service["inventory.lot.trace"] = () => Promise.resolve(TRACE);
  service["sales.receipt.get"] = (request) =>
    Promise.resolve(RECEIPTS[(request as Envelope).payload["sale_id"] ?? ""]);
  service["customer.get"] = (request) =>
    Promise.resolve(CUSTOMERS[(request as Envelope).payload["customer_id"] ?? ""]);
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

async function traceLot(): Promise<void> {
  fireEvent.change(screen.getByTestId("lot-presentation-input"), { target: { value: PRESENTATION } });
  fireEvent.change(screen.getByTestId("lot-code-input"), { target: { value: "L-1" } });
  fireEvent.click(screen.getByTestId("lot-trace-button"));
  await waitFor(() => { expect(screen.getByTestId("lot-trace")).toBeTruthy(); });
}

describe("LotPanel — del lote a los compradores", () => {
  beforeEach(() => { install(); });

  /**
   * Un retiro que dejara fuera a un comprador sin decirlo sería peor que no
   * tener lista. Lo que no se pudo leer aparece, con su código.
   */
  it("lista los compradores identificados, cuenta los anónimos y no descarta a quien no pudo leer", async () => {
    render(<LotPanel />);
    await traceLot();
    fireEvent.click(screen.getByTestId("lot-buyers-button"));
    await waitFor(() => { expect(screen.getByTestId("lot-buyers")).toBeTruthy(); });

    expect(screen.getAllByTestId("lot-buyer-name").map((cell) => cell.textContent)).toEqual(["Ana Compradora"]);
    expect(screen.getByTestId("lot-buyer-phone").textContent).toBe("3001234567");
    expect(screen.getByTestId("lot-buyers-anonymous").textContent).toBe("1");
    expect(screen.getAllByTestId("lot-buyers-failure").map((item) => item.textContent)).toEqual([
      `${SALE_PERDIDA}: NOT_FOUND`,
      `${SALE_BETO}: UNAUTHORIZED`,
    ]);
  });

  /**
   * Abrir otra venta no puede dejar a la vista el comprador de la anterior:
   * en un retiro, eso es llamar a la persona equivocada.
   */
  it("al abrir otra venta no deja a la vista el comprador de la anterior", async () => {
    render(<LotPanel />);
    await traceLot();
    const open = screen.getAllByTestId("lot-trace-open-sale");

    fireEvent.click(open[0]!);
    await waitFor(() => { expect(screen.getByTestId("lot-trace-sale-customer")).toBeTruthy(); });
    fireEvent.click(screen.getByTestId("lot-trace-sale-customer"));
    await waitFor(() => {
      expect(screen.getByTestId("lot-trace-buyer-name").textContent).toBe("Ana Compradora");
    });

    fireEvent.click(open[2]!);
    await waitFor(() => { expect(screen.getByTestId("lot-trace-sale-anonymous")).toBeTruthy(); });
    expect(screen.queryByTestId("lot-trace-buyer")).toBeNull();
  });
});

/**
 * La paca abierta: sus ventas sueltas están en los lotes de unidades que
 * salieron de ella, no en su propio rastro. «Compradores del lote» baja a
 * ellos; y un lote derivado cuyo rastro no llega se lista, no se salta.
 */
describe("LotPanel — el retiro de una paca baja a sus unidades", () => {
  const UNITS = "11111111-1111-4111-8111-11111111aaaa";
  const SIXPACK = "11111111-1111-4111-8111-11111111bbbb";
  const lot = {
    lot_id: "44444444-4444-4444-8444-444444444445", lot_code: "L-1",
    received_date: "2026-09-20", manufactured_date: null, expiry_date: "2026-12-31",
    quantity_on_hand: "0.000000", status: "CONSUMED",
  };
  const found = (outflows: unknown[], derived: unknown[], origin: unknown = null) => ({
    status: "SUCCEEDED", result_code: "FOUND",
    result: {
      outcome: "FOUND", lot, quantity_received: "2.000000", origin_lot: origin,
      derived_lots: derived, inflows: [], outflows, truncated: false,
    },
  });
  const derivedLot = (presentationId: string) => ({
    presentation_id: presentationId, lot_code: "L-1", quantity_on_hand: "0.000000", status: "CONSUMED",
  });
  const TRACES: Record<string, unknown> = {
    // La paca no se vendió entera: sólo se abrió.
    [PRESENTATION]: found([{
      movement_type: "CONVERSION_OUT", quantity: "2.000000", sale_id: null,
      reason_code: "BREAK_PACK", business_date: "2026-09-22", occurred_at: "2026-09-22T09:00:00.000Z",
    }], [derivedLot(UNITS), derivedLot(SIXPACK)]),
    [UNITS]: found([outflow(SALE_ANA)], [], { presentation_id: PRESENTATION, lot_code: "L-1" }),
    [SIXPACK]: { status: "REJECTED", result_code: "UNAUTHORIZED", result: { outcome: "UNAUTHORIZED" } },
  };

  beforeEach(() => {
    install();
    const service = (window as unknown as { posService: Record<string, (r: unknown) => Promise<unknown>> }).posService;
    service["inventory.lot.trace"] = (request) =>
      Promise.resolve(TRACES[(request as Envelope).payload["presentation_id"] ?? ""]);
  });

  it("reúne a los compradores de los lotes de unidades y lista el lote que no pudo leer", async () => {
    render(<LotPanel />);
    await traceLot();
    expect(screen.getAllByTestId("lot-trace-derived-lot")).toHaveLength(2);
    expect(screen.queryAllByTestId("lot-trace-open-sale")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("lot-buyers-button"));
    await waitFor(() => { expect(screen.getByTestId("lot-buyers")).toBeTruthy(); });
    expect(screen.getAllByTestId("lot-buyer-name").map((cell) => cell.textContent)).toEqual(["Ana Compradora"]);
    expect(screen.getByTestId("lot-buyers-derived").textContent).toBe("2");
    expect(screen.getAllByTestId("lot-buyers-failure").map((item) => item.textContent)).toEqual([
      "lote L-1: UNAUTHORIZED",
    ]);
  });

  it("desde un lote de unidades se sube a la paca de origen", async () => {
    render(<LotPanel />);
    await traceLot();
    fireEvent.click(screen.getAllByTestId("lot-trace-follow-derived")[0]!);
    await waitFor(() => { expect(screen.getByTestId("lot-trace-origin-code").textContent).toBe("L-1"); });
    expect((screen.getByTestId("lot-presentation-input") as HTMLInputElement).value).toBe(UNITS);

    fireEvent.click(screen.getByTestId("lot-trace-follow-origin"));
    await waitFor(() => { expect(screen.getAllByTestId("lot-trace-derived-lot")).toHaveLength(2); });
    expect((screen.getByTestId("lot-presentation-input") as HTMLInputElement).value).toBe(PRESENTATION);
  });
});

/**
 * Alertas de vencimiento (§Vencimientos regla 3). Sólo cuentan las tandas con
 * existencia, y el umbral que se muestra es el que trae la respuesta: el doble
 * responde 5 a propósito, para que una pantalla que escribiera «7» por su
 * cuenta no pasara.
 */
describe("LotPanel — alertas de vencimiento", () => {
  const row = (code: string, state: string, quantity: string) => ({
    lot_id: `44444444-4444-4444-8444-4444444440${code.length}${code.charCodeAt(0) % 10}`,
    lot_code: code, received_date: "2026-09-10", expiry_date: "2026-09-24",
    quantity_on_hand: quantity, status: quantity === "0.000000" ? "CONSUMED" : "ACTIVE",
    expiry_state: state,
  });

  beforeEach(() => {
    install();
    const service = (window as unknown as { posService: Record<string, (r: unknown) => Promise<unknown>> }).posService;
    service["inventory.lot.list"] = () => Promise.resolve({
      status: "SUCCEEDED", result_code: "LISTED",
      result: {
        outcome: "LISTED",
        near_expiry_days: 5,
        lots: [
          row("VENCIDA", "EXPIRED", "3.000000"),
          row("AGOTADA", "NEAR_EXPIRY", "0.000000"),
          row("PRONTO", "NEAR_EXPIRY", "8.000000"),
          row("TARDE", "VALID", "20.000000"),
        ],
      },
    });
  });

  it("cuenta las tandas con existencia que vencen pronto y las vencidas, con el umbral del servicio", async () => {
    render(<LotPanel />);
    fireEvent.change(screen.getByTestId("lot-presentation-input"), { target: { value: PRESENTATION } });
    fireEvent.click(screen.getByTestId("lot-list-button"));
    await waitFor(() => { expect(screen.getByTestId("lot-list")).toBeTruthy(); });

    expect(screen.getByTestId("lot-near-expiry-count").textContent).toBe("1");
    expect(screen.getByTestId("lot-near-expiry-days").textContent).toBe("5");
    expect(screen.getByTestId("lot-expired-count").textContent).toBe("1");
  });
});

/**
 * Lo que vence esta semana. Un nombre que Catálogo no devuelve no borra la
 * tanda: se muestra con su identificador y el motivo. Un aviso que perdiera
 * filas dejaría producto vencido en la vitrina sin avisar.
 */
describe("LotPanel — lo que vence esta semana", () => {
  const OTHER = "11111111-1111-4111-8111-11111111cccc";
  const row = (presentationId: string, code: string, state: string) => ({
    presentation_id: presentationId, lot_code: code, expiry_date: "2026-09-24",
    quantity_on_hand: "5.000000", status: "ACTIVE", expiry_state: state,
  });

  beforeEach(() => {
    install();
    const service = (window as unknown as { posService: Record<string, (r: unknown) => Promise<unknown>> }).posService;
    service["inventory.lot.expiring"] = () => Promise.resolve({
      status: "SUCCEEDED", result_code: "LISTED",
      result: {
        outcome: "LISTED", near_expiry_days: 7, truncated: false,
        lots: [row(PRESENTATION, "L-VENCIDA", "EXPIRED"), row(OTHER, "L-PRONTO", "NEAR_EXPIRY")],
      },
    });
    service["catalog.item.get"] = (request) => Promise.resolve(
      (request as Envelope).payload["presentation_id"] === PRESENTATION
        ? { status: "SUCCEEDED", result_code: "FOUND", result: { outcome: "FOUND", name: "Carne molida", presentation_name: "Gramo" } }
        : { status: "REJECTED", result_code: "NOT_FOUND", result: { outcome: "NOT_FOUND" } },
    );
  });

  it("nombra cada tanda con Catálogo y conserva la que no tiene nombre", async () => {
    render(<LotPanel />);
    fireEvent.click(screen.getByTestId("expiring-load-button"));
    await waitFor(() => { expect(screen.getByTestId("expiring")).toBeTruthy(); });

    expect(screen.getByTestId("expiring-count").textContent).toBe("2");
    expect(screen.getAllByTestId("expiring-lot-name").map((cell) => cell.textContent)).toEqual([
      "Carne molida · Gramo",
      `${OTHER} (NOT_FOUND)`,
    ]);
    expect(screen.getAllByTestId("expiring-lot-state").map((cell) => cell.textContent)).toEqual([
      "Vencida: sacar por merma", "Vender primero",
    ]);
  });
});

/**
 * El rechazo por código repetido dice con qué fechas existe ya la tanda y si
 * es aquí o en otra sucursal —sin nombrarla—, para corregir la captura.
 */
describe("LotPanel — código de lote ya usado con otras fechas", () => {
  beforeEach(() => {
    install();
    const service = (window as unknown as { posService: Record<string, (r: unknown) => Promise<unknown>> }).posService;
    service["inventory.lot.receive"] = () => Promise.resolve({
      status: "REJECTED", result_code: "LOT_CODE_CONFLICT",
      result: {
        outcome: "LOT_CODE_CONFLICT", lot_id: null, quantity_after: null, lot_quantity_on_hand: null,
        conflicting_lot: { where: "OTHER_BRANCH", manufactured_date: null, expiry_date: "2026-09-30" },
      },
    });
  });

  it("muestra las fechas existentes y que es en otra sucursal", async () => {
    render(<LotPanel />);
    fireEvent.change(screen.getByTestId("lot-presentation-input"), { target: { value: PRESENTATION } });
    fireEvent.change(screen.getByTestId("lot-code-input"), { target: { value: "L-1" } });
    fireEvent.change(screen.getByTestId("lot-quantity-input"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("lot-receive-button"));
    await waitFor(() => { expect(screen.getByTestId("lot-received-conflict")).toBeTruthy(); });
    expect(screen.getByTestId("lot-received-outcome").textContent).toBe("LOT_CODE_CONFLICT");
    expect(screen.getByTestId("lot-received-conflict-where").textContent).toBe("en otra sucursal");
    expect(screen.getByTestId("lot-received-conflict-manufactured").textContent).toBe("sin fecha");
    expect(screen.getByTestId("lot-received-conflict-expiry").textContent).toBe("2026-09-30");
  });
});
