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
});
