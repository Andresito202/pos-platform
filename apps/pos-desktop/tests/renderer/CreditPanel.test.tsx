// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CreditAccountGetRequestSchema,
  CreditAccountOpenRequestSchema,
  CreditPaymentRegisterRequestSchema,
  PaymentRegisterCreditRequestSchema,
} from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { CreditPanel } from "../../renderer/src/components/CreditPanel.js";

/**
 * La pantalla de fiado contra respuestas controladas.
 *
 * El canal es un doble a propósito: lo que se prueba es **qué sobre construye
 * la pantalla** y **cómo lee el desenlace**. Que el sobre sea aceptable no se
 * afirma, se comprueba parseándolo con el esquema real del contrato — lo único
 * que distingue «la prueba se lo cree» de «el servidor lo aceptaría».
 *
 * Lo que más importa aquí no es el camino feliz: es que los rechazos
 * enumerados por `DEC-005` lleguen al cajero **por su nombre**.
 * `CUSTOMER_REQUIRED` le dice que asocie un adquiriente;
 * `CREDIT_LIMIT_EXCEEDED` le dice cuánto quedaba para cobrar la diferencia.
 * Un mensaje genérico obligaría a adivinar las dos.
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

const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const SALE = "44444444-4444-4444-8444-444444444444";
const REGISTER = "55555555-5555-4555-8555-555555555555";

function fillCustomer(): void {
  fireEvent.change(screen.getByTestId("credit-customer-id-input"), { target: { value: CUSTOMER } });
}

describe("CreditPanel — cuenta de crédito", () => {
  it("abre una cuenta con un sobre que el contrato acepta", async () => {
    install({
      status: "SUCCEEDED", result_code: "OPENED",
      result: { outcome: "OPENED", account_id: "66666666-6666-4666-8666-666666666666" },
    });
    render(<CreditPanel />);
    fillCustomer();
    fireEvent.change(screen.getByTestId("credit-limit-input"), { target: { value: "200000.000000" } });
    fireEvent.click(screen.getByTestId("open-credit-account-button"));

    await waitFor(() => { expect(screen.getByTestId("credit-opened")).toBeTruthy(); });
    expect(screen.getByTestId("credit-opened-outcome").textContent).toBe("OPENED");

    const envelope = sent("credit.account.open");
    expect(() => CreditAccountOpenRequestSchema.parse(envelope)).not.toThrow();
    // Abrir cuenta muta: el sobre lleva las dos marcas de idempotencia.
    expect(envelope["idempotency_key"]).toBeTypeOf("string");
    expect(envelope["operation_id"]).toBeTypeOf("string");
    // Y no lleva identidad: la deriva la capa confiable.
    expect(Object.hasOwn(envelope, "tenant_id")).toBe(false);
  });

  it("consultar cupo y saldo es una lectura, sin marcas de idempotencia", async () => {
    install({
      status: "SUCCEEDED", result_code: "FOUND",
      result: {
        outcome: "FOUND", account_id: "66666666-6666-4666-8666-666666666666",
        customer_id: CUSTOMER, credit_limit: "200000.000000",
        outstanding_balance: "50000.000000", available_credit: "150000.000000",
        currency_code: "COP",
      },
    });
    render(<CreditPanel />);
    fillCustomer();
    fireEvent.click(screen.getByTestId("read-credit-account-button"));

    await waitFor(() => { expect(screen.getByTestId("credit-account")).toBeTruthy(); });
    // Los tres números se muestran tal cual llegan: la pantalla no los deduce.
    expect(screen.getByTestId("credit-account-limit").textContent).toBe("200000.000000");
    expect(screen.getByTestId("credit-account-balance").textContent).toBe("50000.000000");
    expect(screen.getByTestId("credit-account-available").textContent).toBe("150000.000000");

    const envelope = sent("credit.account.get");
    expect(() => CreditAccountGetRequestSchema.parse(envelope)).not.toThrow();
    expect(Object.hasOwn(envelope, "idempotency_key")).toBe(false);
  });

  it("una cuenta inexistente se dice, no se disimula", async () => {
    install({
      status: "SUCCEEDED", result_code: "CREDIT_ACCOUNT_NOT_FOUND",
      result: {
        outcome: "CREDIT_ACCOUNT_NOT_FOUND", account_id: null, customer_id: null,
        credit_limit: null, outstanding_balance: null, available_credit: null,
        currency_code: null,
      },
    });
    render(<CreditPanel />);
    fillCustomer();
    fireEvent.click(screen.getByTestId("read-credit-account-button"));

    await waitFor(() => { expect(screen.getByTestId("credit-account-missing")).toBeTruthy(); });
    expect(screen.getByTestId("credit-account-missing").textContent).toBe("CREDIT_ACCOUNT_NOT_FOUND");
  });
});

describe("CreditPanel — fiar una venta", () => {
  function charge(): void {
    fireEvent.change(screen.getByTestId("credit-sale-id-input"), { target: { value: SALE } });
    fireEvent.change(screen.getByTestId("credit-charge-amount-input"), { target: { value: "30000.000000" } });
    fireEvent.click(screen.getByTestId("charge-to-credit-button"));
  }

  it("fía y muestra que la venta quedó completada", async () => {
    install({
      status: "SUCCEEDED", result_code: "CONFIRMED",
      result: {
        outcome: "CONFIRMED", payment_id: "77777777-7777-4777-8777-777777777777",
        sale_completed: true, confirmed_coverage: "30000.000000",
        payable_amount: "30000.000000", available_credit: null,
      },
    });
    render(<CreditPanel />);
    charge();

    await waitFor(() => { expect(screen.getByTestId("credit-charged")).toBeTruthy(); });
    expect(screen.getByTestId("credit-charged-completed").textContent).toBe("COMPLETED");
    expect(() => PaymentRegisterCreditRequestSchema.parse(sent("payment.register.credit"))).not.toThrow();
  });

  it("un cupo excedido muestra cuánto quedaba, que es lo único accionable", async () => {
    install({
      status: "SUCCEEDED", result_code: "CREDIT_LIMIT_EXCEEDED",
      result: {
        outcome: "CREDIT_LIMIT_EXCEEDED", payment_id: null, sale_completed: null,
        confirmed_coverage: null, payable_amount: null, available_credit: "12000.000000",
      },
    });
    render(<CreditPanel />);
    charge();

    await waitFor(() => { expect(screen.getByTestId("credit-limit-exceeded")).toBeTruthy(); });
    // El rechazo es duro y sin override: la pantalla no ofrece reintentar,
    // ofrece el número con el que el cajero cobra la diferencia.
    expect(screen.getByTestId("credit-limit-exceeded-available").textContent).toBe("12000.000000");
    expect(screen.queryByTestId("credit-charged")).toBeNull();
  });

  it("una venta sin adquiriente se rechaza por su nombre", async () => {
    install({
      status: "SUCCEEDED", result_code: "CUSTOMER_REQUIRED",
      result: {
        outcome: "CUSTOMER_REQUIRED", payment_id: null, sale_completed: null,
        confirmed_coverage: null, payable_amount: null, available_credit: null,
      },
    });
    render(<CreditPanel />);
    charge();

    await waitFor(() => { expect(screen.getByTestId("credit-charge-rejected")).toBeTruthy(); });
    // `DEC-002` §159: sin adquiriente no se fía. El cajero necesita leer eso.
    expect(screen.getByTestId("credit-charge-rejected").textContent).toBe("CUSTOMER_REQUIRED");
  });
});

describe("CreditPanel — abono", () => {
  function fillRepayment(): void {
    fillCustomer();
    fireEvent.change(screen.getByTestId("credit-repayment-amount-input"), { target: { value: "20000.000000" } });
    fireEvent.change(screen.getByTestId("credit-repayment-date-input"), { target: { value: "2026-09-20" } });
  }

  it("un abono en efectivo nombra la caja donde entra el dinero", async () => {
    install({
      status: "SUCCEEDED", result_code: "RECORDED",
      result: {
        outcome: "RECORDED", transaction_id: "88888888-8888-4888-8888-888888888888",
        outstanding_balance: "30000.000000", available_credit: "170000.000000",
      },
    });
    render(<CreditPanel />);
    fillRepayment();
    fireEvent.change(screen.getByTestId("credit-repayment-register-input"), { target: { value: REGISTER } });
    fireEvent.click(screen.getByTestId("register-repayment-button"));

    await waitFor(() => { expect(screen.getByTestId("credit-repaid")).toBeTruthy(); });
    expect(screen.getByTestId("credit-repaid-balance").textContent).toBe("30000.000000");

    const envelope = sent("credit.payment.register");
    expect(() => CreditPaymentRegisterRequestSchema.parse(envelope)).not.toThrow();
    expect((envelope["payload"] as Record<string, unknown>)["cash_register_id"]).toBe(REGISTER);
  });

  it("una transferencia no toca caja: viaja sin registradora", async () => {
    install({
      status: "SUCCEEDED", result_code: "RECORDED",
      result: {
        outcome: "RECORDED", transaction_id: "88888888-8888-4888-8888-888888888888",
        outstanding_balance: "30000.000000", available_credit: "170000.000000",
      },
    });
    render(<CreditPanel />);
    fillRepayment();
    fireEvent.change(screen.getByTestId("credit-repayment-method-select"), { target: { value: "TRANSFER" } });
    fireEvent.click(screen.getByTestId("register-repayment-button"));

    await waitFor(() => { expect(screen.getByTestId("credit-repaid")).toBeTruthy(); });
    const envelope = sent("credit.payment.register");
    // El contrato exige caja sólo en efectivo; aquí debe ser `null`, y el
    // esquema lo comprueba.
    expect((envelope["payload"] as Record<string, unknown>)["cash_register_id"]).toBeNull();
    expect(() => CreditPaymentRegisterRequestSchema.parse(envelope)).not.toThrow();
  });

  it("el botón no deja enviar un abono en efectivo sin caja", () => {
    install({ status: "SUCCEEDED", result_code: "RECORDED", result: null });
    render(<CreditPanel />);
    fillRepayment();
    // El contrato lo rechazaría; la pantalla no llega a intentarlo.
    expect(screen.getByTestId("register-repayment-button").hasAttribute("disabled")).toBe(true);
  });

  it("un abono mayor que la deuda se rechaza por su nombre", async () => {
    install({
      status: "SUCCEEDED", result_code: "REPAYMENT_EXCEEDS_BALANCE",
      result: {
        outcome: "REPAYMENT_EXCEEDS_BALANCE", transaction_id: null,
        outstanding_balance: null, available_credit: null,
      },
    });
    render(<CreditPanel />);
    fillRepayment();
    fireEvent.change(screen.getByTestId("credit-repayment-register-input"), { target: { value: REGISTER } });
    fireEvent.click(screen.getByTestId("register-repayment-button"));

    await waitFor(() => { expect(screen.getByTestId("credit-repayment-rejected")).toBeTruthy(); });
    expect(screen.getByTestId("credit-repayment-rejected").textContent).toBe("REPAYMENT_EXCEEDS_BALANCE");
  });
});
