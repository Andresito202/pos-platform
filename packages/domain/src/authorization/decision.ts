import { AuthorizationModelError } from "./errors.js";
import { canHoldBusinessPermissions, type Actor } from "./actor.js";
import { assignmentCoversOperation, type OperationScope } from "./scope.js";
import { grantsPermission, isTemporallyValid, type RoleAssignment } from "./assignment.js";

export const DENIAL_REASONS = [
  "ACTOR_TYPE_CANNOT_HOLD_PERMISSIONS",
  "NO_MATCHING_ASSIGNMENT",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenialReason };

export interface PermissionRequest {
  readonly actor: Actor;
  readonly permission: string;
  readonly scope: OperationScope;
  readonly at: Date;
  readonly assignments: readonly RoleAssignment[];
}

const DENIED_BY_ACTOR_TYPE: AuthorizationDecision = {
  allowed: false,
  reason: "ACTOR_TYPE_CANNOT_HOLD_PERMISSIONS",
};

const DENIED_BY_NO_ASSIGNMENT: AuthorizationDecision = {
  allowed: false,
  reason: "NO_MATCHING_ASSIGNMENT",
};

/**
 * Decide si un actor tiene un permiso de negocio en un ámbito y un instante
 * concretos. Es una función pura: no consulta, no persiste y no depende de
 * infraestructura.
 *
 * Falla cerrado. Deniega salvo que exista al menos una asignación que supere
 * simultáneamente las cinco condiciones del modelo: asignación no revocada, rol
 * no retirado, vigencia temporal, ámbito alcanzado y permiso concedido y
 * activo. Una sola condición incumplida descarta la asignación completa.
 *
 * La razón de denegación es deliberadamente gruesa: distinguir "existe la
 * asignación pero expiró" de "no existe" revelaría a un llamador no autorizado
 * la estructura de permisos del tenant.
 */
export function evaluatePermission(request: PermissionRequest): AuthorizationDecision {
  if (request.permission.trim() === "") {
    throw new AuthorizationModelError("permission code must not be blank");
  }

  // Un actor que no puede portar roles nunca obtiene un permiso de negocio,
  // aunque se le pasen asignaciones: no existe ruta hacia un rol para él.
  if (!canHoldBusinessPermissions(request.actor.type)) return DENIED_BY_ACTOR_TYPE;

  // Un `USER` siempre tiene id por construcción de `createActor`; se comprueba
  // igualmente para que un objeto ensamblado a mano no obtenga permisos.
  if (request.actor.id === null || request.actor.id.trim() === "") {
    return DENIED_BY_ACTOR_TYPE;
  }

  for (const assignment of request.assignments) {
    if (assignment.status !== "ACTIVE") continue;
    if (assignment.roleStatus !== "ACTIVE") continue;
    if (!isTemporallyValid(assignment, request.at)) continue;
    if (!assignmentCoversOperation(assignment.scope, request.scope)) continue;
    if (!grantsPermission(assignment, request.permission)) continue;
    return { allowed: true };
  }

  return DENIED_BY_NO_ASSIGNMENT;
}
