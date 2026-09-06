const DECIMAL_PATTERN = /^-?\d+(\.\d{1,10})?$/;

/**
 * Exact decimal conversion factor, stored as a canonical string — never a
 * JS number. `catalog.unit_conversions.conversion_factor` is fixed at
 * `numeric(19,10)` (catalog-schema.md), a DIFFERENT precision than Money/
 * Quantity's `(19,6)` — reusing either would silently truncate a valid
 * 10-decimal factor, so this mirrors their proven canonical-string/BigInt
 * pattern at the precision the physical model actually documents, rather
 * than force-fitting an existing type at the wrong scale.
 */
export class ConversionFactor {
  private constructor(private readonly canonical: string) {}

  static fromString(value: string): ConversionFactor {
    if (!DECIMAL_PATTERN.test(value)) {
      throw new TypeError(`invalid decimal conversion factor: ${value}`);
    }
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const canonical = `${value.startsWith("-") ? "-" : ""}${whole}.${fraction.padEnd(10, "0")}`;
    return new ConversionFactor(canonical);
  }

  isPositive(): boolean {
    return !this.canonical.startsWith("-") && !this.equals(ConversionFactor.fromString("0"));
  }

  equals(other: ConversionFactor): boolean {
    return this.canonical === other.canonical;
  }

  toString(): string {
    return this.canonical;
  }
}
