import type { Role } from "./role.js";

/**
 * B28-PAYNOTIF finding: UC-PAY-001 names a real permission for reporting/
 * initiating a QR or transfer payment (`payments.transfer.report`), but
 * `permission-matrix.md` has no role×permission row for it — unlike
 * "Confirmar pago manual" (which does have a real row: OWNER/GENERAL_ADMIN/
 * BRANCH_MANAGER `Sí`, the rest `No`). Fails closed for every role until a
 * human decision closes that gap — same posture as Catalog's B26 HD-01..04.
 */
export function roleMayInitiatePayment(_role: Role): boolean {
  return false;
}
