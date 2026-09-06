import type { VariantAttributes } from "@pos-platform/domain";

/**
 * B26 HD-06 / B27: the exact canonicalization algorithm (case sensitivity,
 * Unicode normalization, attribute ordering, whitespace handling) is not
 * specified anywhere in this repository — DEC-004/UC-CAT-004 require
 * order-independence ("el orden de los atributos no debe crear variantes
 * duplicadas") but never define HOW. No production implementation of this
 * port exists in this package; `CreateVariantUseCase` depends on it as an
 * extension point so ProductVariant's uniqueness check never hardcodes an
 * invented algorithm. Tests use a fake implementation, same posture as
 * `CatalogAuthorizationPort` having no real actor to authorize yet.
 */
export interface VariantCanonicalKeyPolicy {
  canonicalize(attributes: VariantAttributes): string;
}
