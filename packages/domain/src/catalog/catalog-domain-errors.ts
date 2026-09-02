export type CatalogDomainErrorCode = "EMPTY_PRODUCT_NAME" | "EXPIRATION_REQUIRES_LOT_CONTROL";

export class CatalogDomainError extends Error {
  constructor(readonly code: CatalogDomainErrorCode, message: string) {
    super(message);
    this.name = "CatalogDomainError";
  }
}
