import type { Actor } from "@pos-platform/domain";

/**
 * UC-CASH-001 precondition: "el usuario tiene permiso". No implementation
 * of this port exists in this codebase — SEC-003 (real user/session/role)
 * is not materialized. This interface exists so OpenCashShiftUseCase does
 * not silently skip the precondition; wiring a real adapter without a real
 * identity system behind it would be exactly the fabricated authorization
 * this project's rules forbid. Until SEC-003 lands, nothing outside tests
 * may construct an instance of this port.
 */
export interface CashAuthorizationPort {
  canOpenShift(actor: Actor): Promise<boolean>;
}
