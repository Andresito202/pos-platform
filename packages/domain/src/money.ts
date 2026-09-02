const DECIMAL_PATTERN = /^-?\d+(\.\d{1,6})?$/;

/**
 * Exact decimal money value, stored as a canonical string — never a JS
 * number. physical-conventions.md fixes monetary precision at (19,6) and
 * forbids `number`/`REAL` for authoritative amounts; this type is the
 * domain-side guarantee of that invariant, independent of any storage engine.
 */
export class Money {
  private constructor(private readonly canonical: string) {}

  static fromString(value: string): Money {
    if (!DECIMAL_PATTERN.test(value)) {
      throw new TypeError(`invalid decimal amount: ${value}`);
    }
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const canonical = `${value.startsWith("-") ? "-" : ""}${whole}.${fraction.padEnd(6, "0")}`;
    return new Money(canonical);
  }

  static zero(): Money {
    return new Money("0.000000");
  }

  isNonNegative(): boolean {
    return !this.canonical.startsWith("-");
  }

  isPositive(): boolean {
    return this.isNonNegative() && !this.equals(Money.zero());
  }

  isGreaterThan(other: Money): boolean {
    return this.scaled() > other.scaled();
  }

  equals(other: Money): boolean {
    return this.canonical === other.canonical;
  }

  /** Exact addition via scaled BigInt — never floating point. */
  add(other: Money): Money {
    return Money.fromScaled(this.scaled() + other.scaled());
  }

  /** Exact subtraction via scaled BigInt — never floating point. */
  subtract(other: Money): Money {
    return Money.fromScaled(this.scaled() - other.scaled());
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

  private static fromScaled(scaled: bigint): Money {
    const negative = scaled < 0n;
    const absolute = negative ? -scaled : scaled;
    const whole = absolute / 1_000_000n;
    const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
    return new Money(`${negative && absolute !== 0n ? "-" : ""}${whole}.${fraction}`);
  }
}
