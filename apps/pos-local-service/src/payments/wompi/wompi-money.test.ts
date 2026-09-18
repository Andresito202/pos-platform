import { describe, expect, it } from "vitest";
import { amountToCents, centsToAmount } from "./wompi-money.js";

describe("Wompi money conversion", () => {
  it("converts scale-6 COP money to exact centavos", () => {
    expect(amountToCents("24900.000000")).toBe("2490000");
    expect(amountToCents("0.000000")).toBe("0");
    expect(amountToCents("1")).toBe("100");
  });

  it("rejects sub-cent precision instead of rounding", () => {
    expect(() => amountToCents("100.001000")).toThrow("precision below one COP cent");
  });

  it("rejects malformed amounts", () => {
    expect(() => amountToCents("-1")).toThrow("non-negative decimal");
    expect(() => amountToCents("abc")).toThrow("non-negative decimal");
  });

  it("is the exact inverse of amountToCents for whole-centavo amounts", () => {
    expect(centsToAmount(2490000)).toBe("24900.000000");
    expect(centsToAmount(0)).toBe("0.000000");
    expect(centsToAmount(1)).toBe("0.010000");
    expect(centsToAmount(100)).toBe("1.000000");
  });

  it("rejects malformed cents values", () => {
    expect(() => centsToAmount(-1)).toThrow("non-negative integer");
    expect(() => centsToAmount(1.5)).toThrow("non-negative integer");
  });
});
