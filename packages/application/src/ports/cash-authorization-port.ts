import type { Actor, CashMovementType, TenantScope } from "@pos-platform/domain";

/**
 * UC-CASH-001 step 2 and UC-CASH-003 step 8 both list an explicit
 * permission step. UC-CASH-002's own close flow does not number one the
 * same way, but permission-matrix.md's "Cerrar caja propia" row (Caja y
 * ventas) is unconditional Sí for all five operational roles — a real,
 * directly-applicable grant that was missed when this port was first
 * built (Block 3) and only caught by the Bloque 9 cross-functional review.
 * `canCloseShift` closes that gap.
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
  canCloseShift(actor: Actor, scope: TenantScope): Promise<boolean>;
}
