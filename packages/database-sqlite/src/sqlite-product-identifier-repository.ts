import { CompanyScope, ProductIdentifier, type IdentifierType, type ProductIdentifierStatus } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type ProductIdentifierRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface ProductIdentifierRow {
  id: string;
  tenant_id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  presentation_id: string;
  identifier_type: string;
  raw_value: string;
  normalized_value: string;
  status: string;
  version: number;
}

/** B29: real SQLite adapter for `ProductIdentifierRepository` over `MIGRATION_009`. */
export class SqliteProductIdentifierRepository implements ProductIdentifierRepository {
  constructor(private readonly database: LocalDatabase) {}

  async existsByTypeAndNormalizedValue(scope: CompanyScope, identifierType: IdentifierType, normalizedValue: string): Promise<boolean> {
    const row = this.database.native
      .prepare(`SELECT 1 FROM catalog_product_identifiers WHERE tenant_id = ? AND company_id = ? AND identifier_type = ? AND normalized_value = ?`)
      .get(scope.tenantId, scope.companyId, identifierType, normalizedValue);
    return row !== undefined;
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductIdentifier | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_product_identifiers WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, idempotencyKey) as ProductIdentifierRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async save(identifier: ProductIdentifier, idempotencyKey: string): Promise<void> {
    try {
      this.database.native
        .prepare(
          `INSERT INTO catalog_product_identifiers (
            id, tenant_id, company_id, product_id, variant_id, presentation_id, identifier_type,
            raw_value, normalized_value, status, version, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          identifier.id, identifier.scope.tenantId, identifier.scope.companyId, identifier.productId,
          identifier.variantId, identifier.presentationId, identifier.identifierType, identifier.rawValue,
          identifier.normalizedValue, identifier.status, identifier.version, idempotencyKey, new Date().toISOString(),
        );
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${identifier.scope.tenantId}`);
      }
      if (isUniqueConstraintViolation(error, "normalized_value")) {
        throw new CatalogDuplicateConflictError(`identifier ${identifier.identifierType}:${identifier.normalizedValue} already exists for tenant ${identifier.scope.tenantId}, company ${identifier.scope.companyId}`);
      }
      throw error;
    }
  }

  private toDomain(row: ProductIdentifierRow): ProductIdentifier {
    return ProductIdentifier.restore({
      id: row.id,
      scope: new CompanyScope(row.tenant_id, row.company_id),
      productId: row.product_id,
      variantId: row.variant_id,
      presentationId: row.presentation_id,
      identifierType: row.identifier_type as IdentifierType,
      rawValue: row.raw_value,
      normalizedValue: row.normalized_value,
      status: row.status as ProductIdentifierStatus,
      version: row.version,
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
