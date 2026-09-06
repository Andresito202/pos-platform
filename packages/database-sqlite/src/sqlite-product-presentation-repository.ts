import { CompanyScope, ProductPresentation, Quantity, type ProductPresentationStatus, type StockMode } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type ProductPresentationRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

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
  variable_quantity: number;
  sales_enabled: number;
  purchasing_enabled: number;
  breakable: number;
  stock_mode: string;
  status: string;
  version: number;
}

/** B29: real SQLite adapter for `ProductPresentationRepository` over `MIGRATION_009`. */
export class SqliteProductPresentationRepository implements ProductPresentationRepository {
  constructor(private readonly database: LocalDatabase) {}

  async existsBySku(scope: CompanyScope, sku: string): Promise<boolean> {
    const row = this.database.native
      .prepare(`SELECT 1 FROM catalog_product_presentations WHERE tenant_id = ? AND company_id = ? AND internal_sku = ?`)
      .get(scope.tenantId, scope.companyId, sku);
    return row !== undefined;
  }

  async findById(scope: CompanyScope, presentationId: string): Promise<ProductPresentation | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_product_presentations WHERE tenant_id = ? AND company_id = ? AND id = ?`)
      .get(scope.tenantId, scope.companyId, presentationId) as ProductPresentationRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<ProductPresentation | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_product_presentations WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, idempotencyKey) as ProductPresentationRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async save(presentation: ProductPresentation, idempotencyKey: string): Promise<void> {
    try {
      this.database.native
        .prepare(
          `INSERT INTO catalog_product_presentations (
            id, tenant_id, company_id, product_id, variant_id, name, internal_sku, unit_id,
            contained_quantity, variable_quantity, sales_enabled, purchasing_enabled, breakable,
            stock_mode, status, version, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          presentation.id, presentation.scope.tenantId, presentation.scope.companyId, presentation.productId,
          presentation.variantId, presentation.name, presentation.internalSku, presentation.unitId,
          presentation.containedQuantity.toString(), presentation.variableQuantity ? 1 : 0,
          presentation.salesEnabled ? 1 : 0, presentation.purchasingEnabled ? 1 : 0, presentation.breakable ? 1 : 0,
          presentation.stockMode, presentation.status, presentation.version, idempotencyKey, new Date().toISOString(),
        );
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${presentation.scope.tenantId}`);
      }
      if (isUniqueConstraintViolation(error, "internal_sku")) {
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
      variableQuantity: row.variable_quantity === 1,
      salesEnabled: row.sales_enabled === 1,
      purchasingEnabled: row.purchasing_enabled === 1,
      breakable: row.breakable === 1,
      stockMode: row.stock_mode as StockMode,
      status: row.status as ProductPresentationStatus,
      version: row.version,
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
