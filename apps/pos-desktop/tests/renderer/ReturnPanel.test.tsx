// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PaymentsRefundConfirmRequestSchema, SalesReturnCreateRequestSchema } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { ReturnPanel } from "../../renderer/src/components/ReturnPanel.js";

/**
 * La pantalla de devolución contra respuestas controladas. El canal es un
 * doble: aquí se prueba que la vista pide lo que el contrato admite y que
 * muestra lo que el servicio decidió sin calcular nada. La devolución real
 * —caja, inventario, lote— la prueba el servicio por el socket.
 */

const SALE = "55555555-5555-4555-8555-555555555555";
const REGISTER = "66666666-6666-4666-8666-666666666666";
const calls = new Map<string, unknown[]>();

function install(canned: Record<string, unknown>): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      return method in canned ? Promise.resolve(canned[method]) : new Promise(() => {});
    };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

const LINE = {
  identifier: null, unit_precision: 0, gross_amount: "7000.000000", discount_amount: "0.000000",
  taxable_amount: "7000.000000", tax_amount: "0.000000", unit_price_amount: "3500.000000",
};
const RECEIPT = {
  status: "SUCCEEDED",
  result_code: "FOUND",
  result: {
    outcome: "FOUND", sale_id: SALE, document_series: "POS1", sale_number: 7, customer_id: null,
    currency_code: "COP", business_date: "2026-09-27", completed_at: "2026-09-27T12:00:00.000Z",
    lines: [
      { ...LINE, line_number: 1, product_name: "Arroz", presentation_name: "Bolsa 500 g", unit_code: "UND", quantity: "2.000000", line_total_amount: "7000.000000" },
      { ...LINE, line_number: 2, product_name: "Leche", presentation_name: "Caja 1 L", unit_code: "UND", quantity: "1.000000", line_total_amount: "4200.000000" },
    ],
    subtotal_amount: "11200.000000", discount_amount: "0.000000", tax_amount: "0.000000",
    fiscal_total_amount: "11200.000000", commercial_rounding_adjustment: "0.000000", payable_amount: "11200.000000",
    payments: [], calculation_checksum: "a".repeat(64),
  },
};

function returned(outcome: string, extra: Record<string, unknown> = {}, status = "SUCCEEDED") {
  return {
    status, result_code: outcome,
    result: {
      outcome, sale_return_id: null, refund_id: null, commercial_amount: null, rounding_adjustment: null,
      refunded_amount: null, restocked_lines: null, fiscal_correction: null, refund_status: null, ...extra,
    },
  };
}

const COMPLETED = returned("COMPLETED", {
  sale_return_id: "77777777-7777-4777-8777-777777777777",
  refund_id: "88888888-8888-4888-8888-888888888888",
  commercial_amount: "4200.000000", rounding_adjustment: "0.000000",
  refunded_amount: "4200.000000", restocked_lines: 1, fiscal_correction: "NO_FISCAL_DOCUMENT",
  refund_status: "COMPLETED",
});

const TRANSFER_RECEIPT = {
  status: "SUCCEEDED", result_code: "FOUND",
  result: {
    ...RECEIPT.result,
    payments: [{
      payment_method: "TRANSFER", confirmed_amount: "11200.000000", tendered_amount: null, change_amount: null,
      currency_code: "COP", confirmed_at: "2026-09-27T12:00:00.000Z",
    }],
  },
};

function confirmed(outcome: string, extra: Record<string, unknown> = {}, status = "SUCCEEDED") {
  return { status, result_code: outcome, result: { outcome, refund_id: null, completed_amount: null, ...extra } };
}

async function loadSale(): Promise<void> {
  fireEvent.change(screen.getByTestId("return-sale-id-input"), { target: { value: SALE } });
  fireEvent.click(screen.getByTestId("return-load-button"));
  await waitFor(() => { expect(screen.getAllByTestId("return-line")).toHaveLength(2); });
}

beforeEach(() => { calls.clear(); });

