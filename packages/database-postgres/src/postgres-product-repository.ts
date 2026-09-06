import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { CompanyScope, Product, type ProductStatus, type ProductType, type VariantPolicy } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, ProductConflictError, type ProductRepository } from "@pos-platform/application";
import type { PostgresDatabase } from "./postgres-database.js";

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
  stock_controlled: boolean;
  lot_controlled: boolean;
  expiration_controlled: boolean;
  serial_controlled: boolean;
  tax_category_id: string | null;
  base_unit_id: string;
  variant_policy: string;
  status: string;
  version: string;
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

/**
 * B29: real PostgreSQL adapter for `ProductRepository`, backing
 * `CreateProductUseCase`/`UpdateProductUseCase`/`DeactivateProductUseCase`
 * over `catalog.products`/`catalog.product_mutation_log`
 * (005_catalog_foundation.up.sql) — same port `SqliteProductRepository`
 * implements, method-for-method. Unlike Cash's adapter, this is NOT
 * constructed per tenant: every `ProductRepository` method already
 * receives `scope` (`CompanyScope`) as a parameter, so `tenantId` for
 * `withTenantTransaction`/RLS is read from the call itself.
 */
export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findById(scope: CompanyScope, productId: string): Promise<Product | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<ProductRow>(
        `SELECT * FROM catalog.products WHERE tenant_id = $1 AND company_id = $2 AND id = $3`,
        [scope.tenantId, scope.companyId, productId],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async existsByInternalCode(scope: CompanyScope, internalCode: string): Promise<boolean> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `SELECT 1 FROM catalog.products WHERE tenant_id = $1 AND company_id = $2 AND internal_code = $3`,
        [scope.tenantId, scope.companyId, internalCode],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<Product | null> {
    return this.findLogged(scope, "CREATE", idempotencyKey);
  }

  async save(product: Product, idempotencyKey: string): Promise<void> {
    try {
      await this.database.withTenantTransaction(product.scope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.products (
            id, tenant_id, company_id, internal_code, name, description, category_id, brand_id,
            product_type, stock_controlled, lot_controlled, expiration_controlled, serial_controlled,
            tax_category_id, base_unit_id, variant_policy, status, version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            product.id, product.scope.tenantId, product.scope.companyId, product.internalCode, product.name,
            product.description, product.categoryId, product.brandId, product.productType, product.stockControlled,
            product.lotControlled, product.expirationControlled, product.serialControlled, product.taxCategoryId,
            product.baseUnitId, product.variantPolicy, product.status, product.version,
          ],
        );
        await this.insertLog(client, product, "CREATE", idempotencyKey);
      });
    } catch (error) {
      if (isUniqueViolation(error, "catalog_product_mutation_log_uq")) {
        throw new CatalogDuplicateConflictError(`a concurrent write already claimed create idempotency_key for tenant ${product.scope.tenantId}`);
      }
      if (isUniqueViolation(error, "catalog_products_internal_code_uq")) {
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
    const priorVersion = product.version - 1;
    try {
      await this.database.withTenantTransaction(product.scope.tenantId, async (client) => {
        const result = await client.query(
          `UPDATE catalog.products
           SET name = $1, description = $2, category_id = $3, brand_id = $4, status = $5, version = $6, updated_at = now()
           WHERE id = $7 AND version = $8`,
          [product.name, product.description, product.categoryId, product.brandId, product.status, product.version, product.id, priorVersion],
        );
        if (result.rowCount === 0) {
          throw new ProductConflictError(`product ${product.id} version moved before this ${operation.toLowerCase()} could be saved (expected prior version ${priorVersion})`);
        }
        await this.insertLog(client, product, operation, idempotencyKey);
      });
    } catch (error) {
      if (error instanceof ProductConflictError) throw error;
      if (isUniqueViolation(error, "catalog_product_mutation_log_uq")) {
        throw new CatalogDuplicateConflictError(`a concurrent write already claimed ${operation} idempotency_key for product ${product.id}`);
      }
      throw error;
    }
  }

  private async insertLog(client: PoolClient, product: Product, operation: "CREATE" | "UPDATE" | "DEACTIVATE", idempotencyKey: string): Promise<void> {
    await client.query(
      `INSERT INTO catalog.product_mutation_log (id, tenant_id, company_id, operation, idempotency_key, product_id, snapshot_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newMutationLogId(), product.scope.tenantId, product.scope.companyId, operation, idempotencyKey, product.id, JSON.stringify(this.toSnapshot(product))],
    );
  }

  private async findLogged(scope: CompanyScope, operation: "CREATE" | "UPDATE" | "DEACTIVATE", idempotencyKey: string): Promise<Product | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<{ snapshot_json: ProductSnapshot }>(
        `SELECT snapshot_json FROM catalog.product_mutation_log WHERE tenant_id = $1 AND company_id = $2 AND operation = $3 AND idempotency_key = $4`,
        [scope.tenantId, scope.companyId, operation, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.fromSnapshot(row.snapshot_json) : null;
    });
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
      stockControlled: row.stock_controlled,
      lotControlled: row.lot_controlled,
      expirationControlled: row.expiration_controlled,
      serialControlled: row.serial_controlled,
      taxCategoryId: row.tax_category_id,
      baseUnitId: row.base_unit_id,
      variantPolicy: row.variant_policy as VariantPolicy,
      status: row.status as ProductStatus,
      version: Number(row.version),
    });
  }
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === constraintName;
}

/**
 * `catalog.product_mutation_log.id` is not a domain aggregate id (unlike every
 * other row this adapter writes, whose id always comes from the application
 * layer's `IdGenerator`) — it is this log row's own synthetic PK, generated
 * here at the adapter boundary. `platform.is_uuid_v7` (bootstrap.sql) only
 * checks the version/variant nibbles, not real time-ordering, but this still
 * builds a real RFC 9562 UUIDv7 (48-bit unix-ms timestamp + random tail).
 */
function newMutationLogId(): string {
  const buf = randomBytes(16);
  const timestamp = BigInt(Date.now());
  buf[0] = Number((timestamp >> 40n) & 0xffn);
  buf[1] = Number((timestamp >> 32n) & 0xffn);
  buf[2] = Number((timestamp >> 24n) & 0xffn);
  buf[3] = Number((timestamp >> 16n) & 0xffn);
  buf[4] = Number((timestamp >> 8n) & 0xffn);
  buf[5] = Number(timestamp & 0xffn);
  buf[6] = 0x70 | (buf[6]! & 0x0f);
  buf[8] = 0x80 | (buf[8]! & 0x3f);
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
