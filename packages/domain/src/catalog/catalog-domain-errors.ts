/**
 * Codes prefixed `CATALOG_` are transcribed verbatim from DEC-004's own
 * "Errores funcionales" registry (docs/adr/DEC-004-product-variant-
 * presentation-model.md) — that section is the closed, authoritative name
 * for each cross-entity/relationship error, so this file reuses those exact
 * strings instead of inventing parallel names. Unprefixed codes are local
 * extensions for checks DEC-004's registry does not cover (field-level
 * validation, version conflicts) — same posture CashDomainError already
 * uses for its own non-registry codes (e.g. `SHIFT_NOT_OPEN`).
 */
export type CatalogDomainErrorCode =
  | "EMPTY_PRODUCT_NAME"
  | "EXPIRATION_REQUIRES_LOT_CONTROL"
  | "PRODUCT_VERSION_CONFLICT"
  | "PRODUCT_ALREADY_INACTIVE"
  | "EMPTY_VARIANT_ATTRIBUTES"
  | "EMPTY_VARIANT_ATTRIBUTE_KEY"
  | "EMPTY_VARIANT_ATTRIBUTE_VALUE"
  | "VARIANT_VERSION_CONFLICT"
  | "EMPTY_PRESENTATION_NAME"
  | "NON_POSITIVE_CONTAINED_QUANTITY"
  | "PRESENTATION_NO_CAPABILITY"
  | "PRESENTATION_VERSION_CONFLICT"
  | "EMPTY_IDENTIFIER_VALUE"
  | "CONVERSION_SAME_PRESENTATION"
  | "CATALOG_PRODUCT_NOT_FOUND"
  | "CATALOG_PRODUCT_INACTIVE"
  | "CATALOG_VARIANT_NOT_ALLOWED"
  | "CATALOG_VARIANT_REQUIRED"
  | "CATALOG_VARIANT_DUPLICATE"
  | "CATALOG_VARIANT_PRODUCT_MISMATCH"
  | "CATALOG_PRESENTATION_REQUIRED"
  | "CATALOG_PRESENTATION_DUPLICATE"
  | "CATALOG_PRESENTATION_PRODUCT_MISMATCH"
  | "CATALOG_PRESENTATION_VARIANT_MISMATCH"
  | "CATALOG_PRESENTATION_INACTIVE"
  | "CATALOG_PRESENTATION_NOT_SELLABLE"
  | "CATALOG_PRESENTATION_NOT_PURCHASABLE"
  | "CATALOG_SKU_DUPLICATE"
  | "CATALOG_IDENTIFIER_DUPLICATE"
  | "CATALOG_IDENTIFIER_AMBIGUOUS"
  | "CATALOG_UNIT_INCOMPATIBLE"
  | "CATALOG_CONVERSION_FACTOR_INVALID"
  | "CATALOG_CONVERSION_CYCLE"
  | "CATALOG_CONVERSION_PRODUCT_MISMATCH"
  | "CATALOG_CONVERSION_VARIANT_MISMATCH"
  | "CATALOG_STOCK_MODE_INVALID";

export class CatalogDomainError extends Error {
  constructor(readonly code: CatalogDomainErrorCode, message: string) {
    super(message);
    this.name = "CatalogDomainError";
  }
}
