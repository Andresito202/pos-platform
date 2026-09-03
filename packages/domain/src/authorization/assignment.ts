import { AuthorizationModelError } from "./errors.js";
import type { AssignmentScope } from "./scope.js";

export type AssignmentStatus = "ACTIVE" | "REVOKED";
export type RoleStatus = "ACTIVE" | "RETIRED";
export type PermissionStatus = "ACTIVE" | "RETIRED";

export interface GrantedPermission {
  readonly code: string;
  readonly status: PermissionStatus;
}

/**
 * Proyección de una asignación de rol vigente para un usuario, con los permisos
 * que su rol concede. Refleja `authorization.user_role_assignments` unida a
 * `role_permission_grants` y `permissions`.
 *
 * Se conservan los estados de rol y permiso en vez de filtrarlos antes de
 * llegar aquí: un rol retirado o un permiso retirado deben denegar de forma
 * explícita, no desaparecer silenciosamente del conjunto evaluado.
 */
export interface RoleAssignment {
  readonly scope: AssignmentScope;
  readonly status: AssignmentStatus;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly roleStatus: RoleStatus;
  readonly permissions: readonly GrantedPermission[];
}

export function createRoleAssignment(assignment: RoleAssignment): RoleAssignment {
  // `user_role_assignments_range_ck`: un rango vacío o invertido no es una
  // vigencia expresable.
  if (assignment.validUntil !== null && assignment.validUntil <= assignment.validFrom) {
    throw new AuthorizationModelError("assignment validity must end after it starts");
  }
  for (const permission of assignment.permissions) {
    if (permission.code.trim() === "") {
      throw new AuthorizationModelError("permission code must not be blank");
    }
  }
  return assignment;
}

/**
 * Vigencia temporal semiabierta `[validFrom, validUntil)`: el instante de inicio
 * está incluido y el de fin no, de modo que dos vigencias consecutivas no se
 * solapan en su frontera.
 */
export function isTemporallyValid(assignment: RoleAssignment, at: Date): boolean {
  if (at < assignment.validFrom) return false;
  if (assignment.validUntil !== null && at >= assignment.validUntil) return false;
  return true;
}

export function grantsPermission(assignment: RoleAssignment, code: string): boolean {
  return assignment.permissions.some(
    (permission) => permission.code === code && permission.status === "ACTIVE",
  );
}
