import { CompanyScope, ProductVariant, VariantAttributes, type ProductVariantStatus } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type ProductVariantRepository } from "@pos-platform/application";
import type { PostgresDatabase } from "./postgres-database.js";

interface ProductVariantRow {
  id: string;
  tenant_id: string;
  company_id: string;
  product_id: string;
  attributes_json: Record<string, string>;
  canonical_key: string;
  status: string;
  version: string;
}

/** B29: real PostgreSQL adapter for `ProductVariantRepository` over `catalog.product_variants`. */
export class PostgresProductVariantRepository implements ProductVariantRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByProductAndCanonicalKey(scope: CompanyScope, productId: string, canonicalKey: string): Promise<ProductVariant | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductVariantRow>(
        `SELECT * FROM catalog.product_variants WHERE tenant_id = $1 AND company_id = $2 AND product_id = $3 AND canonical_key = $4`,
        [scope.tenantId, scope.companyId, productId, canonicalKey],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async findById(scope: CompanyScope, variantId: string): Promise<ProductVariant | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductVariantRow>(
        `SELECT * FROM catalog.product_variants WHERE tenant_id = $1 AND company_id = $2 AND id = $3`,
        [scope.tenantId, scope.companyId, variantId],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductVariant | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductVariantRow>(
        `SELECT * FROM catalog.product_variants WHERE tenant_id = $1 AND company_id = $2 AND idempotency_key = $3`,
        [scope.tenantId, scope.companyId, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async save(variant: ProductVariant, idempotencyKey: string): Promise<void> {
    try {
      await this.database.withTenantTransaction(variant.scope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.product_variants (id, tenant_id, company_id, product_id, attributes_json, canonical_key, status, version, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            variant.id, variant.scope.tenantId, variant.scope.companyId, variant.productId,
            JSON.stringify(variant.attributes.toRecord()), variant.canonicalKey, variant.status, variant.version, idempotencyKey,
          ],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, "catalog_product_variants_idempotency_uq")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${variant.scope.tenantId}`);
      }
      if (isUniqueViolation(error, "catalog_product_variants_canonical_key_uq")) {
        throw new CatalogDuplicateConflictError(`variant with canonical_key ${variant.canonicalKey} already exists for product ${variant.productId}`);
      }
      throw error;
    }
  }

  private toDomain(row: ProductVariantRow): ProductVariant {
    return ProductVariant.restore({
      id: row.id,
      scope: new CompanyScope(row.tenant_id, row.company_id),
      productId: row.product_id,
      attributes: VariantAttributes.fromRecord(row.attributes_json),
      canonicalKey: row.canonical_key,
      status: row.status as ProductVariantStatus,
      version: Number(row.version),
    });
  }
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === constraintName;
}
