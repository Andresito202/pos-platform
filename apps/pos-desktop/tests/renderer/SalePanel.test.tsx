// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CashShiftCloseRequestSchema,
  CashShiftOpenRequestSchema,
  CatalogItemFindRequestSchema,
  PaymentRegisterCashRequestSchema,
  SaleCreateRequestSchema,
} from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { SalePanel } from "../../renderer/src/components/SalePanel.js";

const chime = vi.hoisted(() => vi.fn());
vi.mock("../../renderer/src/confirmation-sound.js", async (importOriginal) => {
  // `shouldPlayChime` se mantiene REAL: es la regla bajo prueba. Sólo se
  // sustituye la reproducción, que es lo que jsdom no puede ejecutar.
  const actual = await importOriginal<typeof import("../../renderer/src/confirmation-sound.js")>();
  return { ...actual, playConfirmationChime: chime };
});

const REGISTER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const PRESENTATION = "33333333-3333-4333-8333-333333333333";
const SHIFT = "44444444-4444-4444-8444-444444444444";
const SALE = "55555555-5555-4555-8555-555555555555";
const PAYMENT = "66666666-6666-4666-8666-666666666666";

const calls = new Map<string, unknown[]>();

function succeeded(result: unknown) {
  return { status: "SUCCEEDED", result_code: "OK", result };
}

function serviceWith(overrides: Record<string, unknown>) {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      const canned = overrides[method];
      if (canned === undefined) return Promise.resolve(succeeded(null));
      return Promise.resolve(canned);
    };
  }
  return service;
}

const FOUND_ITEM = succeeded({
  outcome: "FOUND",
  product_id: PRODUCT,
  presentation_id: PRESENTATION,
  code: "ARZ-500",
  name: "Arroz",
  presentation_name: "Bolsa 500g",
  unit_code: "GRM",
  unit_precision: 0,
  barcode: "7701234567890",
  stock_controlled: true,
  price_amount: "3500.000000",
  currency_code: "COP",
});

function install(overrides: Record<string, unknown>): void {
  Object.defineProperty(window, "posService", {
    value: serviceWith(overrides),
    writable: true,
    configurable: true,
  });
}

async function openShift(): Promise<void> {
  fireEvent.change(screen.getByTestId("cash-register-input"), { target: { value: REGISTER } });
  fireEvent.click(screen.getByTestId("open-shift-button"));
  await screen.findByTestId("shift-open");
}

async function addProduct(): Promise<void> {
  fireEvent.change(screen.getByTestId("barcode-input"), { target: { value: "7701234567890" } });
  fireEvent.click(screen.getByTestId("find-item-button"));
  await screen.findByTestId("found-item");
  fireEvent.click(screen.getByTestId("add-item-button"));
  await screen.findByTestId("cart-line");
}

async function createSale(): Promise<void> {
  fireEvent.click(screen.getByTestId("create-sale-button"));
  await screen.findByTestId("sale-created");
}

const BASE_OVERRIDES = {
  "cash.shift.open": succeeded({ outcome: "OPENED", shift_id: SHIFT, version: 1 }),
  "catalog.item.find": FOUND_ITEM,
  "sale.create": succeeded({
    outcome: "CREATED",
    sale_id: SALE,
    sale_number: 1,
    payable_amount: "3500.000000",
    calculation_checksum: "a".repeat(64),
  }),
};

function cashResult(outcome: string, saleCompleted: boolean) {
  return succeeded({
    outcome,
    payment_id: PAYMENT,
    sale_completed: saleCompleted,
    confirmed_coverage: saleCompleted ? "3500.000000" : "2000.000000",
    payable_amount: "3500.000000",
    change_amount: "0.000000",
  });
}

beforeEach(() => {
  calls.clear();
  chime.mockClear();
});

