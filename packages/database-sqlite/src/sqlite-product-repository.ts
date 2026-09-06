import { randomUUID } from "node:crypto";
import { CompanyScope, Product, type ProductStatus, type ProductType, type VariantPolicy } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, ProductConflictError, type ProductRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface ProductRow {
  id: string;
  tenant_id: string;
  company_id: string;
  internal_code: string | null;
  name: string;
  description: string | null;
  category_id: string;
  brand_id: string | null;
  product_type: string;
  stock_controlled: number;
  lot_controlled: number;
  expiration_controlled: number;
  serial_controlled: number;
  tax_category_id: string | null;
  base_unit_id: string;
  variant_policy: string;
  status: string;
  version: number;
}

interface MutationLogRow {
  snapshot_json: string;
}

/**
 * B29: real SQLite adapter for `ProductRepository`, backing
 * `CreateProductUseCase`/`UpdateProductUseCase`/`DeactivateProductUseCase`
 * over `MIGRATION_009` (local-database.ts). Uses raw `better-sqlite3`
 * prepared statements — same established pattern as
 * `SqliteCashShiftRepository`, no ORM.
 */
export class SqliteProductRepository implements ProductRepository {
  constructor(private readonly database: LocalDatabase) {}

  async findById(scope: CompanyScope, productId: string): Promise<Product | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_products WHERE tenant_id = ? AND company_id = ? AND id = ?`)
      .get(scope.tenantId, scope.companyId, productId) as ProductRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async existsByInternalCode(scope: CompanyScope, internalCode: string): Promise<boolean> {
    const row = this.database.native
      .prepare(`SELECT 1 FROM catalog_products WHERE tenant_id = ? AND company_id = ? AND internal_code = ?`)
      .get(scope.tenantId, scope.companyId, internalCode);
    return row !== undefined;
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.findLogged(scope, "CREATE", idempotencyKey);
  }

  async save(product: Product, idempotencyKey: string): Promise<void> {
    const now = new Date().toISOString();
    const run = this.database.native.transaction(() => {
      this.database.native
        .prepare(
          `INSERT INTO catalog_products (
            id, tenant_id, company_id, internal_code, name, description, category_id, brand_id,
            product_type, stock_controlled, lot_controlled, expiration_controlled, serial_controlled,
            tax_category_id, base_unit_id, variant_policy, status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          product.id, product.scope.tenantId, product.scope.companyId, product.internalCode, product.name,
          product.description, product.categoryId, product.brandId, product.productType,
          product.stockControlled ? 1 : 0, product.lotControlled ? 1 : 0, product.expirationControlled ? 1 : 0,
          product.serialControlled ? 1 : 0, product.taxCategoryId, product.baseUnitId, product.variantPolicy,
          product.status, product.version, now, now,
        );
      this.insertLog(product, "CREATE", idempotencyKey, now);
    });
    try {
      run();
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new CatalogDuplicateConflictError(`a concurrent write already claimed create idempotency_key for tenant ${product.scope.tenantId}`);
      }
      if (isUniqueConstraintViolation(error, "internal_code")) {
        throw new CatalogDuplicateConflictError(`internal_code already exists for tenant ${product.scope.tenantId}, company ${product.scope.companyId}`);
      }
      throw error;
    }
  }

  async findUpdateByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.findLogged(scope, "UPDATE", idempotencyKey);
  }

  async saveUpdate(product: Product, idempotencyKey: string): Promise<void> {
    await this.saveMutation(product, "UPDATE", idempotencyKey);
  }

  async findDeactivationByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.findLogged(scope, "DEACTIVATE", idempotencyKey);
  }

  async saveDeactivation(product: Product, idempotencyKey: string): Promise<void> {
    await this.saveMutation(product, "DEACTIVATE", idempotencyKey);
  }

  private async saveMutation(product: Product, operation: "UPDATE" | "DEACTIVATE", idempotencyKey: string): Promise<void> {
    const now = new Date().toISOString();
    const priorVersion = product.version - 1;
    const run = this.database.native.transaction(() => {
      const result = this.database.native
        .prepare(
          `UPDATE catalog_products
           SET name = ?, description = ?, category_id = ?, brand_id = ?, status = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(product.name, product.description, product.categoryId, product.brandId, product.status, product.version, now, product.id, priorVersion);
      if (result.changes === 0) {
        throw new ProductConflictError(`product ${product.id} version moved before this ${operation.toLowerCase()} could be saved (expected prior version ${priorVersion})`);
      }
      this.insertLog(product, operation, idempotencyKey, now);
    });
    try {
      run();
    } catch (error) {
      if (error instanceof ProductConflictError) throw error;
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new CatalogDuplicateConflictError(`a concurrent write already claimed ${operation} idempotency_key for product ${product.id}`);
      }
      throw error;
    }
  }

  private insertLog(product: Product, operation: "CREATE" | "UPDATE" | "DEACTIVATE", idempotencyKey: string, now: string): void {
    this.database.native
      .prepare(
        `INSERT INTO catalog_product_mutation_log (id, tenant_id, company_id, operation, idempotency_key, product_id, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), product.scope.tenantId, product.scope.companyId, operation, idempotencyKey, product.id, JSON.stringify(this.toSnapshot(product)), now);
  }

  private findLogged(scope: CompanyScope, operation: "CREATE" | "UPDATE" | "DEACTIVATE", idempotencyKey: string): Product | null {
    const row = this.database.native
      .prepare(`SELECT snapshot_json FROM catalog_product_mutation_log WHERE tenant_id = ? AND company_id = ? AND operation = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, operation, idempotencyKey) as MutationLogRow | undefined;
    if (!row) return null;
    return this.fromSnapshot(JSON.parse(row.snapshot_json) as ProductSnapshot);
  }

  private toSnapshot(product: Product): ProductSnapshot {
    return {
      id: product.id, tenantId: product.scope.tenantId, companyId: product.scope.companyId,
      internalCode: product.internalCode, name: product.name, description: product.description,
      categoryId: product.categoryId, brandId: product.brandId, productType: product.productType,
      stockControlled: product.stockControlled, lotControlled: product.lotControlled,
      expirationControlled: product.expirationControlled, serialControlled: product.serialControlled,
      taxCategoryId: product.taxCategoryId, baseUnitId: product.baseUnitId, variantPolicy: product.variantPolicy,
      status: product.status, version: product.version,
    };
  }

  private fromSnapshot(snapshot: ProductSnapshot): Product {
    return Product.restore({
      id: snapshot.id,
      scope: new CompanyScope(snapshot.tenantId, snapshot.companyId),
      internalCode: snapshot.internalCode,
      name: snapshot.name,
      description: snapshot.description,
      categoryId: snapshot.categoryId,
      brandId: snapshot.brandId,
      productType: snapshot.productType,
      stockControlled: snapshot.stockControlled,
      lotControlled: snapshot.lotControlled,
      expirationControlled: snapshot.expirationControlled,
      serialControlled: snapshot.serialControlled,
      taxCategoryId: snapshot.taxCategoryId,
      baseUnitId: snapshot.baseUnitId,
      variantPolicy: snapshot.variantPolicy,
      status: snapshot.status,
      version: snapshot.version,
    });
  }

  private toDomain(row: ProductRow): Product {
    return Product.restore({
      id: row.id,
      scope: new CompanyScope(row.tenant_id, row.company_id),
      internalCode: row.internal_code,
      name: row.name,
      description: row.description,
      categoryId: row.category_id,
      brandId: row.brand_id,
      productType: row.product_type as ProductType,
      stockControlled: row.stock_controlled === 1,
      lotControlled: row.lot_controlled === 1,
      expirationControlled: row.expiration_controlled === 1,
      serialControlled: row.serial_controlled === 1,
      taxCategoryId: row.tax_category_id,
      baseUnitId: row.base_unit_id,
      variantPolicy: row.variant_policy as VariantPolicy,
      status: row.status as ProductStatus,
      version: row.version,
    });
  }
}

interface ProductSnapshot {
  id: string;
  tenantId: string;
  companyId: string;
  internalCode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  brandId: string | null;
  productType: ProductType;
  stockControlled: boolean;
  lotControlled: boolean;
  expirationControlled: boolean;
  serialControlled: boolean;
  taxCategoryId: string | null;
  baseUnitId: string;
  variantPolicy: VariantPolicy;
  status: ProductStatus;
  version: number;
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
