import type { Role } from "./role.js";

/**
 * docs/security/permission-matrix.md, "Inventario", rows "Ajuste positivo"
 * and "Ajuste negativo" — identical row for both: OWNER Sí, GENERAL_ADMIN
 * Sí, BRANCH_MANAGER Condicional, SUPERVISOR Autorizar, INVENTORY_OPERATOR
 * Condicional, CASHIER No. Only the unconditional "Sí" roles are allowed.
 * SUPERVISOR's "Autorizar" is deliberately NOT treated as equivalent to
 * "Sí": the matrix's own segregation-of-duties table (line ~423) splits
 * "Ajuste crítico de inventario" into request/approve/execute permissions,
 * and SUPERVISOR here holds approval authority in that separate workflow —
 * not a defined, unconditional right to execute an adjustment directly.
 * That two-phase request/approve workflow has no aggregate or state machine
 * documented anywhere in this repository, so it is not implemented; a
 * direct-execute check fails closed for SUPERVISOR too, same discipline as
 * BRANCH_MANAGER/INVENTORY_OPERATOR's undefined "Condicional".
 */
const ROLES_THAT_MAY_ADJUST_INVENTORY: ReadonlySet<Role> = new Set<Role>(["OWNER", "GENERAL_ADMIN"]);

export function roleMayAdjustInventory(role: Role): boolean {
  return ROLES_THAT_MAY_ADJUST_INVENTORY.has(role);
}
