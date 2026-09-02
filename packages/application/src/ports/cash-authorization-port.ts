import type { Actor, CashMovementType } from "@pos-platform/domain";

/**
 * UC-CASH-001 step 2 and UC-CASH-003 step 8 both require a permission
 * check; UC-CASH-002's own close flow does NOT list an explicit permission
 * step, so CloseCashShiftUseCase deliberately does not call this port —
 * that omission is evidence-based, not an oversight. No implementation
 * exists — SEC-003 is not materialized. Nothing outside tests may
 * construct an instance of this port.
 */
export interface CashAuthorizationPort {
  canOpenShift(actor: Actor): Promise<boolean>;
  canRegisterMovement(actor: Actor, movementType: CashMovementType): Promise<boolean>;
}
