import type { IdentifierType } from "@pos-platform/domain";

/**
 * B27 finding: UC-CAT-003 says "el sistema normaliza el valor según el
 * tipo" and "valida... dígito de control o formato cuando aplique", but
 * never specifies the algorithm per `IdentifierType` (EAN/UPC check-digit
 * rules, case folding). Same treatment as `VariantCanonicalKeyPolicy` — a
 * replaceable extension point, no invented algorithm, no production
 * implementation shipped here.
 */
export interface IdentifierNormalizationPolicy {
  normalize(identifierType: IdentifierType, rawValue: string): string;
}
