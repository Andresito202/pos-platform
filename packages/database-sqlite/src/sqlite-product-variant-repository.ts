import { CompanyScope, ProductVariant, VariantAttributes, type ProductVariantStatus } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type ProductVariantRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface ProductVariantRow {
  id: string;
  tenant_id: string;
  company_id: string;
  product_id: string;
  attributes_json: string;
  canonical_key: string;
  status: string;
  version: number;
}

/** B29: real SQLite adapter for `ProductVariantRepository` over `MIGRATION_009`. */
export class SqliteProductVariantRepository implements ProductVariantRepository {
  constructor(private readonly database: LocalDatabase) {}

  async findByProductAndCanonicalKey(scope: CompanyScope, productId: string, canonicalKey: string): Promise<ProductVariant | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_product_variants WHERE tenant_id = ? AND company_id = ? AND product_id = ? AND canonical_key = ?`)
      .get(scope.tenantId, scope.companyId, productId, canonicalKey) as ProductVariantRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async findById(scope: CompanyScope, variantId: string): Promise<ProductVariant | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_product_variants WHERE tenant_id = ? AND company_id = ? AND id = ?`)
      .get(scope.tenantId, scope.companyId, variantId) as ProductVariantRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductVariant | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_product_variants WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, idempotencyKey) as ProductVariantRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async save(variant: ProductVariant, idempotencyKey: string): Promise<void> {
    try {
      this.database.native
        .prepare(
          `INSERT INTO catalog_product_variants (id, tenant_id, company_id, product_id, attributes_json, canonical_key, status, version, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          variant.id, variant.scope.tenantId, variant.scope.companyId, variant.productId,
          JSON.stringify(variant.attributes.toRecord()), variant.canonicalKey, variant.status, variant.version,
          idempotencyKey, new Date().toISOString(),
        );
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${variant.scope.tenantId}`);
      }
      if (isUniqueConstraintViolation(error, "canonical_key")) {
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
      attributes: VariantAttributes.fromRecord(JSON.parse(row.attributes_json) as Record<string, string>),
      canonicalKey: row.canonical_key,
      status: row.status as ProductVariantStatus,
      version: row.version,
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
