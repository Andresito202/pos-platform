import type { CompanyScope, IdentifierType, ProductIdentifier } from "@pos-platform/domain";

/** Bloque 27. No SQLite/PostgreSQL adapter implements this — same DDL-gate posture as ProductRepository. */
export interface ProductIdentifierRepository {
  /** UC-CAT-003 rule 1: "un identificador activo no puede resolver a dos artículos vendibles dentro de la misma empresa" — `catalog.product_identifiers` unique scope is `(identifier_type, normalized_value)` per company. */
  existsByTypeAndNormalizedValue(scope: CompanyScope, identifierType: IdentifierType, normalizedValue: string): Promise<boolean>;
  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductIdentifier | null>;
  save(identifier: ProductIdentifier, idempotencyKey: string): Promise<void>;
}
