import type { CashShift } from "./cash-shift.js";

/** UC-CASH-001 flow step 9: "Se emite CashShiftOpened". */
export class CashShiftOpened {
  readonly type = "CashShiftOpened";

  private constructor(
    readonly cashShiftId: string,
    readonly cashRegisterId: string,
    readonly occurredAt: Date,
  ) {}

  static from(shift: CashShift): CashShiftOpened {
    return new CashShiftOpened(shift.id, shift.cashRegisterId, shift.openedAt);
  }
}
