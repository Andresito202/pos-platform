import type { Role } from "./role.js";

/**
 * docs/security/permission-matrix.md, "Productos y precios", row
 * "Crear producto": OWNER Sí, GENERAL_ADMIN Sí, BRANCH_MANAGER Sí,
 * SUPERVISOR Condicional, INVENTORY_OPERATOR Sí, CASHIER No. Only the
 * unconditional "Sí" roles are allowed — SUPERVISOR's "Condicional" has
 * no defined condition anywhere in this repository, so it fails closed,
 * same discipline as cash-role-policy.ts.
 */
const ROLES_THAT_MAY_CREATE_PRODUCT: ReadonlySet<Role> = new Set<Role>([
  "OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "INVENTORY_OPERATOR",
]);

export function roleMayCreateProduct(role: Role): boolean {
  return ROLES_THAT_MAY_CREATE_PRODUCT.has(role);
}
