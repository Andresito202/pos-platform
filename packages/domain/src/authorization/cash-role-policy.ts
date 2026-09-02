import type { Role } from "./role.js";

/**
 * Encodes ONLY the two rows of docs/security/permission-matrix.md
 * ("Caja y ventas") that this codebase has a real use case for. Every
 * other row (ventas, arqueo, diferencias, reportes...) has no use case
 * yet and is deliberately not encoded — adding it now would be
 * unreachable, untestable policy with no caller.
 *
 * The matrix uses four outcomes: Sí / No / Condicional / Autorizar /
 * "Dentro de límite|política". Only unconditional "Sí" maps to allowed.
 * Every conditional outcome maps to NOT allowed — fail-closed, because
 * this repository defines no policy value (a limit, an approval chain)
 * to resolve the condition with. That is a documented gap, not an
 * invented default.
 */

/** "Abrir caja propia": Sí for all five operational roles, unconditionally. */
const ROLES_THAT_MAY_OPEN_SHIFT: ReadonlySet<Role> = new Set<Role>([
  "OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "CASHIER",
]);

/**
 * "Registrar egreso de caja" — the closest matrix row to CASH_WITHDRAWAL
 * (the only movement type this codebase implements a use case for).
 * OWNER/GENERAL_ADMIN: "Sí" (unconditional). BRANCH_MANAGER: "Condicional".
 * SUPERVISOR: "Autorizar". CASHIER: "Dentro de límite". Only the two
 * unconditional roles are allowed.
 */
const ROLES_THAT_MAY_WITHDRAW: ReadonlySet<Role> = new Set<Role>(["OWNER", "GENERAL_ADMIN"]);

export function roleMayOpenCashShift(role: Role): boolean {
  return ROLES_THAT_MAY_OPEN_SHIFT.has(role);
}

export function roleMayRegisterCashWithdrawal(role: Role): boolean {
  return ROLES_THAT_MAY_WITHDRAW.has(role);
}
