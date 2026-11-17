import { describe, expect, it } from "vitest";
import { factusPayAmountToScale6, scale6ToFactusPayAmount } from "../src/payments/factus-pay-amount.js";

describe("factus pay amount conversion", () => {
  it("strips fractional zeros for whole pesos", () => {
    expect(scale6ToFactusPayAmount("150000.000000")).toBe("150000");
  });

  it("keeps up to two decimal pesos", () => {
    expect(scale6ToFactusPayAmount("150000.500000")).toBe("150000.50");
  });

  it("rejects sub-cent precision", () => {
    expect(() => scale6ToFactusPayAmount("150000.001000")).toThrow("FACTUS_PAY_AMOUNT_PRECISION");
  });

  it("round-trips provider amounts", () => {
    expect(factusPayAmountToScale6("150000.50")).toBe("150000.500000");
  });
});