import type { CompanyScope, UnitConversion } from "@pos-platform/domain";

/** Bloque 27. No SQLite/PostgreSQL adapter implements this — same DDL-gate posture as ProductRepository. */
export interface UnitConversionRepository {
  findByIdempotencyKey(scope: CompanyScope, idempotencyKey: string): Promise<UnitConversion | null>;
  save(conversion: UnitConversion, idempotencyKey: string): Promise<void>;
}
