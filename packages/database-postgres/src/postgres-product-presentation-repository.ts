import { CompanyScope, ProductPresentation, Quantity, type ProductPresentationStatus, type StockMode } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type ProductPresentationRepository } from "@pos-platform/application";
import type { PostgresDatabase } from "./postgres-database.js";

interface ProductPresentationRow {
  id: string;
  tenant_id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  internal_sku: string | null;
  unit_id: string;
  contained_quantity: string;
  variable_quantity: boolean;
  sales_enabled: boolean;
  purchasing_enabled: boolean;
  breakable: boolean;
  stock_mode: string;
  status: string;
  version: string;
}

/** B29: real PostgreSQL adapter for `ProductPresentationRepository` over `catalog.product_presentations`. */
export class PostgresProductPresentationRepository implements ProductPresentationRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async existsBySku(scope: CompanyScope, sku: string): Promise<boolean> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM catalog.product_presentations WHERE tenant_id = $1 AND company_id = $2 AND internal_sku = $3`,
        [scope.tenantId, scope.companyId, sku],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async findById(scope: CompanyScope, presentationId: string): Promise<ProductPresentation | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductPresentationRow>(
        `SELECT * FROM catalog.product_presentations WHERE tenant_id = $1 AND company_id = $2 AND id = $3`,
        [scope.tenantId, scope.companyId, presentationId],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductPresentation | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductPresentationRow>(
        `SELECT * FROM catalog.product_presentations WHERE tenant_id = $1 AND company_id = $2 AND idempotency_key = $3`,
        [scope.tenantId, scope.companyId, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async save(presentation: ProductPresentation, idempotencyKey: string): Promise<void> {
    try {
      await this.database.withTenantTransaction(presentation.scope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.product_presentations (
            id, tenant_id, company_id, product_id, variant_id, name, internal_sku, unit_id,
            contained_quantity, variable_quantity, sales_enabled, purchasing_enabled, breakable,
            stock_mode, status, version, idempotency_key
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            presentation.id, presentation.scope.tenantId, presentation.scope.companyId, presentation.productId,
            presentation.variantId, presentation.name, presentation.internalSku, presentation.unitId,
            presentation.containedQuantity.toString(), presentation.variableQuantity, presentation.salesEnabled,
            presentation.purchasingEnabled, presentation.breakable, presentation.stockMode, presentation.status,
            presentation.version, idempotencyKey,
          ],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, "catalog_product_presentations_idempotency_uq")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${presentation.scope.tenantId}`);
      }
      if (isUniqueViolation(error, "catalog_product_presentations_sku_uq")) {
        throw new CatalogDuplicateConflictError(`internal_sku ${presentation.internalSku ?? ""} already exists for tenant ${presentation.scope.tenantId}, company ${presentation.scope.companyId}`);
      }
      throw error;
    }
  }

  private toDomain(row: ProductPresentationRow): ProductPresentation {
    return ProductPresentation.restore({
      id: row.id,
      scope: new CompanyScope(row.tenant_id, row.company_id),
      productId: row.product_id,
      variantId: row.variant_id,
      name: row.name,
      internalSku: row.internal_sku,
      unitId: row.unit_id,
      containedQuantity: Quantity.fromString(row.contained_quantity),
      variableQuantity: row.variable_quantity,
      salesEnabled: row.sales_enabled,
      purchasingEnabled: row.purchasing_enabled,
      breakable: row.breakable,
      stockMode: row.stock_mode as StockMode,
      status: row.status as ProductPresentationStatus,
      version: Number(row.version),
    });
  }
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === constraintName;
}
