import type { CompanyScope, ProductPresentation } from "@pos-platform/domain";

/** Bloque 27. No SQLite/PostgreSQL adapter implements this — same DDL-gate posture as ProductRepository. */
export interface ProductPresentationRepository {
  /** SKU uniqueness check (DEC-004: SKU is unique per `company_id` while active) — skipped when `sku` is null, since a null SKU never conflicts. */
  existsBySku(scope: CompanyScope, sku: string): Promise<boolean>;
  findById(scope: CompanyScope, presentationId: string): Promise<ProductPresentation | null>;
  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductPresentation | null>;
  save(presentation: ProductPresentation, idempotencyKey: string): Promise<void>;
}
