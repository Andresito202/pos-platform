// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SalesReceiptGetRequestSchema } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { ReceiptPanel } from "../../renderer/src/components/ReceiptPanel.js";

/**
 * La pantalla del recibo contra respuestas controladas.
 *
 * Aquí el canal **sí** es un doble, y a propósito: lo que se prueba es que la
 * vista distingue los tres desenlaces y que no inventa cifras. Que la cadena
 * real funcione lo demuestra el E2E de Electron contra el servicio de verdad —
 * un doble aquí no acredita alcance, y este fichero no lo pretende.
 */

const SALE = "55555555-5555-4555-8555-555555555555";
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

const RECEIPT = {
  status: "SUCCEEDED",
  result_code: "FOUND",
  result: {
    outcome: "FOUND",
    sale_id: SALE,
    document_series: "POS1",
    sale_number: 7,
    currency_code: "COP",
    business_date: "2026-09-03",
    completed_at: "2026-09-03T12:00:00.000Z",
    lines: [{
      line_number: 1,
      product_name: "Arroz",
      presentation_name: "Bolsa 500g",
      identifier: null,
      unit_code: "GRM",
      unit_precision: 0,
      quantity: "2.000000",
      unit_price_amount: "3500.000000",
      gross_amount: "7000.000000",
      discount_amount: "0.000000",
      taxable_amount: "7000.000000",
      tax_amount: "0.000000",
      line_total_amount: "7000.000000",
    }],
    subtotal_amount: "7000.000000",
    discount_amount: "0.000000",
    tax_amount: "0.000000",
    fiscal_total_amount: "7000.000000",
    commercial_rounding_adjustment: "0.000000",
    payable_amount: "7000.000000",
    payments: [{
      payment_method: "CASH",
      confirmed_amount: "7000.000000",
      tendered_amount: "10000.000000",
      change_amount: "3000.000000",
      currency_code: "COP",
      confirmed_at: "2026-09-03T12:00:01.000Z",
    }],
    calculation_checksum: "a".repeat(64),
  },
};

function ask(saleId: string): void {
  fireEvent.change(screen.getByTestId("receipt-sale-id-input"), { target: { value: saleId } });
  fireEvent.click(screen.getByTestId("receipt-load-button"));
}

describe("ReceiptPanel", () => {
  beforeEach(() => { calls.clear(); });

  it("pide el recibo con un sobre que el contrato acepta", async () => {
    install(RECEIPT);
    render(<ReceiptPanel />);
    ask(SALE);

    await waitFor(() => { expect(screen.getByTestId("receipt")).toBeTruthy(); });

    // El sobre que sale del renderer tiene que pasar el esquema real, no uno
    // aproximado: es la frontera donde una lectura mal formada muere.
    const [envelope] = calls.get("sales.receipt.get") ?? [];
    expect(SalesReceiptGetRequestSchema.safeParse(envelope).success).toBe(true);
  });

  it("formatea COP y cantidades sin recalcular los importes del servicio", async () => {
    install(RECEIPT);
    render(<ReceiptPanel />);
    ask(SALE);

    await waitFor(() => { expect(screen.getByTestId("receipt")).toBeTruthy(); });

    expect(screen.getByTestId("receipt-sale-id").textContent).toBe(SALE);
    expect(screen.getByTestId("receipt-document").textContent).toBe("POS1-7");
    expect(screen.getByTestId("receipt-subtotal").textContent).toBe("$7.000");
    expect(screen.getByTestId("receipt-payable").textContent).toBe("$7.000");
    expect(screen.getByTestId("receipt-currency").textContent).toBe("COP");

    expect(screen.getAllByTestId("receipt-line")).toHaveLength(1);
    expect(screen.getByTestId("receipt-line-name").textContent).toBe("Arroz");
    expect(screen.getByTestId("receipt-line-quantity").textContent).toBe("2");
    expect(screen.getByTestId("receipt-line-total").textContent).toBe("$7.000");

    expect(screen.getAllByTestId("receipt-payment")).toHaveLength(1);
    expect(screen.getByTestId("receipt-payment-amount").textContent).toBe("$7.000");
    expect(screen.getByTestId("receipt-payment-change").textContent).toBe("$3.000");
  });

  it("distingue una venta que no existe de una que no está cobrada", async () => {
    install({ status: "REJECTED", result_code: "NOT_FOUND", result: { outcome: "NOT_FOUND", sale_id: null, document_series: null, sale_number: null, currency_code: null, business_date: null, completed_at: null, lines: null, subtotal_amount: null, discount_amount: null, tax_amount: null, fiscal_total_amount: null, commercial_rounding_adjustment: null, payable_amount: null, payments: null, calculation_checksum: null } });
    const view = render(<ReceiptPanel />);
    ask(SALE);
    await waitFor(() => { expect(screen.getByTestId("receipt-not-found")).toBeTruthy(); });
    expect(screen.queryByTestId("receipt")).toBeNull();
    expect(screen.queryByTestId("receipt-not-completed")).toBeNull();
    view.unmount();

    install({ status: "REJECTED", result_code: "NOT_COMPLETED", result: { outcome: "NOT_COMPLETED", sale_id: null, document_series: null, sale_number: null, currency_code: null, business_date: null, completed_at: null, lines: null, subtotal_amount: null, discount_amount: null, tax_amount: null, fiscal_total_amount: null, commercial_rounding_adjustment: null, payable_amount: null, payments: null, calculation_checksum: null } });
    render(<ReceiptPanel />);
    ask(SALE);
    await waitFor(() => { expect(screen.getByTestId("receipt-not-completed")).toBeTruthy(); });
    // La distinción es el punto: una venta sin cobrar no se anuncia como
    // inexistente, porque el cajero la tiene delante y debe cobrarla.
    expect(screen.queryByTestId("receipt-not-found")).toBeNull();
    expect(screen.queryByTestId("receipt")).toBeNull();
  });

  it("no pide nada mientras no haya identificador", () => {
    install(RECEIPT);
    render(<ReceiptPanel />);
    expect((screen.getByTestId("receipt-load-button") as HTMLButtonElement).disabled).toBe(true);
    expect(calls.get("sales.receipt.get")).toBeUndefined();
  });
});
