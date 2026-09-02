import { Money } from "../money.js";
import type { CashShift } from "./cash-shift.js";

export type CashCountDifferenceType = "SHORTAGE" | "EXACT" | "OVERAGE";

/**
 * Scoped to the CLOSING count only — UC-CASH-002's own flow (step 5): "crea
 * CashCount CLOSING completado y calcula la diferencia". PARTIAL/CORRECTION
 * count types, denomination breakdown, and blind-count mode are UC-CASH-003
 * "arqueo" features with their own flow, not needed by close and not built
 * here — adding them now would have no caller.
 */
export class CashCount {
  private constructor(
    readonly id: string,
    readonly cashShiftId: string,
    readonly expectedAmount: Money,
    readonly countedAmount: Money,
    readonly differenceAmount: Money,
    readonly differenceType: CashCountDifferenceType,
    readonly movementCutoffSequence: number,
    readonly completedAt: Date,
  ) {}

  /** difference = counted - expected (UC-CASH-003, "Fórmula"). */
  static closing(shift: CashShift, id: string, countedAmount: Money, expectedAmount: Money, movementCutoffSequence: number, now: Date): CashCount {
    const differenceAmount = countedAmount.subtract(expectedAmount);
    const differenceType: CashCountDifferenceType = differenceAmount.equals(Money.zero())
      ? "EXACT"
      : differenceAmount.isNonNegative() ? "OVERAGE" : "SHORTAGE";
    return new CashCount(id, shift.id, expectedAmount, countedAmount, differenceAmount, differenceType, movementCutoffSequence, now);
  }
}