describe("ReturnPanel — devolución de una venta cobrada (B11)", () => {
  it("pide lo que el contrato admite: línea, estado físico, caja y motivo, con clave de idempotencia", async () => {
    install({ "sales.receipt.get": RECEIPT, "sales.return.create": COMPLETED });
    render(<ReturnPanel />);
    await loadSale();

    const submit = screen.getByTestId("return-submit-button") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("return-line-check-2"));
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("return-register-input"), { target: { value: REGISTER } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByTestId("return-line-condition-2"), { target: { value: "DAMAGED" } });
    fireEvent.click(submit);

    await waitFor(() => { expect(calls.get("sales.return.create")).toHaveLength(1); });
    const request = calls.get("sales.return.create")![0] as { payload: Record<string, unknown>; idempotency_key?: string };
    expect(() => SalesReturnCreateRequestSchema.parse(request)).not.toThrow();
    expect(request.payload).toEqual({
      sale_id: SALE, cash_register_id: REGISTER, reason_code: "CAMBIO_DE_OPINION", reason_detail: null,
      lines: [{ line_number: 2, physical_condition: "DAMAGED" }],
    });
  });

  it("muestra el importe que decidió el servicio, no uno calculado en pantalla", async () => {
    install({ "sales.receipt.get": RECEIPT, "sales.return.create": COMPLETED });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-2"));
    fireEvent.change(screen.getByTestId("return-register-input"), { target: { value: REGISTER } });
    fireEvent.click(screen.getByTestId("return-submit-button"));

    await waitFor(() => { expect(screen.getByTestId("return-completed")).toBeTruthy(); });
    expect(screen.getByTestId("return-refunded-amount").textContent).toBe("4200.000000");
    expect(screen.queryByTestId("return-fiscal-pending")).toBeNull();
    // Hecha la devolución, el formulario queda cerrado: no se vuelve a pulsar sobre la misma.
    expect((screen.getByTestId("return-submit-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("si la venta tenía factura electrónica, dice que falta la nota crédito", async () => {
    install({
      "sales.receipt.get": RECEIPT,
      "sales.return.create": returned("COMPLETED", {
        sale_return_id: "77777777-7777-4777-8777-777777777777", refund_id: "88888888-8888-4888-8888-888888888888",
        commercial_amount: "11200.000000", rounding_adjustment: "0.000000", refunded_amount: "11200.000000",
        restocked_lines: 2, fiscal_correction: "REQUIRED_NOT_AVAILABLE",
      }),
    });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-1"));
    fireEvent.click(screen.getByTestId("return-line-check-2"));
    fireEvent.change(screen.getByTestId("return-register-input"), { target: { value: REGISTER } });
    fireEvent.click(screen.getByTestId("return-submit-button"));
    await waitFor(() => { expect(screen.getByTestId("return-fiscal-pending")).toBeTruthy(); });
    expect(screen.getByTestId("return-completed")).toBeTruthy();
  });

  it("un rechazo se explica y no deja la devolución por hecha", async () => {
    install({
      "sales.receipt.get": RECEIPT,
      "sales.return.create": returned("INSUFFICIENT_CASH", {}, "REJECTED"),
    });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-1"));
    fireEvent.change(screen.getByTestId("return-register-input"), { target: { value: REGISTER } });
    fireEvent.click(screen.getByTestId("return-submit-button"));
    await waitFor(() => { expect(screen.getByTestId("return-rejected").textContent).toContain("No se entregó nada"); });
    expect(screen.queryByTestId("return-completed")).toBeNull();
    expect((screen.getByTestId("return-submit-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("«Otro» exige explicar el motivo", async () => {
    install({ "sales.receipt.get": RECEIPT });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-1"));
    fireEvent.change(screen.getByTestId("return-register-input"), { target: { value: REGISTER } });
    fireEvent.change(screen.getByTestId("return-reason-select"), { target: { value: "OTRO" } });
    const submit = screen.getByTestId("return-submit-button") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("return-detail-input"), { target: { value: "Llegó abierto" } });
    expect(submit.disabled).toBe(false);
  });

  it("una venta sin cobrar no ofrece líneas que devolver", async () => {
    install({
      "sales.receipt.get": {
        status: "REJECTED", result_code: "NOT_COMPLETED",
        result: { ...RECEIPT.result, outcome: "NOT_COMPLETED", lines: null, payments: null },
      },
    });
    render(<ReturnPanel />);
    fireEvent.change(screen.getByTestId("return-sale-id-input"), { target: { value: SALE } });
    fireEvent.click(screen.getByTestId("return-load-button"));
    await waitFor(() => { expect(screen.getByTestId("return-sale-not-completed")).toBeTruthy(); });
    expect(screen.queryByTestId("return-form")).toBeNull();
  });

  it("una venta cobrada en efectivo exige caja; el rechazo del servicio se explica igual", async () => {
    install({
      "sales.receipt.get": RECEIPT,
      "sales.return.create": returned("CASH_REGISTER_REQUIRED", {}, "REJECTED"),
    });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-1"));
    const submit = screen.getByTestId("return-submit-button") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("return-register-input"), { target: { value: REGISTER } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => { expect(screen.getByTestId("return-rejected").textContent).toContain("indique de qué caja"); });
  });

  it("una venta por transferencia no pide caja, y el reembolso queda pendiente de confirmar", async () => {
    install({
      "sales.receipt.get": TRANSFER_RECEIPT,
      "sales.return.create": returned("COMPLETED", {
        sale_return_id: "77777777-7777-4777-8777-777777777777", refund_id: "88888888-8888-4888-8888-888888888888",
        commercial_amount: "11200.000000", rounding_adjustment: "0.000000", refunded_amount: "11200.000000",
        restocked_lines: 2, fiscal_correction: "NO_FISCAL_DOCUMENT", refund_status: "PROCESSING",
      }),
    });
    render(<ReturnPanel />);
    await loadSale();
    expect(screen.queryByTestId("return-register-input")).toBeNull();
    fireEvent.click(screen.getByTestId("return-line-check-1"));
    fireEvent.click(screen.getByTestId("return-line-check-2"));
    fireEvent.click(screen.getByTestId("return-submit-button"));

    await waitFor(() => { expect(calls.get("sales.return.create")).toHaveLength(1); });
    const request = calls.get("sales.return.create")![0] as { payload: Record<string, unknown> };
    expect(request.payload["cash_register_id"]).toBeNull();
    expect(() => SalesReturnCreateRequestSchema.parse(request)).not.toThrow();

    await waitFor(() => { expect(screen.getByTestId("return-refund-pending")).toBeTruthy(); });
    expect(screen.getByTestId("return-refund-pending-amount").textContent).toBe("11200.000000");
    expect(screen.queryByTestId("return-refund-confirmed")).toBeNull();
  });

  it("confirmar el reembolso pide referencia y destino, y viaja con clave de idempotencia", async () => {
    install({
      "sales.receipt.get": TRANSFER_RECEIPT,
      "sales.return.create": returned("COMPLETED", {
        sale_return_id: "77777777-7777-4777-8777-777777777777", refund_id: "88888888-8888-4888-8888-888888888888",
        commercial_amount: "4200.000000", rounding_adjustment: "0.000000", refunded_amount: "4200.000000",
        restocked_lines: 1, fiscal_correction: "NO_FISCAL_DOCUMENT", refund_status: "PROCESSING",
      }),
      "payments.refund.confirm": confirmed("CONFIRMED", { refund_id: "88888888-8888-4888-8888-888888888888", completed_amount: "4200.000000" }),
    });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-2"));
    fireEvent.click(screen.getByTestId("return-submit-button"));
    await waitFor(() => { expect(screen.getByTestId("return-refund-pending")).toBeTruthy(); });

    const confirmButton = screen.getByTestId("return-confirm-button") as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("return-confirm-reference-input"), { target: { value: "TRX-001" } });
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("return-confirm-destination-input"), { target: { value: "Cuenta 123" } });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => { expect(calls.get("payments.refund.confirm")).toHaveLength(1); });
    const request = calls.get("payments.refund.confirm")![0] as { payload: Record<string, unknown> };
    expect(() => PaymentsRefundConfirmRequestSchema.parse(request)).not.toThrow();
    expect(request.payload).toEqual({
      refund_id: "88888888-8888-4888-8888-888888888888", provider_reference: "TRX-001", destination_reference: "Cuenta 123",
    });
    await waitFor(() => { expect(screen.getByTestId("return-refund-confirmed").textContent).toContain("4200.000000"); });
    expect(screen.queryByTestId("return-refund-pending")).toBeNull();
  });

  it("si el mismo actor intenta confirmar, el rechazo lo explica y el reembolso sigue pendiente", async () => {
    install({
      "sales.receipt.get": TRANSFER_RECEIPT,
      "sales.return.create": returned("COMPLETED", {
        sale_return_id: "77777777-7777-4777-8777-777777777777", refund_id: "88888888-8888-4888-8888-888888888888",
        commercial_amount: "4200.000000", rounding_adjustment: "0.000000", refunded_amount: "4200.000000",
        restocked_lines: 1, fiscal_correction: "NO_FISCAL_DOCUMENT", refund_status: "PROCESSING",
      }),
      "payments.refund.confirm": confirmed("SAME_ACTOR_NOT_ALLOWED", {}, "REJECTED"),
    });
    render(<ReturnPanel />);
    await loadSale();
    fireEvent.click(screen.getByTestId("return-line-check-2"));
    fireEvent.click(screen.getByTestId("return-submit-button"));
    await waitFor(() => { expect(screen.getByTestId("return-refund-pending")).toBeTruthy(); });
    fireEvent.change(screen.getByTestId("return-confirm-reference-input"), { target: { value: "TRX-001" } });
    fireEvent.change(screen.getByTestId("return-confirm-destination-input"), { target: { value: "Cuenta 123" } });
    fireEvent.click(screen.getByTestId("return-confirm-button"));

    await waitFor(() => { expect(screen.getByTestId("return-confirm-rejected").textContent).toContain("otra persona"); });
    expect(screen.getByTestId("return-refund-pending")).toBeTruthy();
  });
});
