// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  PaymentCancelRequestSchema,
  PaymentGetRequestSchema,
  PaymentRegisterQrRequestSchema,
} from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { ProviderPaymentPanel } from "../../renderer/src/components/ProviderPaymentPanel.js";

/**
 * La pantalla de QR y cancelación contra respuestas controladas.
 *
 * El doble sustituye al canal, no al núcleo: lo que se prueba es qué sobre
 * construye la pantalla —parseado con el esquema real del contrato— y cómo lee
 * cada desenlace. Lo demás se prueba contra el servicio real en `e2e/`.
 *
 * Lo que más importa aquí son tres distinciones que la pantalla puede borrar y
 * no debe: **pendiente no es cobrado**, **sin proveedor no es fallo** y **no
 * cancelable no es error**.
 */

const SALE = "018f0000-0000-7000-8000-00000000e001";
const PAYMENT = "018f0000-0000-7000-8000-00000000e002";

const calls = new Map<string, unknown[]>();

function install(byMethod: Record<string, unknown>): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      return Promise.resolve(byMethod[method] ?? { status: "SUCCEEDED", result_code: "OK", result: null });
    };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

function sent(method: string, index = 0): Record<string, unknown> {
  const seen = calls.get(method) ?? [];
  expect(seen.length).toBeGreaterThan(index);
  return seen[index] as Record<string, unknown>;
}

const qrPending = {
  status: "SUCCEEDED",
  result_code: "PENDING",
  result: {
    outcome: "PENDING",
    payment_id: PAYMENT,
    provider_reference: PAYMENT,
    checkout_url: "https://checkout.example.com/abc123",
  },
};

const paymentFound = (status: string, version: number) => ({
  status: "SUCCEEDED",
  result_code: "FOUND",
  result: {
    outcome: "FOUND",
    payment_id: PAYMENT,
    sale_id: SALE,
    method: "QR",
    status,
    expected_amount: "18000.000000",
    confirmed_amount: "0.000000",
    currency_code: "COP",
    version,
  },
});

async function chargeQr(): Promise<void> {
  fireEvent.change(screen.getByTestId("qr-sale-id-input"), { target: { value: SALE } });
  fireEvent.change(screen.getByTestId("qr-amount-input"), { target: { value: "18000.000000" } });
  fireEvent.click(screen.getByTestId("charge-qr-button"));
}

async function readPayment(): Promise<void> {
  fireEvent.change(screen.getByTestId("payment-id-input"), { target: { value: PAYMENT } });
  fireEvent.click(screen.getByTestId("read-payment-button"));
  await screen.findByTestId("payment-found");
}

beforeEach(() => { calls.clear(); });

