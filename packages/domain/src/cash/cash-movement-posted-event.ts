import type { CashMovement } from "./cash-movement.js";

/**
 * UC-CASH-003 domain events list includes CashMovementCreated/Approved/
 * Posted/Rejected/Failed/Compensated — only Posted is reachable here: this
 * implementation registers a movement directly as POSTED (no
 * PENDING_APPROVAL branch, since "evalúa si requiere aprobación" depends on
 * an approval policy that is not defined anywhere in this repository).
 */
export class CashMovementPosted {
  readonly type = "CashMovementPosted";
  private constructor(readonly cashMovementId: string, readonly cashShiftId: string, readonly occurredAt: Date) {}
  static from(movement: CashMovement): CashMovementPosted {
    return new CashMovementPosted(movement.id, movement.cashShiftId, movement.occurredAt);
  }
}
