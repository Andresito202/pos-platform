// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { useProviderPayment } from "../../renderer/src/hooks/useProviderPayment.js";
import { useFiscalIssuance } from "../../renderer/src/hooks/useFiscalIssuance.js";
import { useCommercialSale } from "../../renderer/src/hooks/useCommercialSale.js";

/**
 * Guarda de doble clic — hallazgo de la auditoría de seguridad del
 * 2026-09-26: `disabled={busy}` deshabilita el botón, pero **nada** dentro de
 * los hooks impedía una segunda invocación si llegaba antes de que React
 * repintase el DOM. Cada `newIdempotencyKey()` es distinta por clic, así que
 * el servidor no tenía forma de saber que dos peticiones eran el mismo
 * intento: dos clics genuinos habrían producido dos cargos reales.
 *
 * Estas pruebas llaman a la función expuesta por el hook **dos veces sin
 * esperar la primera**, exactamente el caso que un botón deshabilitado no
 * cubre por sí solo (aquí no hay DOM ni atributo `disabled`: nada detendría
 * la segunda llamada salvo la guarda que se está probando). Cada una simula
 * el peor de los dos clics de un doble clic: el segundo, disparado antes de
 * que el primero termine.
 */

let sent: Array<{ method: string; payload: unknown }>;

function mockService(handlers: Record<string, (payload: unknown) => Promise<unknown>>): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      sent.push({ method, payload });
      const handler = handlers[method];
      return handler ? handler(payload) : Promise.reject(new Error(`inesperado: ${method}`));
    };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

/** Nunca se resuelve por sí sola: expone `resolve` para controlar el momento exacto. */
function pendingResponse<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => { sent = []; });

describe("doble clic — payment.register.qr", () => {
  it("la segunda llamada, disparada antes de que la primera responda, no llega al servicio", async () => {
    const first = pendingResponse<unknown>();
    let calls = 0;
    mockService({
      "payment.register.qr": () => { calls += 1; return first.promise; },
    });

    const { result } = renderHook(() => useProviderPayment());

    let secondCall: Promise<void> | undefined;
    act(() => {
      void result.current.chargeWithQr("sale-1", "10000.000000");
      secondCall = result.current.chargeWithQr("sale-1", "10000.000000");
    });
    await secondCall;

    expect(calls).toBe(1);
    expect(sent).toHaveLength(1);

    act(() => first.resolve({
      status: "SUCCEEDED", result_code: "OK",
      result: { payment_id: "p1", provider_reference: "r1", checkout_url: "https://example.test", expires_at: null },
    }));
    await waitFor(() => { expect(result.current.busy).toBe(false); });
    expect(result.current.qr?.payment_id).toBe("p1");
  });
});

describe("doble clic — fiscal.document.issue (el caso de mayor riesgo: dos facturas reales)", () => {
  it("la segunda llamada no emite un segundo documento", async () => {
    const first = pendingResponse<unknown>();
    let calls = 0;
    mockService({
      "fiscal.document.issue": () => { calls += 1; return first.promise; },
    });

    const { result } = renderHook(() => useFiscalIssuance());

    let secondCall: Promise<void> | undefined;
    act(() => {
      void result.current.issue("sale-1", "INVOICE", { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" });
      secondCall = result.current.issue("sale-1", "INVOICE", { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" });
    });
    await secondCall;

    // Sólo un documento pedido, no dos: es exactamente lo que estaba en
    // riesgo — con la idempotencia sola (clave distinta por clic) el
    // servidor habría aceptado ambas como facturas legítimas y distintas.
    expect(calls).toBe(1);
    expect(sent).toHaveLength(1);

    act(() => first.resolve({
      status: "SUCCEEDED", result_code: "ISSUED",
      result: {
        outcome: "ISSUED", document_id: "d1", transport_status: "ACCEPTED", normalized_result: "ACCEPTED",
        cufe: "c".repeat(96), issued_prefix: "SETP", issued_number: "1", attempt_count: 1,
        reasons: [], block_code: null, customer_mismatch: null,
      },
    }));
    await waitFor(() => { expect(result.current.busy).toBe(false); });
    expect(result.current.issued?.document_id).toBe("d1");
  });
});

describe("doble clic — payment.register.cash (pago en efectivo real)", () => {
  it("tras crear la venta, dos cobros disparados juntos sólo registran uno", async () => {
    const foundItem = {
      status: "SUCCEEDED", result_code: "OK",
      result: {
        outcome: "FOUND", product_id: "prod-1", presentation_id: "pres-1", code: "ARZ-500",
        name: "Arroz", presentation_name: "Bolsa 500g", unit_code: "GRM", unit_precision: 0,
        price_amount: "5000.000000", currency_code: "COP",
      },
    };
    const created = {
      status: "SUCCEEDED", result_code: "OK",
      result: { sale_id: "sale-1", sale_number: 1, payable_amount: "5000.000000", calculation_checksum: "x".repeat(64) },
    };
    const firstPayment = pendingResponse<unknown>();
    let paymentCalls = 0;
    mockService({
      "catalog.item.find": () => Promise.resolve(foundItem),
      "sale.create": () => Promise.resolve(created),
      "payment.register.cash": () => { paymentCalls += 1; return firstPayment.promise; },
    });

    const { result } = renderHook(() => useCommercialSale());
    await act(async () => { await result.current.findItem("7701234567890"); });
    act(() => { result.current.addFoundItem("1"); });
    await act(async () => { await result.current.createSale(); });
    expect(result.current.sale?.saleId).toBe("sale-1");

    let secondCharge: Promise<void> | undefined;
    act(() => {
      void result.current.chargeCash();
      secondCharge = result.current.chargeCash();
    });
    await secondCharge;

    expect(paymentCalls).toBe(1);

    act(() => firstPayment.resolve({
      status: "SUCCEEDED", result_code: "OK",
      result: {
        payment_id: "pay-1", sale_completed: true, confirmed_coverage: "5000.000000",
        payable_amount: "5000.000000", change_amount: "0.000000",
      },
    }));
    await waitFor(() => { expect(result.current.busy).toBe(false); });
    expect(result.current.payment?.payment_id).toBe("pay-1");
  });
});
