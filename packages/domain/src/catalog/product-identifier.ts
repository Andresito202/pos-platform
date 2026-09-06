import type { CompanyScope } from "../company-scope.js";
import { CatalogDomainError } from "./catalog-domain-errors.js";

/** UC-CAT-003 "Tipos iniciales" — closed 9-value set, transcribed verbatim. */
export type IdentifierType = "INTERNAL" | "EAN_8" | "EAN_13" | "UPC" | "PLU" | "SUPPLIER_CODE" | "SCALE_BARCODE" | "INTERNAL_QR" | "MANUAL_CODE";

export interface AssignProductIdentifierInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly variantId: string | null;
  /**
   * Required, not optional — catalog-schema.md's `product_identifiers.
   * presentation_id` carries no `NULL` annotation (unlike `variant_id
   * NULL`), unlike DEC-004's conceptual allowance for Product/Variant-level
   * informational identifiers. This is a real desync between the two
   * sources (registered in the B27 report as a CONTRADICTION, not silently
   * picked); this class follows catalog-schema.md and B27's own instruction
   * ("Identifier -> Presentation, NOT Identifier -> Product") since barcode
   * != SKU and every operational code must resolve to a presentation.
   */
  readonly presentationId: string;
  readonly identifierType: IdentifierType;
  readonly rawValue: string;
  /**
   * Computed by `IdentifierNormalizationPolicy` (application layer) before
   * this factory runs — same externalization as ProductVariant's
   * `canonicalKey`. UC-CAT-003 says "el sistema normaliza el valor según el
   * tipo" but never specifies the algorithm (checksum rules, case folding)
   * per type; not invented here.
   */
  readonly normalizedValue: string;
}

export interface RestoreProductIdentifierInput {
  readonly id: string;
  readonly scope: CompanyScope;
  readonly productId: string;
  readonly variantId: string | null;
  readonly presentationId: string;
  readonly identifierType: IdentifierType;
  readonly rawValue: string;
  readonly normalizedValue: string;
  readonly status: ProductIdentifierStatus;
  readonly version: number;
}

/** `catalog.product_identifiers.status`: closed 2-value set (ACTIVE/INACTIVE, per catalog-schema.md). */
export type ProductIdentifierStatus = "ACTIVE" | "INACTIVE";

/**
 * ProductIdentifier — barcode/SKU-adjacent commercial identifier, distinct
 * from `ProductPresentation.internalSku` (DEC-004: "barcode != SKU", the
 * two never merge). Always resolves to a Presentation.
 *
 * `valid_from`/`valid_until` (catalog-schema.md columns; UC-CAT-003 lists
 * `valid_from opcional` in its Entrada) are not modeled here — UC-CAT-003
 * never describes when/why an identifier's validity window would be set or
 * checked, so no time-boxing behavior is invented. Registered as a
 * remaining gap.
 */
export class ProductIdentifier {
  private constructor(
    readonly id: string,
    readonly scope: CompanyScope,
    readonly productId: string,
    readonly variantId: string | null,
    readonly presentationId: string,
    readonly identifierType: IdentifierType,
    readonly rawValue: string,
    readonly normalizedValue: string,
    readonly status: ProductIdentifierStatus,
    readonly version: number,
  ) {}

  static assign(input: AssignProductIdentifierInput): ProductIdentifier {
    if (!input.rawValue.trim()) {
      throw new CatalogDomainError("EMPTY_IDENTIFIER_VALUE", "identifier raw value must not be empty");
    }
    if (!input.normalizedValue.trim()) {
      throw new CatalogDomainError("EMPTY_IDENTIFIER_VALUE", "identifier normalized value must not be empty");
    }
    return new ProductIdentifier(
      input.id, input.scope, input.productId, input.variantId, input.presentationId,
      input.identifierType, input.rawValue, input.normalizedValue, "ACTIVE", 1,
    );
  }

  /** B29: reconstructs a ProductIdentifier from an already-persisted row — same posture as `Product.restore()`. */
  static restore(input: RestoreProductIdentifierInput): ProductIdentifier {
    return new ProductIdentifier(
      input.id, input.scope, input.productId, input.variantId, input.presentationId,
      input.identifierType, input.rawValue, input.normalizedValue, input.status, input.version,
    );
  }
}
