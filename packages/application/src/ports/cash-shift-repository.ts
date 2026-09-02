import type { CashCount, CashDifferenceReview, CashMovement, CashShift, TenantScope } from "@pos-platform/domain";

/**
 * Extended for CASH-002 (close) / CASH-003 (movements) beyond CASH-001's
 * original two methods. Kept as ONE repository, not split into
 * CashMovementRepository/CashCountRepository: CashShift is the aggregate
 * root that owns its movements and its closing count (per
 * cash-counting-schema.md's own "Fronteras transaccionales" — a movement or
 * a close always commits together with the shift's version bump), so
 * splitting by entity would cut across a single transactional boundary for
 * no real benefit. No SQLite/PostgreSQL adapter implements this yet — same
 * DDL NO-GO gate as CASH-001.
 */
export interface CashShiftRepository {
  hasIncompatibleOpenShift(scope: TenantScope, cashRegisterId: string): Promise<boolean>;
  save(shift: CashShift, movement: CashMovement): Promise<void>;

  /** Finds by id regardless of status — callers check `.status` themselves. */
  findById(scope: TenantScope, cashShiftId: string): Promise<CashShift | null>;
  listPostedMovements(cashShiftId: string): Promise<readonly CashMovement[]>;
  nextMovementSequence(cashShiftId: string): Promise<number>;
  /**
   * Idempotent-replay lookup only — returns the previously registered
   * movement so the use case can return the same result again. Does NOT
   * detect a same-key-different-content conflict (UC-CASH-003 step 16):
   * that needs a persisted checksum to compare against, which only a real
   * adapter can own. Deferred, not fabricated — see this block's report.
   */
  findMovementByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashMovement | null>;
  saveMovement(shift: CashShift, movement: CashMovement, idempotencyKey: string): Promise<void>;

  findCloseByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<CashCount | null>;
  saveClose(shift: CashShift, count: CashCount, review: CashDifferenceReview | null, idempotencyKey: string): Promise<void>;
}
