/**
 * B29 (Catalog persistence). Two concurrent requests can both pass a
 * use case's pre-check (idempotency lookup, canonical-key/SKU/identifier
 * uniqueness check) before either commits — the same physical race
 * `IdempotencyKeyConflictError`/`IncompatibleShiftOpenConflictError`
 * already handle for Cash. `IdempotencyKeyConflictError` (defined
 * alongside `CashShiftRepository`) is reused as-is for Catalog's own
 * same-key races — it was never Cash-specific in content. This file adds
 * the one Catalog needs that Cash's vocabulary does not cover: a
 * concurrent race on a BUSINESS uniqueness constraint (canonical key, SKU,
 * identifier, provider reference) rather than an idempotency key.
 */
export class CatalogDuplicateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogDuplicateConflictError";
  }
}

/**
 * The optimistic-version race for Product's `update`/`deactivate` — two
 * concurrent writers both read version N, only one `UPDATE ... WHERE
 * version = N` can succeed. Same shape as `CashMovementConflictError`/
 * `CashCloseConflictError`.
 */
export class ProductConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductConflictError";
  }
}
