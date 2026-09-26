// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { FiscalPanel } from "../../renderer/src/components/FiscalPanel.js";

/**
 * `D-40` — decisión del propietario del 2026-09-26, «advertir»: si la factura
 * no nombra al cliente que nombró la venta, la pantalla dice los dos y pide
 * confirmar. Confirmar reenvía **la misma petición** con la confirmación, no
 * lo que haya en los campos en ese momento: si el operador tocó el campo
 * después del aviso, confirmaría una factura distinta de la que vio.
 *
 * El canal es un doble a propósito; la cadena real la cubre la vertical.
 */
const SALE = "55555555-5555-4555-8555-555555555555";
const SALE_CUSTOMER = "66666666-6666-4666-8666-666666666666";
const REQUESTED = "77777777-7777-4777-8777-777777777777";

type Envelope = { payload: Record<string, unknown> };
const sent: Envelope[] = [];

const empty = {
  document_id: null, transport_status: null, normalized_result: null, cufe: null,
  issued_prefix: null, issued_number: null, attempt_count: null, reasons: [],
};

beforeEach(() => {
  sent.length = 0;
  const service: Record<string, (request: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = () => Promise.reject(new Error(`inesperado: ${method}`));
  }
  service["fiscal.document.issue"] = (request) => {
    const envelope = request as Envelope;
    sent.push(envelope);
    return Promise.resolve(envelope.payload["acknowledge_customer_mismatch"] === true
      ? {
        status: "SUCCEEDED", result_code: "ISSUED",
        result: {
          ...empty, outcome: "ISSUED", document_id: "88888888-8888-4888-8888-888888888888",
          cufe: "c".repeat(96), issued_number: "990000002", block_code: null, customer_mismatch: null,
        },
      }
      : {
        status: "REJECTED", result_code: "BLOCKED",
        result: {
          ...empty, outcome: "BLOCKED", block_code: "CUSTOMER_MISMATCH",
          customer_mismatch: { sale_customer_id: SALE_CUSTOMER, requested_customer_id: REQUESTED },
        },
      });
  };
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
});

describe("FiscalPanel — adquiriente distinto del de la venta (D-40)", () => {
  it("avisa con los dos adquirientes y confirma reenviando la misma petición", async () => {
    render(<FiscalPanel />);
    fireEvent.change(screen.getByTestId("fiscal-sale-id-input"), { target: { value: SALE } });
    fireEvent.change(screen.getByTestId("fiscal-customer-id-input"), { target: { value: REQUESTED } });
    fireEvent.click(screen.getByTestId("issue-identified-button"));

    await waitFor(() => { expect(screen.getByTestId("fiscal-customer-mismatch")).toBeTruthy(); });
    expect(screen.getByTestId("fiscal-mismatch-sale-customer").textContent).toBe(SALE_CUSTOMER);
    expect(screen.getByTestId("fiscal-mismatch-requested-customer").textContent).toBe(REQUESTED);
    expect(screen.queryByTestId("fiscal-issued")).toBeNull();
    expect(sent[0]!.payload["acknowledge_customer_mismatch"]).toBeUndefined();

    // El operador toca el campo después del aviso: la confirmación no lo usa.
    fireEvent.change(screen.getByTestId("fiscal-customer-id-input"), { target: { value: SALE_CUSTOMER } });
    fireEvent.click(screen.getByTestId("fiscal-confirm-mismatch-button"));

    await waitFor(() => { expect(screen.getByTestId("fiscal-issued")).toBeTruthy(); });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload).toMatchObject({
      sale_id: SALE,
      customer: { kind: "IDENTIFIED", customer_id: REQUESTED },
      acknowledge_customer_mismatch: true,
    });
    expect(screen.queryByTestId("fiscal-customer-mismatch")).toBeNull();
  });
});
