import { CompanyScope, ConversionFactor, UnitConversion, type UnitConversionStatus } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type UnitConversionRepository } from "@pos-platform/application";
import type { LocalDatabase } from "./local-database.js";

interface UnitConversionRow {
  id: string;
  tenant_id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  source_presentation_id: string;
  target_presentation_id: string;
  factor: string;
  reversible: number;
  requires_authorization: number;
  waste_policy: string | null;
  cost_policy: string | null;
  lot_policy: string | null;
  valid_from: string;
  status: string;
  version: number;
}

/** B29: real SQLite adapter for `UnitConversionRepository` over `MIGRATION_009`. */
export class SqliteUnitConversionRepository implements UnitConversionRepository {
  constructor(private readonly database: LocalDatabase) {}

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<UnitConversion | null> {
    const row = this.database.native
      .prepare(`SELECT * FROM catalog_unit_conversions WHERE tenant_id = ? AND company_id = ? AND idempotency_key = ?`)
      .get(scope.tenantId, scope.companyId, idempotencyKey) as UnitConversionRow | undefined;
    return row ? this.toDomain(row) : null;
  }

  async save(conversion: UnitConversion, idempotencyKey: string): Promise<void> {
    try {
      this.database.native
        .prepare(
          `INSERT INTO catalog_unit_conversions (
            id, tenant_id, company_id, product_id, variant_id, source_presentation_id, target_presentation_id,
            factor, reversible, requires_authorization, waste_policy, cost_policy, lot_policy, valid_from,
            status, version, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          conversion.id, conversion.scope.tenantId, conversion.scope.companyId, conversion.productId,
          conversion.variantId, conversion.sourcePresentationId, conversion.targetPresentationId,
          conversion.factor.toString(), conversion.reversible ? 1 : 0, conversion.requiresAuthorization ? 1 : 0,
          conversion.wastePolicy, conversion.costPolicy, conversion.lotPolicy, conversion.validFrom.toISOString(),
          conversion.status, conversion.version, idempotencyKey, new Date().toISOString(),
        );
    } catch (error) {
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${conversion.scope.tenantId}`);
      }
      if (isUniqueConstraintViolation(error, "source_presentation_id")) {
        throw new CatalogDuplicateConflictError(`a conversion between ${conversion.sourcePresentationId} and ${conversion.targetPresentationId} already exists`);
      }
      throw error;
    }
  }

  private toDomain(row: UnitConversionRow): UnitConversion {
    return UnitConversion.restore({
      id: row.id,
      scope: new CompanyScope(row.tenant_id, row.company_id),
      productId: row.product_id,
      variantId: row.variant_id,
      sourcePresentationId: row.source_presentation_id,
      targetPresentationId: row.target_presentation_id,
      factor: ConversionFactor.fromString(row.factor),
      reversible: row.reversible === 1,
      requiresAuthorization: row.requires_authorization === 1,
      wastePolicy: row.waste_policy,
      costPolicy: row.cost_policy,
      lotPolicy: row.lot_policy,
      validFrom: new Date(row.valid_from),
      status: row.status as UnitConversionStatus,
      version: row.version,
    });
  }
}

function isUniqueConstraintViolation(error: unknown, columnHint: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" && error.message.includes(columnHint);
}
