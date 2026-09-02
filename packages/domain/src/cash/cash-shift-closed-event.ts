import type { CashShift } from "./cash-shift.js";

/** UC-CASH-002 flow step 9. */
export class CashShiftClosed {
  readonly type = "CashShiftClosed";
  private constructor(readonly cashShiftId: string, readonly occurredAt: Date) {}
  static from(shift: CashShift): CashShiftClosed {
    if (!shift.closedAt) throw new Error("cannot build CashShiftClosed from a shift that is not closed");
    return new CashShiftClosed(shift.id, shift.closedAt);
  }
}

/** UC-CASH-002 flow step 9 — emitted unconditionally once a CashCount CLOSING completes. */
export class CashCountCompleted {
  readonly type = "CashCountCompleted";
  constructor(readonly cashCountId: string, readonly cashShiftId: string, readonly occurredAt: Date) {}
}

/** UC-CASH-002 flow step 9 — emitted only "cuando aplique" (difference != 0). */
export class CashDifferenceDetected {
  readonly type = "CashDifferenceDetected";
  constructor(readonly cashCountId: string, readonly cashShiftId: string, readonly occurredAt: Date) {}
}