describe("SalePanel — vertical comercial", () => {
  it("se monta con la caja cerrada", () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    expect(screen.getByTestId("shift-closed")).toBeTruthy();
  });

  it("abre el turno nombrando la caja, y el request cumple el contrato", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();

    expect(screen.getByTestId("shift-register").textContent).toBe(REGISTER);
    const request = calls.get("cash.shift.open")![0];
    expect(() => CashShiftOpenRequestSchema.parse(request)).not.toThrow();
  });

  it("busca el producto por código de barras con un request contractual", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();
    fireEvent.change(screen.getByTestId("barcode-input"), { target: { value: "7701234567890" } });
    fireEvent.click(screen.getByTestId("find-item-button"));
    await screen.findByTestId("found-item");

    expect(screen.getByTestId("found-item-name").textContent).toBe("Arroz");
    expect(() => CatalogItemFindRequestSchema.parse(calls.get("catalog.item.find")![0])).not.toThrow();
  });

  it("el producto seleccionado entra en la venta", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();
    await addProduct();

    expect(screen.getAllByTestId("cart-line")).toHaveLength(1);
  });

  it("sale.create envía cash_register_id y el request cumple el contrato", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();

    const request = calls.get("sale.create")![0] as { payload: Record<string, unknown> };
    expect(request.payload["cash_register_id"]).toBe(REGISTER);
    expect(() => SaleCreateRequestSchema.parse(request)).not.toThrow();
    expect(screen.getByTestId("payable-amount").textContent).toBe("3500.000000");
  });

  it("sale.create NO envía cash_shift_id: la resolución no vive en el renderer", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();

    const request = calls.get("sale.create")![0] as { payload: Record<string, unknown> };
    expect(request.payload).not.toHaveProperty("cash_shift_id");
  });

  it("ningún request comercial declara identidad: el ámbito lo deriva la capa confiable", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();

    for (const [method, seen] of calls) {
      for (const request of seen as Array<Record<string, unknown>>) {
        for (const forbidden of ["tenant_id", "company_id", "branch_id", "device_id", "actor_id"]) {
          expect(request, `${method} declaró ${forbidden}`).not.toHaveProperty(forbidden);
        }
      }
    }
  });

  it("el cobro en efectivo usa el contrato y el importe emitido por el servicio", async () => {
    install({ ...BASE_OVERRIDES, "payment.register.cash": cashResult("CONFIRMED", true) });
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("sale-completed");

    const request = calls.get("payment.register.cash")![0] as { payload: Record<string, unknown> };
    expect(request.payload["sale_id"]).toBe(SALE);
    expect(request.payload["amount"]).toBe("3500.000000");
    expect(() => PaymentRegisterCashRequestSchema.parse(request)).not.toThrow();
  });

  it("sale_completed = true produce EXACTAMENTE un cha-ching", async () => {
    install({ ...BASE_OVERRIDES, "payment.register.cash": cashResult("CONFIRMED", true) });
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("sale-completed");

    expect(chime).toHaveBeenCalledTimes(1);
  });

  it("un pago parcial confirmado NO suena, y la UI lo dice", async () => {
    install({ ...BASE_OVERRIDES, "payment.register.cash": cashResult("CONFIRMED", false) });
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("payment-partial");

    expect(screen.getByTestId("confirmed-coverage").textContent).toBe("2000.000000");
    expect(chime).not.toHaveBeenCalled();
  });

  it("un reintento idempotente no vuelve a sonar aunque la venta esté cobrada", async () => {
    install({ ...BASE_OVERRIDES, "payment.register.cash": cashResult("IDEMPOTENT", true) });
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("sale-completed");

    expect(chime).not.toHaveBeenCalled();
  });

  it("un rechazo del cobro no suena y muestra el código estable", async () => {
    install({
      ...BASE_OVERRIDES,
      "payment.register.cash": { status: "REJECTED", result_code: "CASH_SHIFT_NOT_OPEN", result: null },
    });
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();
    fireEvent.click(screen.getByTestId("charge-cash-button"));

    await waitFor(() => {
      expect(screen.getByTestId("sale-error").textContent).toBe("CASH_SHIFT_NOT_OPEN");
    });
    expect(chime).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sale-completed")).toBeNull();
  });

  it("sin turno abierto la venta viaja con cash_register_id nulo", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await addProduct();
    await createSale();

    const request = calls.get("sale.create")![0] as { payload: Record<string, unknown> };
    expect(request.payload["cash_register_id"]).toBeNull();
    expect(() => SaleCreateRequestSchema.parse(request)).not.toThrow();
  });
});

