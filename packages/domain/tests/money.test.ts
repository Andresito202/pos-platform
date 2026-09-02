import { describe, expect, it } from "vitest";
import { Money } from "../src/index.js";

describe("Money", () => {
  it("normalizes to a canonical 6-decimal string", () => {
    expect(Money.fromString("100").toString()).toBe("100.000000");
    expect(Money.fromString("100.5").toString()).toBe("100.500000");
    expect(Money.fromString("0").toString()).toBe(Money.zero().toString());
  });

  it("rejects non-decimal input instead of silently truncating", () => {
    expect(() => Money.fromString("abc")).toThrow(TypeError);
    expect(() => Money.fromString("1.2345678")).toThrow(TypeError);
    expect(() => Money.fromString("1e10")).toThrow(TypeError);
  });

  it("distinguishes non-negative from negative", () => {
    expect(Money.fromString("0").isNonNegative()).toBe(true);
    expect(Money.fromString("50").isNonNegative()).toBe(true);
    expect(Money.fromString("-1").isNonNegative()).toBe(false);
  });

  it("compares by canonical value, not by input formatting", () => {
    expect(Money.fromString("10").equals(Money.fromString("10.0"))).toBe(true);
    expect(Money.fromString("10").equals(Money.fromString("10.01"))).toBe(false);
  });

  it("distinguishes positive from non-negative (zero is not positive)", () => {
    expect(Money.zero().isPositive()).toBe(false);
    expect(Money.fromString("0.000001").isPositive()).toBe(true);
  });

  it("orders by isGreaterThan", () => {
    expect(Money.fromString("10").isGreaterThan(Money.fromString("9.999999"))).toBe(true);
    expect(Money.fromString("10").isGreaterThan(Money.fromString("10"))).toBe(false);
  });

  it("adds and subtracts exactly, never via floating point", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754 — this must not leak into Money.
    expect(Money.fromString("0.1").add(Money.fromString("0.2")).toString()).toBe("0.300000");
    expect(Money.fromString("100").subtract(Money.fromString("40")).toString()).toBe("60.000000");
    expect(Money.fromString("10").subtract(Money.fromString("15")).toString()).toBe("-5.000000");
  });

  it("subtract can produce a negative result for difference calculations (counted - expected)", () => {
    const difference = Money.fromString("190000").subtract(Money.fromString("200000"));
    expect(difference.isNonNegative()).toBe(false);
    expect(difference.toString()).toBe("-10000.000000");
  });
});
