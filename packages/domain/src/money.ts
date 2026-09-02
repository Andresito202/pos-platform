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

  equals(other: Money): boolean {
    return this.canonical === other.canonical;
  }

  toString(): string {
    return this.canonical;
  }
}
