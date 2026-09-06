import { CompanyScope, ProductIdentifier, type IdentifierType, type ProductIdentifierStatus } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type ProductIdentifierRepository } from "@pos-platform/application";
import type { PostgresDatabase } from "./postgres-database.js";

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
  version: string;
}

/** B29: real PostgreSQL adapter for `ProductIdentifierRepository` over `catalog.product_identifiers`. */
export class PostgresProductIdentifierRepository implements ProductIdentifierRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async existsByTypeAndNormalizedValue(scope: CompanyScope, identifierType: IdentifierType, normalizedValue: string): Promise<boolean> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM catalog.product_identifiers WHERE tenant_id = $1 AND company_id = $2 AND identifier_type = $3 AND normalized_value = $4`,
        [scope.tenantId, scope.companyId, identifierType, normalizedValue],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductIdentifier | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductIdentifierRow>(
        `SELECT * FROM catalog.product_identifiers WHERE tenant_id = $1 AND company_id = $2 AND idempotency_key = $3`,
        [scope.tenantId, scope.companyId, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async save(identifier: ProductIdentifier, idempotencyKey: string): Promise<void> {
    try {
      await this.database.withTenantTransaction(identifier.scope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.product_identifiers (
            id, tenant_id, company_id, product_id, variant_id, presentation_id, identifier_type,
            raw_value, normalized_value, status, version, idempotency_key
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            identifier.id, identifier.scope.tenantId, identifier.scope.companyId, identifier.productId,
            identifier.variantId, identifier.presentationId, identifier.identifierType, identifier.rawValue,
            identifier.normalizedValue, identifier.status, identifier.version, idempotencyKey,
          ],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, "catalog_product_identifiers_idempotency_uq")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${identifier.scope.tenantId}`);
      }
      if (isUniqueViolation(error, "catalog_product_identifiers_natural_uq")) {
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
      version: Number(row.version),
    });
  }
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === constraintName;
}
