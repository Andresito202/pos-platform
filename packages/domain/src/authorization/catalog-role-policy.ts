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

/** permission-matrix.md, "Editar producto": OWNER Sí, GENERAL_ADMIN Sí, BRANCH_MANAGER Sí, SUPERVISOR/INVENTORY_OPERATOR Condicional (fail closed), CASHIER No. */
const ROLES_THAT_MAY_UPDATE_PRODUCT: ReadonlySet<Role> = new Set<Role>(["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER"]);

/** permission-matrix.md, "Desactivar producto": OWNER Sí, GENERAL_ADMIN Sí, BRANCH_MANAGER/INVENTORY_OPERATOR Condicional (fail closed), SUPERVISOR/CASHIER No. */
const ROLES_THAT_MAY_DEACTIVATE_PRODUCT: ReadonlySet<Role> = new Set<Role>(["OWNER", "GENERAL_ADMIN"]);

export function roleMayCreateProduct(role: Role): boolean {
  return ROLES_THAT_MAY_CREATE_PRODUCT.has(role);
}

export function roleMayUpdateProduct(role: Role): boolean {
  return ROLES_THAT_MAY_UPDATE_PRODUCT.has(role);
}

export function roleMayDeactivateProduct(role: Role): boolean {
  return ROLES_THAT_MAY_DEACTIVATE_PRODUCT.has(role);
}

/**
 * B26 HD-01/HD-02/HD-03: UC-CAT-003/004/005 each declare a permission
 * (`catalog.identifier.manage`, `catalog.variant.create`,
 * `catalog.presentation.create`) that has NO row in permission-matrix.md —
 * unlike "Crear/Editar/Desactivar producto", there is no role/permission
 * table to transcribe. These three functions fail closed UNCONDITIONALLY,
 * for every role, until the human decision is closed with a real matrix
 * row. Do not add roles here without that row existing first — that would
 * be Claude inventing an authorization policy, exactly what B26/B27
 * forbid.
 */
export function roleMayCreateVariant(_role: Role): boolean {
  return false;
}

export function roleMayCreatePresentation(_role: Role): boolean {
  return false;
}

export function roleMayAssignIdentifier(_role: Role): boolean {
  return false;
}

/**
 * B27 finding (not a pre-existing B26 HD): defining a UnitConversion rule
 * has no UC-CAT-006 evidence as a distinct Catalog-level operation with its
 * own permission — UC-CAT-006 itself describes only Inventory's EXECUTION
 * of an already-defined conversion, under `inventory.presentation.convert`
 * (out of scope here). Fails closed for the same reason as the three
 * functions above: no matrix row exists for "who may define a conversion
 * rule".
 */
export function roleMayDefineConversion(_role: Role): boolean {
  return false;
}
