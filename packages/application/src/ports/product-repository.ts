import type { CompanyScope, Product } from "@pos-platform/domain";

/**
 * Only what CreateProductUseCase needs: the idempotency-replay lookup
 * (UC-CAT-001 "Solicitud repetida") and the internal-code uniqueness
 * check (UC-CAT-001 "Código interno existente"). No SQLite/PostgreSQL
 * adapter implements this — Catalog's own physical model
 * (catalog-schema.md) is still `IN_REVIEW`, and the DDL gate is NO-GO
 * for every commercial domain regardless.
 */
export interface ProductRepository {
  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null>;
  existsByInternalCode(scope: CompanyScope, internalCode: string): Promise<boolean>;
  save(product: Product, idempotencyKey: string): Promise<void>;
}
