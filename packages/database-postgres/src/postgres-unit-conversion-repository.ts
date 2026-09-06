import { CompanyScope, ConversionFactor, UnitConversion, type UnitConversionStatus } from "@pos-platform/domain";
import { CatalogDuplicateConflictError, IdempotencyKeyConflictError, type UnitConversionRepository } from "@pos-platform/application";
import type { PostgresDatabase } from "./postgres-database.js";

interface UnitConversionRow {
  id: string;
  tenant_id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  source_presentation_id: string;
  target_presentation_id: string;
  factor: string;
  reversible: boolean;
  requires_authorization: boolean;
  waste_policy: string | null;
  cost_policy: string | null;
  lot_policy: string | null;
  valid_from: string;
  status: string;
  version: string;
}

/** B29: real PostgreSQL adapter for `UnitConversionRepository` over `catalog.unit_conversions`. */
export class PostgresUnitConversionRepository implements UnitConversionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<UnitConversion | null> {
    return this.database.withTenantTransaction(scope.tenantId, async (client) => {
      const result = await client.query<UnitConversionRow>(
        `SELECT * FROM catalog.unit_conversions WHERE tenant_id = $1 AND company_id = $2 AND idempotency_key = $3`,
        [scope.tenantId, scope.companyId, idempotencyKey],
      );
      const row = result.rows[0];
      return row ? this.toDomain(row) : null;
    });
  }

  async save(conversion: UnitConversion, idempotencyKey: string): Promise<void> {
    try {
      await this.database.withTenantTransaction(conversion.scope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.unit_conversions (
            id, tenant_id, company_id, product_id, variant_id, source_presentation_id, target_presentation_id,
            factor, reversible, requires_authorization, waste_policy, cost_policy, lot_policy, valid_from,
            status, version, idempotency_key
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            conversion.id, conversion.scope.tenantId, conversion.scope.companyId, conversion.productId,
            conversion.variantId, conversion.sourcePresentationId, conversion.targetPresentationId,
            conversion.factor.toString(), conversion.reversible, conversion.requiresAuthorization,
            conversion.wastePolicy, conversion.costPolicy, conversion.lotPolicy, conversion.validFrom.toISOString(),
            conversion.status, conversion.version, idempotencyKey,
          ],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, "catalog_unit_conversions_idempotency_uq")) {
        throw new IdempotencyKeyConflictError(`a concurrent write already claimed create idempotency_key for tenant ${conversion.scope.tenantId}`);
      }
      if (isUniqueViolation(error, "catalog_unit_conversions_pair_uq")) {
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
      reversible: row.reversible,
      requiresAuthorization: row.requires_authorization,
      wastePolicy: row.waste_policy,
      costPolicy: row.cost_policy,
      lotPolicy: row.lot_policy,
      validFrom: new Date(row.valid_from),
      status: row.status as UnitConversionStatus,
      version: Number(row.version),
    });
  }
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === constraintName;
}
