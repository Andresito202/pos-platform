const DECIMAL_PATTERN = /^-?\d+(\.\d{1,6})?$/;

/**
 * Exact decimal physical quantity (units, weight, volume), stored as a
 * canonical string — never a JS number. physical-conventions.md's row
 * "cantidad, peso y unidad convertible" fixes the SAME (19,6) precision as
 * money, but as a distinct documented concept — this is a separate type
 * from Money, not a reuse of it, so a quantity of "5.5 kg" is never
 * confused with a currency amount.
 */
export class Quantity {
  private constructor(private readonly canonical: string) {}

  static fromString(value: string): Quantity {
    if (!DECIMAL_PATTERN.test(value)) {
      throw new TypeError(`invalid decimal quantity: ${value}`);
    }
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const canonical = `${value.startsWith("-") ? "-" : ""}${whole}.${fraction.padEnd(6, "0")}`;
    return new Quantity(canonical);
  }

  static zero(): Quantity {
    return new Quantity("0.000000");
  }

  isPositive(): boolean {
    return !this.canonical.startsWith("-") && !this.equals(Quantity.zero());
  }

  equals(other: Quantity): boolean {
    return this.canonical === other.canonical;
  }

  /** Exact addition via scaled BigInt — never floating point. */
  add(other: Quantity): Quantity {
    return Quantity.fromScaled(this.scaled() + other.scaled());
  }

  /** Exact subtraction via scaled BigInt — never floating point. */
  subtract(other: Quantity): Quantity {
    return Quantity.fromScaled(this.scaled() - other.scaled());
  }

  toString(): string {
    return this.canonical;
  }

  private scaled(): bigint {
    const negative = this.canonical.startsWith("-");
    const [whole = "0", fraction = "0"] = this.canonical.replace("-", "").split(".");
    const value = BigInt(whole) * 1_000_000n + BigInt(fraction);
    return negative ? -value : value;
  }

  private static fromScaled(scaled: bigint): Quantity {
    const negative = scaled < 0n;
    const absolute = negative ? -scaled : scaled;
    const whole = absolute / 1_000_000n;
    const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
    return new Quantity(`${negative && absolute !== 0n ? "-" : ""}${whole}.${fraction}`);
  }
}
