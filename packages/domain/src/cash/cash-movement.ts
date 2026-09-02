import { Money } from "../money.js";
import type { CashShift } from "./cash-shift.js";

export type CashMovementType = "OPENING_FLOAT";
export type CashMovementDirection = "IN";
export type CashMovementStatus = "POSTED";

/**
 * The single OPENING_FLOAT movement a CashShift.open() produces. Per the
 * closed transactional boundary in cash-counting-schema.md ("Apertura"):
 * the shift and this movement are created together, shift_sequence=1,
 * status POSTED immediately (opening is never PENDING_APPROVAL). Only the
 * OPENING_FLOAT type/shape is modeled — the other 15 movement types
 * (CASH_SALE, CASH_WITHDRAWAL, etc.) belong to CASH-003, out of scope here.
 */
export class CashMovement {
  private constructor(
    readonly id: string,
    readonly cashShiftId: string,
    readonly shiftSequence: number,
    readonly movementType: CashMovementType,
    readonly direction: CashMovementDirection,
    readonly amount: Money,
    readonly status: CashMovementStatus,
    readonly occurredAt: Date,
  ) {}

  static openingFloat(shift: CashShift, id: string, now: Date): CashMovement {
    return new CashMovement(id, shift.id, 1, "OPENING_FLOAT", "IN", shift.openingAmount, "POSTED", now);
  }
}
