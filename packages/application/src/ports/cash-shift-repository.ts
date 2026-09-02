import type { CashMovement, CashShift, TenantScope } from "@pos-platform/domain";

/**
 * Only the two operations OpenCashShiftUseCase actually needs. A full
 * CRUD-shaped repository (list/update/delete) would be speculative surface
 * with no caller in this vertical — CASH-002/003 can extend this port when
 * they exist. No SQLite/PostgreSQL adapter implements this yet: the
 * cash_shifts/cash_movements tables are blocked by the first-migration
 * DDL gate (NO-GO for every commercial domain,
 * docs/architecture/physical-model/traceability.md).
 */
export interface CashShiftRepository {
  hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string): Promise<boolean>;
  save(shift: CashShift, movement: CashMovement): Promise<void>;
}
