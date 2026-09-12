import { describe, it, expect } from "vitest";
import { shouldPlayChime } from "../../renderer/src/confirmation-sound.js";

/**
 * La regla de `DEC-016` §13.2 y §13.3 aislada del sonido: es la única decisión,
 * y siendo pura se puede comprobar exhaustivamente.
 */
describe("shouldPlayChime — CHA-CHING = SALE_COMPLETED ONLY", () => {
  it("suena cuando la venta quedó cobrada y la transición fue real", () => {
    expect(shouldPlayChime({ outcome: "CONFIRMED", sale_completed: true })).toBe(true);
  });

  it("no suena en un pago parcial: el pago se confirmó, la venta no", () => {
    expect(shouldPlayChime({ outcome: "CONFIRMED", sale_completed: false })).toBe(false);
  });

  it("no suena en un reintento idempotente aunque la venta esté cobrada (§13.3)", () => {
    expect(shouldPlayChime({ outcome: "IDEMPOTENT", sale_completed: true })).toBe(false);
  });

  it("no suena en un rechazo", () => {
    for (const outcome of [
      "CASH_SHIFT_MISSING", "CASH_SHIFT_NOT_OPEN", "INSUFFICIENT_TENDER",
      "OVERPAYMENT_NOT_ALLOWED", "SALE_ALREADY_COMPLETED", "INSUFFICIENT_STOCK",
    ]) {
      expect(shouldPlayChime({ outcome, sale_completed: false })).toBe(false);
    }
  });

  it("no suena sin resultado", () => {
    expect(shouldPlayChime(null)).toBe(false);
  });
});
