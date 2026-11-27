// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CashShiftCloseRequestSchema,
  PaymentRegisterTransferRequestSchema,
  PaymentTransferConfirmRequestSchema,
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
  description: null,
  brand: null,
  category: null,
  presentation_name: "Bolsa 500g",
  unit_code: "GRM",
  unit_precision: 0,
  barcode: "7701234567890",
  stock_controlled: true,
  price_amount: "3500.000000",
  currency_code: "COP",
  quantity_available: "20.000000",
  quantity_on_hand: "20.000000",
  quantity_reserved: "0.000000",
  quantity_unsellable: "0.000000",
  low_stock_threshold: null,
  availability_state: "AVAILABLE",
  product_version: 1,
  presentation_version: 1,
  media_id: null,
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
  it("labels the untaxed cart estimate and switches to the service payable total",async()=>{
    install({...BASE_OVERRIDES,"sale.create":succeeded({outcome:"CREATED",sale_id:SALE,sale_number:1,payable_amount:"4200.000000",calculation_checksum:"a".repeat(64)})});
    render(<SalePanel />);await openShift();await addProduct();
    expect(screen.getByTestId("cart-preview-total").textContent).toContain("Subtotal estimado (sin impuestos ni redondeo)");
    expect(screen.getByTestId("cart-preview-total").textContent).toContain("3.500");
    await createSale();
    expect(screen.getByTestId("cart-preview-total").textContent).toContain("Total a pagar");
    expect(screen.getByTestId("cart-preview-total").textContent).toContain("4.200");
  });
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

  it("keeps denomination counting optional and preserves its amount when collapsed", async () => {
    install(BASE_OVERRIDES);
    render(<SalePanel />);
    await openShift(); await addProduct(); await createSale();
    const toggle = screen.getByRole("button", { name: "Ver billetes y monedas" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Añadir billete de $5.000" })).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Añadir billete de $5.000" }));
    expect(screen.getByTestId("tendered-display").textContent).toBe("$5.000");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar billetes y monedas" }));
    expect(screen.queryByRole("button", { name: "Añadir billete de $5.000" })).toBeNull();
    expect(screen.getByTestId("tendered-display").textContent).toBe("$5.000");
    expect(calls.get("payment.register.cash")).toBeUndefined();
  });

  it("keeps checkout inside the sale layout and marks shortage distinctly from change", async () => {
    install(BASE_OVERRIDES);
    const { container } = render(<SalePanel />);
    expect(screen.getByTestId("shift-closed").className).toContain("pos-shift-card");
    await openShift();
    expect(screen.getByTestId("shift-open").className).toContain("pos-shift-card");
    await addProduct();
    await createSale();
    const layout = container.querySelector(".pos-sale-layout");
    const checkout = screen.getByTestId("sale-created");
    expect(layout?.contains(checkout)).toBe(true);
    fireEvent.change(screen.getByLabelText("Efectivo recibido (COP)"), { target: { value: "1000" } });
    const estimate = await screen.findByTestId("cash-change-estimate");
    expect(estimate.getAttribute("data-coverage")).toBe("shortage");
    expect(estimate.textContent).toContain("Falta para cubrir");
    fireEvent.change(screen.getByLabelText("Efectivo recibido (COP)"), { target: { value: "5000" } });
    await waitFor(() => {
      expect(screen.getByTestId("cash-change-estimate").getAttribute("data-coverage")).toBe("change");
    });
  });

  it("normalizes typed cash before sending the payment contract", async () => {
    install({ ...BASE_OVERRIDES, "payment.register.cash": cashResult("CONFIRMED", true) });
    render(<SalePanel />);
    await openShift(); await addProduct(); await createSale();
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "00" }));
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("sale-completed");
    const request = calls.get("payment.register.cash")![0];
    expect(PaymentRegisterCashRequestSchema.safeParse(request).success).toBe(true);
    expect((request as { payload: { tendered_amount: string } }).payload.tendered_amount).toBe("4000.000000");
  });


  it("supports a partial cash payment without calculating a new total in the renderer", async () => {
    install({ ...BASE_OVERRIDES, "payment.register.cash": cashResult("CONFIRMED", false) });
    render(<SalePanel />);
    await openShift(); await addProduct(); await createSale();
    fireEvent.change(screen.getByTestId("payment-amount-input"), { target: { value: "2000" } });
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("payment-partial");
    const request = calls.get("payment.register.cash")![0];
    expect(PaymentRegisterCashRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ payload: { amount: "2000.000000", tendered_amount: "2000.000000" } });
    expect(screen.getByTestId("payable-amount").getAttribute("data-amount")).toBe("3500.000000");
    expect(screen.getByTestId("payable-amount").textContent).toBe("3500.000000");
    expect(chime).not.toHaveBeenCalled();
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

  it("recovers a saved cart and server-owned open shift in a fresh panel", async () => {
    const cart={id:PRODUCT,version:3,updated_at:"2026-11-13T10:00:00Z",line_count:1,
      active_shift:{shift_id:SHIFT,version:7},payload:{label:"Guardado",cash_register_id:REGISTER,
        lines:[{productId:PRODUCT,presentationId:PRESENTATION,name:"Arroz",presentationName:"Bolsa",priceAmount:"3500.000000",currencyCode:"COP",quantity:"2.000000",identifier:"7701234567890"}]}};
    const found={status:"SUCCEEDED",result_code:"FOUND",result:{outcome:"FOUND",carts:[cart],has_more:false}};
    install({...BASE_OVERRIDES,"cart.waiting.list":found,"cart.waiting.get":found});
    render(<SalePanel permissions={new Set(["SALES_SALE_CREATE"])}/>);
    fireEvent.click(screen.getByTestId("list-waiting"));
    fireEvent.click(await screen.findByRole("button",{name:/Guardado · 1 líneas/}));
    await screen.findByTestId("shift-open");await screen.findByTestId("cart-line");
    expect(calls.get("cash.shift.open")).toBeUndefined();
    await createSale();
    expect(calls.get("sale.create")?.[0]).toMatchObject({payload:{cash_register_id:REGISTER,waiting_cart:{id:PRODUCT,version:3},lines:[{quantity:"2.000000"}]}});
  });

  it("does not clear a cart on lost save response and retries the same snapshot", async () => {
    install(BASE_OVERRIDES);
    const save=vi.fn().mockRejectedValueOnce(Error("response lost")).mockImplementationOnce(async (request: { payload: { cart_id: string; cart: unknown } })=>({
      status:"SUCCEEDED",result_code:"SAVED",result:{outcome:"SAVED",has_more:false,carts:[{id:request.payload.cart_id,version:1,
        updated_at:new Date().toISOString(),line_count:1,payload:request.payload.cart}]},
    }));
    Object.defineProperty(window.posService,"cart.waiting.save",{value:save});
    render(<SalePanel permissions={new Set(["SALES_SALE_CREATE"])}/>);
    await openShift();await addProduct();fireEvent.click(screen.getByTestId("hold-cart"));
    await waitFor(()=>expect(screen.getByTestId("sale-error").textContent).toBe("response lost"));
    expect(screen.getAllByTestId("cart-line")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("retry-pending-operation"));
    await waitFor(()=>expect(screen.queryAllByTestId("cart-line")).toHaveLength(0));
    expect(save.mock.calls[1]?.[0]).toEqual(save.mock.calls[0]?.[0]);
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

describe("SalePanel · transferencia", () => {
  beforeEach(() => { calls.clear(); chime.mockClear(); });

  const PAYMENT = "77777777-7777-4777-8777-777777777777";

  const registered = (outcome: string) => succeeded({ outcome, payment_id: PAYMENT });

  const fetched = (
    version: number, status = "CREATED", expectedAmount = "3500.000000", coverage?: string,
  ) => succeeded({
    outcome: "FOUND", payment_id: PAYMENT, sale_id: SALE,
    method: "TRANSFER", status, expected_amount: expectedAmount,
    confirmed_amount: null, sale_confirmed_coverage: coverage, currency_code: "COP", version,
  });

  const confirmed = (outcome: string, saleCompleted: boolean) => succeeded({
    outcome, payment_id: PAYMENT, sale_completed: saleCompleted,
    confirmed_coverage: saleCompleted ? "3500.000000" : "1000.000000",
    payable_amount: "3500.000000",
  });

  const rejected = (outcome: string) => ({
    status: "REJECTED", result_code: outcome,
    result: {
      outcome, payment_id: null, sale_completed: false,
      confirmed_coverage: null, payable_amount: null,
    },
  });

  async function reachSale(overrides: Record<string, unknown>): Promise<void> {
    install({ ...BASE_OVERRIDES, ...overrides });
    render(<SalePanel />);
    await openShift();
    await addProduct();
    await createSale();
  }

  async function registerTransfer(): Promise<void> {
    fireEvent.click(screen.getByTestId("register-transfer-button"));
    await waitFor(() => { expect(screen.getByTestId("transfer-registered")).toBeTruthy(); });
  }

  it("reporta un importe parcial y la referencia del comprobante Nequi", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(3, "CREATED", "1250.000000"),
    });
    const report = vi.spyOn(window.posService, "payment.register.transfer");
    fireEvent.change(screen.getByLabelText("Importe de la transferencia"), { target: { value: "1250" } });
    fireEvent.change(screen.getByLabelText("Canal de la transferencia"), { target: { value: "NEQUI" } });
    fireEvent.change(screen.getByLabelText("Referencia del comprobante"), { target: { value: " REF-77 " } });
    await registerTransfer();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ payload: {
      sale_id: SALE, amount: "1250.000000", provider_code: "NEQUI", provider_reference: "REF-77",
    } }));
    expect(screen.getByTestId("transfer-pending")).toBeTruthy();
  });

  it("reintenta el reporte con la misma clave cuando se pierde la respuesta", async () => {
    await reachSale({
      "payment.register.transfer": registered("IDEMPOTENT"),
      "payment.get": fetched(3),
    });
    const report = vi.spyOn(window.posService, "payment.register.transfer")
      .mockRejectedValueOnce(new Error("response lost"));
    fireEvent.click(screen.getByTestId("register-transfer-button"));
    const retry = await screen.findByTestId("retry-pending-operation");
    expect(screen.queryByTestId("transfer-registered")).toBeNull();
    fireEvent.click(retry);
    await screen.findByTestId("transfer-registered");
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1]).toEqual(report.mock.calls[0]);
  });

  it("desbloquea el reporte si el reintento recibe un duplicado definitivo", async () => {
    await reachSale({});
    const report = vi.spyOn(window.posService, "payment.register.transfer")
      .mockRejectedValueOnce(new Error("respuesta perdida"))
      .mockResolvedValueOnce(rejected("DUPLICATE_TRANSFER_REFERENCE"));
    fireEvent.click(screen.getByTestId("register-transfer-button"));
    fireEvent.click(await screen.findByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(screen.getByTestId("sale-error").textContent).toMatch(/referencia ya fue registrada/));
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
    expect((screen.getByTestId("register-transfer-button") as HTMLButtonElement).disabled).toBe(false);
    expect(report.mock.calls[1]).toEqual(report.mock.calls[0]);
  });

  it("consulta una confirmación externa y solo libera Caja al obtener el comprobante de la venta", async () => {
    const responses = {
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(3),
      "sales.receipt.get": { status: "REJECTED", result_code: "NOT_COMPLETED", result: { outcome: "NOT_COMPLETED" } },
    };
    install({ ...BASE_OVERRIDES, ...responses });
    const readPayment = vi.spyOn(window.posService, "payment.get")
      .mockResolvedValueOnce(fetched(3))
      .mockResolvedValue(fetched(4, "CONFIRMED", "1000.000000", "1000.000000"));
    vi.spyOn(window.posService, "sales.receipt.get")
      .mockResolvedValueOnce(responses["sales.receipt.get"])
      .mockResolvedValue(succeeded({ outcome: "FOUND", sale_id: SALE, payable_amount: "3500.000000" }));

    render(<SalePanel permissions={new Set(["SALES_SALE_CREATE", "PAYMENTS_PAYMENT_READ", "SALES_RECEIPT_READ"])} />);
    await openShift();
    await addProduct();
    await createSale();
    await registerTransfer();

    expect(screen.queryByTestId("confirm-transfer-button")).toBeNull();
    const refresh = screen.getByRole("button", { name: "Actualizar estado de la transferencia" });
    fireEvent.click(refresh);
    await screen.findByTestId("transfer-partial");
    await waitFor(() => expect(screen.getByTestId("payment-remaining").textContent).toBe("2500.000000"));
    fireEvent.click(screen.getByTestId("reset-button"));
    expect(screen.getByTestId("sale-error").textContent).toBe("Completa la venta antes de iniciar otra.");

    fireEvent.click(refresh);
    await screen.findByTestId("transfer-sale-completed");
    expect(screen.getByTestId("transfer-confirmed-coverage").textContent).toBe("3500.000000");
    expect(readPayment).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { payment_id: PAYMENT, include_sale_coverage: true } }));
    expect(calls.has("payment.transfer.confirm")).toBe(false);
    expect(chime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("reset-button"));
    expect(screen.queryByTestId("sale-created")).toBeNull();
  });

  it("registra la transferencia y toma la versión real de payment.get", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(3),
    });
    await registerTransfer();

    const reg = calls.get("payment.register.transfer")![0] as { payload: Record<string, unknown> };
    expect(PaymentRegisterTransferRequestSchema.safeParse(reg).success).toBe(true);
    expect(reg.payload["sale_id"]).toBe(SALE);
    expect(reg.payload["amount"]).toBe("3500.000000");
    // El contrato los admite nulos; la pantalla no inventa datos del comprobante.
    expect(reg.payload["provider_code"]).toBeNull();
    expect(reg.payload["provider_reference"]).toBeNull();

    // payment.get se consulta de verdad: es la única fuente de la versión.
    expect(calls.get("payment.get")).toHaveLength(1);
    expect(screen.getByTestId("transfer-status").textContent).toBe("CREATED");
    expect(screen.getByTestId("transfer-expected-amount").textContent).toBe("3500.000000");
  });

  it("registrar NO es cobrar: no suena, no completa y queda pendiente", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(1),
    });
    await registerTransfer();

    expect(chime).not.toHaveBeenCalled();
    expect(screen.getByTestId("transfer-pending")).toBeTruthy();
    expect(screen.queryByTestId("transfer-sale-completed")).toBeNull();
    expect(calls.get("payment.transfer.confirm")).toBeUndefined();
  });

  it("un registro IDEMPOTENT tampoco suena, y su versión también sale de payment.get", async () => {
    await reachSale({
      "payment.register.transfer": registered("IDEMPOTENT"),
      "payment.get": fetched(9),
    });
    await registerTransfer();

    expect(chime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-transfer-button"));
    await waitFor(() => { expect(calls.get("payment.transfer.confirm")).toHaveLength(1); });
    const conf = calls.get("payment.transfer.confirm")![0] as { payload: Record<string, unknown> };
    // 9, no 1: la versión del pago que ya existía.
    expect(conf.payload["expected_version"]).toBe(9);
  });

  it("confirmar con CONFIRMED y venta completada suena exactamente una vez", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(4),
      "payment.transfer.confirm": confirmed("CONFIRMED", true),
    });
    await registerTransfer();

    fireEvent.click(screen.getByTestId("confirm-transfer-button"));
    await waitFor(() => { expect(screen.getByTestId("transfer-sale-completed")).toBeTruthy(); });

    const conf = calls.get("payment.transfer.confirm")![0] as { payload: Record<string, unknown> };
    expect(PaymentTransferConfirmRequestSchema.safeParse(conf).success).toBe(true);
    expect(conf.payload["payment_id"]).toBe(PAYMENT);
    expect(conf.payload["expected_version"]).toBe(4);
    // La cobertura viene del servicio, no de la pantalla.
    expect(screen.getByTestId("transfer-confirmed-coverage").textContent).toBe("3500.000000");
    expect(chime).toHaveBeenCalledTimes(1);
  });

  it("CONFIRMED sin completar la venta NO suena", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(1),
      "payment.transfer.confirm": confirmed("CONFIRMED", false),
    });
    fireEvent.change(screen.getByLabelText("Importe de la transferencia"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Canal de la transferencia"), { target: { value: "NEQUI" } });
    fireEvent.change(screen.getByLabelText("Referencia del comprobante"), { target: { value: "REP-1" } });
    await registerTransfer();
    expect((screen.getByTestId("register-transfer-button") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("confirm-transfer-button"));
    await waitFor(() => { expect(screen.getByTestId("transfer-partial")).toBeTruthy(); });
    // Cobertura parcial: el dinero entró, la venta no está cobrada.
    expect(chime).not.toHaveBeenCalled();
    expect(screen.queryByTestId("transfer-sale-completed")).toBeNull();
    expect(screen.getByTestId("payment-remaining").textContent).toBe("2500.000000");
    expect((screen.getByLabelText("Referencia del comprobante") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("register-transfer-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("un IDEMPOTENT en la confirmación no vuelve a sonar", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(2),
      "payment.transfer.confirm": confirmed("IDEMPOTENT", true),
    });
    await registerTransfer();

    fireEvent.click(screen.getByTestId("confirm-transfer-button"));
    await waitFor(() => { expect(screen.getByTestId("transfer-sale-completed")).toBeTruthy(); });
    // `sale_completed` es cierto, pero el resultado no es CONFIRMED: `DEC-016`
    // §13.3 impide que un reintento vuelva a sonar.
    expect(chime).not.toHaveBeenCalled();
  });

  it("VERSION_CONFLICT se muestra con su código y no suena", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(1),
      "payment.transfer.confirm": rejected("VERSION_CONFLICT"),
    });
    await registerTransfer();

    fireEvent.click(screen.getByTestId("confirm-transfer-button"));
    await waitFor(() => { expect(screen.getByTestId("sale-error").textContent).toBe("VERSION_CONFLICT"); });
    expect(chime).not.toHaveBeenCalled();
    expect(screen.queryByTestId("transfer-sale-completed")).toBeNull();
  });

  it("PAYMENT_NOT_CONFIRMABLE se muestra con su código y no suena", async () => {
    await reachSale({
      "payment.register.transfer": registered("REGISTERED"),
      "payment.get": fetched(1),
      "payment.transfer.confirm": rejected("PAYMENT_NOT_CONFIRMABLE"),
    });
    await registerTransfer();

    fireEvent.click(screen.getByTestId("confirm-transfer-button"));
    await waitFor(() => {
      expect(screen.getByTestId("sale-error").textContent).toBe("PAYMENT_NOT_CONFIRMABLE");
    });
    expect(chime).not.toHaveBeenCalled();
  });

  it("no hay confirmación posible sin transferencia registrada", async () => {
    await reachSale({});
    expect(screen.queryByTestId("confirm-transfer-button")).toBeNull();
    expect(calls.get("payment.transfer.confirm")).toBeUndefined();
  });
});
