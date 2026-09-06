import type { CompanyScope, ProductVariant } from "@pos-platform/domain";

/**
 * Bloque 27. No SQLite/PostgreSQL adapter implements this — same DDL-gate
 * posture as ProductRepository.
 */
export interface ProductVariantRepository {
  /** Duplicate-combination detection (UC-CAT-004 rule 1/DEC-004 escenario 3) — SQL-free: the physical UNIQUE constraint is a later concern. */
  findByProductAndCanonicalKey(scope: CompanyScope, productId: string, canonicalKey: string): Promise<ProductVariant | null>;
  /** Used by CreatePresentation to validate the optional `variantId` it receives and check `variant.productId === presentation.productId` (DEC-004). */
  findById(scope: CompanyScope, variantId: string): Promise<ProductVariant | null>;
  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductVariant | null>;
  save(variant: ProductVariant, idempotencyKey: string): Promise<void>;
}
