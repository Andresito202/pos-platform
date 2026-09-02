import { describe, expect, it } from "vitest";
import { Quantity } from "../src/index.js";

describe("Quantity", () => {
  it("normalizes to a canonical 6-decimal string", () => {
    expect(Quantity.fromString("100").toString()).toBe("100.000000");
    expect(Quantity.fromString("2.5").toString()).toBe("2.500000");
    expect(Quantity.fromString("0").toString()).toBe(Quantity.zero().toString());
  });

  it("rejects non-decimal input instead of silently truncating", () => {
    expect(() => Quantity.fromString("abc")).toThrow(TypeError);
    expect(() => Quantity.fromString("1.2345678")).toThrow(TypeError);
    expect(() => Quantity.fromString("1e10")).toThrow(TypeError);
  });

  it("compares by canonical value, not by input formatting", () => {
    expect(Quantity.fromString("10").equals(Quantity.fromString("10.0"))).toBe(true);
    expect(Quantity.fromString("10").equals(Quantity.fromString("10.01"))).toBe(false);
  });

  it("distinguishes positive from non-positive (zero is not positive)", () => {
    expect(Quantity.zero().isPositive()).toBe(false);
    expect(Quantity.fromString("-1").isPositive()).toBe(false);
    expect(Quantity.fromString("0.000001").isPositive()).toBe(true);
  });

  it("adds and subtracts exactly, never via floating point", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754 — this must not leak into Quantity.
    expect(Quantity.fromString("0.1").add(Quantity.fromString("0.2")).toString()).toBe("0.300000");
    expect(Quantity.fromString("10").subtract(Quantity.fromString("4")).toString()).toBe("6.000000");
  });

  it("subtract can produce a negative result (OUT movements folding past zero)", () => {
    const result = Quantity.fromString("3").subtract(Quantity.fromString("10"));
    expect(result.isPositive()).toBe(false);
    expect(result.toString()).toBe("-7.000000");
  });
});
