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

/**
 * `permission-matrix.md` "Registrar merma": Sí/Sí/Sí/Sí/Sí/Condicional —
 * a DIFFERENT row from Ajuste (B31 finding: not one shared policy). Five
 * roles are unconditional; only `CASHIER`'s "Condicional" is undefined
 * (HD-INV-04, non-blocking) and fails closed here.
 */
const ROLES_THAT_MAY_REGISTER_WASTE: ReadonlySet<Role> = new Set<Role>(["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR"]);

export function roleMayRegisterWaste(role: Role): boolean {
  return ROLES_THAT_MAY_REGISTER_WASTE.has(role);
}

/**
 * `permission-matrix.md` "Trasladar inventario": Sí/Sí/Condicional/
 * Autorizar/Sí/No — `BRANCH_MANAGER`("Condicional")/`SUPERVISOR`
 * ("Autorizar") are undefined (HD-INV-03, non-blocking) and fail closed;
 * `INVENTORY_OPERATOR` is unconditional here (unlike Ajuste, where it is
 * "Condicional") — confirms this is genuinely a separate policy, not
 * `roleMayAdjustInventory` reused under another name.
 */
const ROLES_THAT_MAY_TRANSFER_INVENTORY: ReadonlySet<Role> = new Set<Role>(["OWNER", "GENERAL_ADMIN", "INVENTORY_OPERATOR"]);

export function roleMayTransferInventory(role: Role): boolean {
  return ROLES_THAT_MAY_TRANSFER_INVENTORY.has(role);
}

/**
 * Reserve/consume/release: `permission-matrix.md` has no row at all for
 * these — B31's `ARCHITECTURAL DECISION` reads this as authorization
 * inherited from the calling process (Sales confirming a sale, per
 * `UC-INVENTORY-002`'s own actor framing: "usuario o proceso
 * autorizado"), not a direct end-user permission. No legitimate way
 * exists yet to construct a `SYSTEM` actor for that inherited
 * authorization (`Actor`'s own doc comment: "nothing in this repository
 * originates one yet") and no real caller (Sales) exists either — so
 * this fails closed for every role, same fail-closed posture Catalog
 * used for HD-01/02/03, until a real calling context exists to inherit
 * authorization from.
 */
export function roleMayReserveInventory(_role: Role): boolean {
  return false;
}

export function roleMayConsumeInventoryReservation(_role: Role): boolean {
  return false;
}

export function roleMayReleaseInventoryReservation(_role: Role): boolean {
  return false;
}
