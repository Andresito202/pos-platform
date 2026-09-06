import type { CompanyScope, Product } from "@pos-platform/domain";

/**
 * Bloque 27 (Catalog domain/application design): extended beyond
 * CreateProduct's original two lookups. Kept as ONE repository, not split
 * by operation: Product is the single aggregate every method here reads or
 * writes, no child entities cross a transactional boundary the way Cash's
 * shift+count+review does — so, unlike CashShiftRepository, one generic
 * `save`-per-operation shape is enough without a bespoke physical-context
 * parameter for each (no adapter exists yet to need one). No SQLite/
 * PostgreSQL adapter implements this — Catalog's own physical model
 * (catalog-schema.md) is still `IN_REVIEW`, and the DDL gate is NO-GO for
 * every commercial domain regardless.
 */
export interface ProductRepository {
  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null>;
  existsByInternalCode(scope: CompanyScope, internalCode: string): Promise<boolean>;
  save(product: Product, idempotencyKey: string): Promise<void>;

  /** Loads regardless of status — callers (UpdateProduct/DeactivateProduct/CreateVariant/CreatePresentation/AssignIdentifier) check `.status` themselves. */
  findById(scope: CompanyScope, productId: string): Promise<Product | null>;

  /** Idempotent-replay lookup for UPDATE — a distinct namespace from CREATE's key, per UC-CAT-002's own separate `idempotency_key`. */
  findUpdateByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null>;
  saveUpdate(product: Product, idempotencyKey: string): Promise<void>;

  /** Idempotent-replay lookup for DEACTIVATE — a distinct namespace from both CREATE and UPDATE. */
  findDeactivationByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null>;
  saveDeactivation(product: Product, idempotencyKey: string): Promise<void>;
}
