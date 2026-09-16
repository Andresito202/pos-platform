// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PaymentRegisterCashRequestSchema } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { SalePanel } from "../../renderer/src/components/SalePanel.js";

const REGISTER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const PRESENTATION = "33333333-3333-4333-8333-333333333333";
const SHIFT = "44444444-4444-4444-8444-444444444444";
const SALE = "55555555-5555-4555-8555-555555555555";
const PAYMENT = "66666666-6666-4666-8666-666666666666";

const calls = new Map<string, unknown[]>();
const chime = vi.hoisted(() => vi.fn());

vi.mock("../../renderer/src/confirmation-sound.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../renderer/src/confirmation-sound.js")>();
  return { ...actual, playConfirmationChime: chime };
});

function succeeded(result: unknown) {
  return { status: "SUCCEEDED", result_code: "OK", result };
}

function install(): void {
  const overrides: Record<string, unknown> = {
    "cash.shift.open": succeeded({ outcome: "OPENED", shift_id: SHIFT, version: 1 }),
    "catalog.item.find": succeeded({
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
    }),
    "sale.create": succeeded({
      outcome: "CREATED",
      sale_id: SALE,
      sale_number: 1,
      payable_amount: "3500.000000",
      calculation_checksum: "a".repeat(64),
    }),
    "payment.register.cash": succeeded({
      outcome: "CONFIRMED",
      payment_id: PAYMENT,
      sale_completed: true,
      confirmed_coverage: "3500.000000",
      payable_amount: "3500.000000",
      change_amount: "16500.000000",
    }),
  };

  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      return Promise.resolve(overrides[method] ?? succeeded(null));
    };
  }
  Object.defineProperty(window, "posService", {
    value: service,
    writable: true,
    configurable: true,
  });
}

async function prepareSale(): Promise<void> {
  fireEvent.change(screen.getByTestId("cash-register-input"), { target: { value: REGISTER } });
  fireEvent.click(screen.getByTestId("open-shift-button"));
  await screen.findByTestId("shift-open");

  fireEvent.change(screen.getByTestId("barcode-input"), { target: { value: "7701234567890" } });
  fireEvent.click(screen.getByTestId("find-item-button"));
  await screen.findByTestId("found-item");
  fireEvent.click(screen.getByTestId("add-item-button"));
  await screen.findByTestId("cart-line");

  fireEvent.click(screen.getByTestId("create-sale-button"));
  await screen.findByTestId("sale-created");
}

beforeEach(() => {
  calls.clear();
  chime.mockClear();
});

describe("SalePanel — efectivo recibido", () => {
  it("envía el efectivo recibido y muestra el vuelto calculado por el servicio", async () => {
    install();
    render(<SalePanel />);
    await prepareSale();

    fireEvent.change(screen.getByTestId("cash-tendered-input"), { target: { value: "20000" } });
    fireEvent.click(screen.getByTestId("charge-cash-button"));
    await screen.findByTestId("sale-completed");

    const request = calls.get("payment.register.cash")![0] as { payload: Record<string, unknown> };
    expect(request.payload["amount"]).toBe("3500.000000");
    expect(request.payload["tendered_amount"]).toBe("20000.000000");
    expect(() => PaymentRegisterCashRequestSchema.parse(request)).not.toThrow();
    expect(screen.getByTestId("sale-completed").textContent).toContain("16500.000000");
    expect(chime).toHaveBeenCalledTimes(1);
  });
});
