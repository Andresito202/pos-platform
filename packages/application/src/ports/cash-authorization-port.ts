import type { Actor, CashMovementType, TenantScope } from "@pos-platform/domain";

/**
 * UC-CASH-001 step 2 and UC-CASH-003 step 8 both require a permission
 * check; UC-CASH-002's own close flow does NOT list an explicit permission
 * step, so CloseCashShiftUseCase deliberately does not call this port —
 * that omission is evidence-based, not an oversight.
 *
 * `scope` was added in the SEC-003 block (was missing from the Block
 * 2/3 signature). permission-matrix.md's own principle 3 requires
 * authorization to consider tenant/empresa/sucursal — a check that
 * cannot see the scope cannot be tenant-aware, so the interface could
 * never have supported a real implementation as it was. Both call sites
 * were updated to pass it; the CASH-001/003 regression suite (run after
 * this change, not skipped) confirms nothing else broke.
 */
export interface CashAuthorizationPort {
  canOpenShift(actor: Actor, scope: TenantScope): Promise<boolean>;
  canRegisterMovement(actor: Actor, movementType: CashMovementType, scope: TenantScope): Promise<boolean>;
}