describe("SalePanel · cierre de turno", () => {
  beforeEach(() => { calls.clear(); });

  async function openShift(): Promise<void> {
    fireEvent.change(screen.getByTestId("cash-register-input"), { target: { value: REGISTER } });
    fireEvent.change(screen.getByTestId("opening-amount-input"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("open-shift-button"));
    await waitFor(() => { expect(screen.getByTestId("shift-open")).toBeTruthy(); });
  }

  it("cierra el turno con la versión que trajo la apertura, no con una supuesta", async () => {
    install({
      ...BASE_OVERRIDES,
      "cash.shift.open": succeeded({ outcome: "OPENED", shift_id: SHIFT, version: 7 }),
      "cash.shift.close": succeeded({
        outcome: "CLOSED", shift_id: SHIFT,
        expected_cash: "50000.000000", counted_amount: "50000.000000",
        difference_amount: "0.000000",
      }),
    });
    render(<SalePanel />);
    await openShift();

    fireEvent.change(screen.getByTestId("counted-amount-input"), { target: { value: "50000" } });
    fireEvent.click(screen.getByTestId("close-shift-button"));
    await waitFor(() => { expect(screen.getByTestId("shift-close-result")).toBeTruthy(); });

    const envelope = calls.get("cash.shift.close")![0] as { payload: Record<string, unknown> };
    // La versión es la que entregó el servicio. Si la pantalla la supusiera,
    // aquí habría un 1 y el cierre fallaría contra un turno real.
    expect(envelope.payload["expected_version"]).toBe(7);
    expect(envelope.payload["shift_id"]).toBe(SHIFT);
    // Lo tecleado se normaliza a escala 6; el cajero no escribe seis decimales.
    expect(envelope.payload["counted_amount"]).toBe("50000.000000");
    expect(CashShiftCloseRequestSchema.safeParse(envelope).success).toBe(true);
  });

  it("muestra el arqueo tal como lo devuelve el servicio, sin restar en pantalla", async () => {
    install({
      ...BASE_OVERRIDES,
      "cash.shift.open": succeeded({ outcome: "OPENED", shift_id: SHIFT, version: 1 }),
      "cash.shift.close": succeeded({
        outcome: "CLOSED", shift_id: SHIFT,
        expected_cash: "50000.000000", counted_amount: "48000.000000",
        difference_amount: "-2000.000000",
      }),
    });
    render(<SalePanel />);
    await openShift();

    fireEvent.change(screen.getByTestId("counted-amount-input"), { target: { value: "48000" } });
    fireEvent.click(screen.getByTestId("close-shift-button"));
    await waitFor(() => { expect(screen.getByTestId("shift-close-result")).toBeTruthy(); });

    expect(screen.getByTestId("shift-expected-cash").textContent).toBe("50000.000000");
    expect(screen.getByTestId("shift-counted-amount").textContent).toBe("48000.000000");
    expect(screen.getByTestId("shift-difference").textContent).toBe("-2000.000000");
    // El turno deja de estar abierto y la caja vuelve a admitir apertura.
    expect(screen.queryByTestId("shift-open")).toBeNull();
    expect(screen.getByTestId("shift-close-result")).toBeTruthy();
  });

  it("un cierre rechazado no cierra el turno ni se disfraza de éxito", async () => {
    install({
      ...BASE_OVERRIDES,
      "cash.shift.open": succeeded({ outcome: "OPENED", shift_id: SHIFT, version: 1 }),
      "cash.shift.close": succeeded({
        outcome: "VERSION_CONFLICT", shift_id: null,
        expected_cash: null, counted_amount: null, difference_amount: null,
      }),
    });
    render(<SalePanel />);
    await openShift();

    fireEvent.change(screen.getByTestId("counted-amount-input"), { target: { value: "50000" } });
    fireEvent.click(screen.getByTestId("close-shift-button"));
    await waitFor(() => { expect(screen.getByTestId("shift-close-rejected")).toBeTruthy(); });

    expect(screen.getByTestId("shift-close-rejected").textContent).toBe("VERSION_CONFLICT");
    // El turno sigue abierto: cerrar sobre un estado obsoleto sería peor.
    expect(screen.getByTestId("shift-open")).toBeTruthy();
    expect(screen.queryByTestId("shift-close-result")).toBeNull();
  });

  it("no pide cierre sin efectivo contado", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift();
    expect((screen.getByTestId("close-shift-button") as HTMLButtonElement).disabled).toBe(true);
    expect(calls.get("cash.shift.close")).toBeUndefined();
  });
});
