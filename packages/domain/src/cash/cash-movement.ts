import { Money } from "../money.js";
import { CashDomainError } from "./cash-domain-errors.js";
import type { CashShift } from "./cash-shift.js";

/**
 * The full closed set from UC-CASH-003 ("Tipos conceptuales de movimiento")
 * and cash-counting-schema.md — transcribed, not invented. Only
 * OPENING_FLOAT (CASH-001) and CASH_WITHDRAWAL (this block) have a
 * dedicated factory with a fixed, evidenced direction; the other 14 are
 * real, closed enum members but have no business logic behind them yet —
 * building one without a specified flow would be exactly the invented
 * business logic this project's rules forbid.
 */
export type CashMovementType =
  | "OPENING_FLOAT" | "CASH_SALE" | "CASH_PAYMENT" | "CHANGE_GIVEN" | "CASH_REFUND"
  | "CASH_REVERSAL_COMPENSATION" | "CASH_WITHDRAWAL" | "CASH_DEPOSIT" | "COURIER_COLLECTION"
  | "CASH_EXPENSE" | "CASH_ADJUSTMENT_POSITIVE" | "CASH_ADJUSTMENT_NEGATIVE" | "TRANSFER_TO_SAFE"
  | "TRANSFER_FROM_SAFE" | "CLOSING_TRANSFER" | "OTHER_AUTHORIZED";

export type CashMovementDirection = "IN" | "OUT";
export type CashMovementStatus = "POSTED";

export interface RegisterCashMovementInput {
  readonly id: string;
  readonly shift: CashShift;
  readonly shiftSequence: number;
  readonly movementType: CashMovementType;
  readonly direction: CashMovementDirection;
  readonly amount: Money;
  readonly occurredAt: Date;
}

/**
 * A single CashMovement. UC-CASH-003 invariants 20/21 ("ningún movimiento
 * se crea con importe cero" / "ningún importe puede ser negativo") are
 * strictly stricter than CashShift's opening amount (which allows zero) —
 * that distinction is deliberate and tested.
 *
 * `direction` is a caller-supplied input validated for sign, not derived
 * from `movementType` — UC-CASH-003's own entry fields list movement_type
 * and direction as two separate inputs (flow step 12 validates direction,
 * it does not compute it). Only the two dedicated factories below fix a
 * canonical direction, because only those two have textual evidence for it.
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

  static register(input: RegisterCashMovementInput): CashMovement {
    if (!input.amount.isPositive()) {
      throw new CashDomainError("NON_POSITIVE_MOVEMENT_AMOUNT", "movement amount must be strictly positive");
    }
    return new CashMovement(
      input.id,
      input.shift.id,
      input.shiftSequence,
      input.movementType,
      input.direction,
      input.amount,
      "POSTED",
      input.occurredAt,
    );
  }

  /**
   * shift_sequence is always 1. Deliberately bypasses `register()`'s
   * strict positive-amount gate: UC-CASH-001 step 5 validates the opening
   * amount as "no negativo" (>= 0), not positive — CashShift.open() already
   * enforced that before this shift could exist, so re-checking here would
   * only ever reject the zero case that UC-CASH-001 explicitly allows.
   */
  static openingFloat(shift: CashShift, id: string, now: Date): CashMovement {
    return new CashMovement(id, shift.id, 1, "OPENING_FLOAT", "IN", shift.openingAmount, "POSTED", now);
  }

  /** "Un retiro... Salida — reduce el efectivo esperado" (UC-CASH-003). */
  static withdrawal(shift: CashShift, id: string, shiftSequence: number, amount: Money, now: Date): CashMovement {
    return CashMovement.register({
      id, shift, shiftSequence, movementType: "CASH_WITHDRAWAL", direction: "OUT", amount, occurredAt: now,
    });
  }

  signedAmount(): Money {
    return this.direction === "IN" ? this.amount : Money.zero().subtract(this.amount);
  }
}
