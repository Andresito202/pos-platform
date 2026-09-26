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