describe("ProviderPaymentPanel", () => {
  it("el sobre del QR cumple el contrato, lleva idempotencia y no lleva identidad", async () => {
    install({ "payment.register.qr": qrPending });
    render(<ProviderPaymentPanel />);
    await chargeQr();
    await screen.findByTestId("qr-pending");

    const request = sent("payment.register.qr");
    expect(() => PaymentRegisterQrRequestSchema.parse(request)).not.toThrow();
    // Cobrar muta: el contrato exige ambas marcas.
    expect(typeof request["idempotency_key"]).toBe("string");
    expect(typeof request["operation_id"]).toBe("string");
    expect(request).not.toHaveProperty("tenant_id");
  });

  it("pendiente no es cobrado: muestra referencia y checkout sin declarar pago", async () => {
    install({ "payment.register.qr": qrPending });
    render(<ProviderPaymentPanel />);
    await chargeQr();
    await screen.findByTestId("qr-pending");

    expect(screen.getByTestId("qr-payment-id").textContent).toBe(PAYMENT);
    expect(screen.getByTestId("qr-provider-reference").textContent).toBe(PAYMENT);
    expect(screen.getByTestId("qr-checkout-url").textContent)
      .toBe("https://checkout.example.com/abc123");
    expect(screen.queryByTestId("qr-rejected")).toBeNull();
  });

  it("la referencia y el checkout salen del servicio: el renderer no los construye", async () => {
    install({ "payment.register.qr": qrPending });
    render(<ProviderPaymentPanel />);
    await chargeQr();
    await screen.findByTestId("qr-pending");

    // `DEC-016` §21: la referencia comercial la elige la capa de aplicación.
    // El sobre enviado no la contiene, así que no pudo salir de aquí.
    const request = sent("payment.register.qr");
    const payload = request["payload"] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("provider_reference");
    expect(payload).not.toHaveProperty("checkout_url");
    expect(Object.keys(payload).sort()).toEqual(["amount", "sale_id"]);
  });

  it("sin adquiriente configurado lo dice por su nombre, y no como fallo", async () => {
    install({
      "payment.register.qr": {
        status: "REJECTED",
        result_code: "PROVIDER_NOT_CONFIGURED",
        result: {
          outcome: "PROVIDER_NOT_CONFIGURED",
          payment_id: null, provider_reference: null, checkout_url: null,
        },
      },
    });
    render(<ProviderPaymentPanel />);
    await chargeQr();
    await screen.findByTestId("qr-provider-not-configured");

    expect(screen.queryByTestId("qr-rejected")).toBeNull();
    expect(screen.queryByTestId("provider-payment-error")).toBeNull();
    expect(screen.queryByTestId("qr-pending")).toBeNull();
  });

  it("un rechazo del proveedor llega por su nombre", async () => {
    install({
      "payment.register.qr": {
        status: "REJECTED",
        result_code: "PROVIDER_REJECTED",
        result: {
          outcome: "PROVIDER_REJECTED",
          payment_id: null, provider_reference: null, checkout_url: null,
        },
      },
    });
    render(<ProviderPaymentPanel />);
    await chargeQr();
    await screen.findByTestId("qr-rejected");

    expect(screen.getByTestId("qr-rejected").textContent).toBe("PROVIDER_REJECTED");
  });

  it("consultar un pago es lectura pura: sin marcas de idempotencia", async () => {
    install({ "payment.get": paymentFound("PENDING", 1) });
    render(<ProviderPaymentPanel />);
    await readPayment();

    const request = sent("payment.get");
    expect(() => PaymentGetRequestSchema.parse(request)).not.toThrow();
    expect(request).not.toHaveProperty("idempotency_key");
    expect(request).not.toHaveProperty("operation_id");
  });

  it("la lectura muestra las cifras del servicio verbatim", async () => {
    install({ "payment.get": paymentFound("PENDING", 3) });
    render(<ProviderPaymentPanel />);
    await readPayment();

    expect(screen.getByTestId("payment-status").textContent).toBe("PENDING");
    expect(screen.getByTestId("payment-method").textContent).toBe("QR");
    expect(screen.getByTestId("payment-expected-amount").textContent).toBe("18000.000000");
    expect(screen.getByTestId("payment-confirmed-amount").textContent).toBe("0.000000");
    expect(screen.getByTestId("payment-version").textContent).toBe("3");
  });

  it("no se puede cancelar sin haber leído la versión", async () => {
    install({ "payment.get": paymentFound("PENDING", 1) });
    render(<ProviderPaymentPanel />);
    fireEvent.change(screen.getByTestId("payment-id-input"), { target: { value: PAYMENT } });

    // Con el identificador puesto pero sin lectura, el botón sigue cerrado: la
    // versión es control optimista y no un número que la pantalla invente.
    expect((screen.getByTestId("cancel-payment-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancelar envía exactamente la versión leída", async () => {
    install({
      "payment.get": paymentFound("PENDING", 7),
      "payment.cancel": {
        status: "SUCCEEDED",
        result_code: "CANCELLED",
        result: { outcome: "CANCELLED", payment_id: PAYMENT },
      },
    });
    render(<ProviderPaymentPanel />);
    await readPayment();
    fireEvent.click(screen.getByTestId("cancel-payment-button"));
    await screen.findByTestId("payment-cancelled");

    const request = sent("payment.cancel");
    expect(() => PaymentCancelRequestSchema.parse(request)).not.toThrow();
    expect((request["payload"] as Record<string, unknown>)["expected_version"]).toBe(7);
    expect(screen.getByTestId("cancelled-payment-id").textContent).toBe(PAYMENT);
  });

  it("cancelar lo ya cancelado no es un rechazo: el servicio devuelve IDEMPOTENT", async () => {
    // `sqlite-payment-store.ts` devuelve `IDEMPOTENT` cuando el pago ya estaba
    // cancelado. Es el mismo hecho operativo que `CANCELLED`, y pintarlo como
    // fallo haría dudar de una cancelación que sí ocurrió.
    install({
      "payment.get": paymentFound("CANCELLED", 2),
      "payment.cancel": {
        status: "SUCCEEDED",
        result_code: "IDEMPOTENT",
        result: { outcome: "IDEMPOTENT", payment_id: PAYMENT },
      },
    });
    render(<ProviderPaymentPanel />);
    await readPayment();
    fireEvent.click(screen.getByTestId("cancel-payment-button"));
    await screen.findByTestId("payment-cancelled");

    expect(screen.getByTestId("payment-already-cancelled")).toBeTruthy();
    expect(screen.queryByTestId("cancel-rejected")).toBeNull();
    expect(screen.queryByTestId("provider-payment-error")).toBeNull();
  });

  it("no cancelable no es error: es la regla financiera funcionando", async () => {
    install({
      "payment.get": paymentFound("CONFIRMED", 2),
      "payment.cancel": {
        status: "REJECTED",
        result_code: "PAYMENT_NOT_CANCELLABLE",
        result: { outcome: "PAYMENT_NOT_CANCELLABLE", payment_id: PAYMENT },
      },
    });
    render(<ProviderPaymentPanel />);
    await readPayment();
    fireEvent.click(screen.getByTestId("cancel-payment-button"));
    await screen.findByTestId("payment-not-cancellable");

    expect(screen.queryByTestId("cancel-rejected")).toBeNull();
    expect(screen.queryByTestId("provider-payment-error")).toBeNull();
  });

  it("un conflicto de versión se nombra: alguien movió el pago entre lectura y orden", async () => {
    install({
      "payment.get": paymentFound("PENDING", 1),
      "payment.cancel": {
        status: "REJECTED",
        result_code: "VERSION_CONFLICT",
        result: { outcome: "VERSION_CONFLICT", payment_id: null },
      },
    });
    render(<ProviderPaymentPanel />);
    await readPayment();
    fireEvent.click(screen.getByTestId("cancel-payment-button"));
    await screen.findByTestId("cancel-rejected");

    expect(screen.getByTestId("cancel-rejected").textContent).toBe("VERSION_CONFLICT");
  });

  it("un pago inexistente se nombra y no se confunde con un pago hallado", async () => {
    install({
      "payment.get": {
        status: "SUCCEEDED",
        result_code: "NOT_FOUND",
        result: {
          outcome: "NOT_FOUND", payment_id: null, sale_id: null, method: null,
          status: null, expected_amount: null, confirmed_amount: null,
          currency_code: null, version: null,
        },
      },
    });
    render(<ProviderPaymentPanel />);
    fireEvent.change(screen.getByTestId("payment-id-input"), { target: { value: PAYMENT } });
    fireEvent.click(screen.getByTestId("read-payment-button"));
    await screen.findByTestId("payment-missing");

    expect(screen.getByTestId("payment-missing").textContent).toBe("NOT_FOUND");
    expect(screen.queryByTestId("payment-found")).toBeNull();
    // Y sin versión no hay cancelación posible.
    await waitFor(() => {
      expect((screen.getByTestId("cancel-payment-button") as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
