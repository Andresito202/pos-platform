import type { CashCount } from "./cash-count.js";

/**
 * "Toda diferencia distinta de cero crea CashDifferenceReview" (UC-CASH-003).
 * Only the REVIEW_REQUIRED creation is modeled — ACCEPTED/ESCALATED/RESOLVED
 * are transitions performed by a supervisor role that does not exist yet
 * (SEC-003), and the "threshold requiring an authorization reference"
 * branch (UC-CASH-002 step 6) depends on a tolerance policy value that is
 * not defined anywhere in this repository. Both are left explicitly out,
 * not silently skipped — see the BLOQUEOS section of this block's report.
 */
export class CashDifferenceReview {
  readonly status = "REVIEW_REQUIRED";

  private constructor(
    readonly id: string,
    readonly cashShiftId: string,
    readonly cashCountId: string,
    readonly createdAt: Date,
  ) {}

  static required(cashCount: CashCount, id: string, now: Date): CashDifferenceReview {
    return new CashDifferenceReview(id, cashCount.cashShiftId, cashCount.id, now);
  }

  /**
   * Bloque 22 (materialization): reconstructs a review from an already-
   * persisted row. No `status` parameter — every row is REVIEW_REQUIRED
   * today, same as `required()`, since no transition is modeled yet.
   */
  static restore(input: { readonly id: string; readonly cashShiftId: string; readonly cashCountId: string; readonly createdAt: Date }): CashDifferenceReview {
    return new CashDifferenceReview(input.id, input.cashShiftId, input.cashCountId, input.createdAt);
  }
}
