import { CatalogDomainError } from "./catalog-domain-errors.js";

/**
 * Raw, validated attribute set of a ProductVariant (e.g. `{ color: "azul",
 * talla: "M" }`) — DEC-004 "Atributos de variante". This is the structural
 * validation only (non-empty set, non-empty keys/values, no accidental
 * mutation): it deliberately does NOT canonicalize or order the attributes.
 * Canonicalization (case, Unicode, whitespace, key order) is B26 HD-06 —
 * unspecified anywhere in this repository — and lives behind
 * `VariantCanonicalKeyPolicy` (packages/application/src/ports), a
 * replaceable extension point, not here.
 */
export class VariantAttributes {
  private constructor(private readonly entries: ReadonlyMap<string, string>) {}

  static fromRecord(record: Readonly<Record<string, string>>): VariantAttributes {
    const entries = new Map<string, string>();
    for (const [key, value] of Object.entries(record)) {
      if (!key.trim()) {
        throw new CatalogDomainError("EMPTY_VARIANT_ATTRIBUTE_KEY", "variant attribute key must not be empty");
      }
      if (!value.trim()) {
        throw new CatalogDomainError("EMPTY_VARIANT_ATTRIBUTE_VALUE", `variant attribute "${key}" must not have an empty value`);
      }
      entries.set(key, value);
    }
    if (entries.size === 0) {
      throw new CatalogDomainError("EMPTY_VARIANT_ATTRIBUTES", "a variant requires at least one attribute");
    }
    return new VariantAttributes(entries);
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }

  equals(other: VariantAttributes): boolean {
    if (this.entries.size !== other.entries.size) return false;
    for (const [key, value] of this.entries) {
      if (other.entries.get(key) !== value) return false;
    }
    return true;
  }
}
