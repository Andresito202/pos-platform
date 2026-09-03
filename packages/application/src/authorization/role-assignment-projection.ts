import {
  createAssignmentScope,
  createRoleAssignment,
  type RoleAssignment,
} from "@pos-platform/domain";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";

/**
 * Proyecta las asignaciones de un Signed Authorization Snapshot ya verificado a
 * los `RoleAssignment[]` que consume `evaluatePermission()` (AUTHZ-001).
 *
 * Es una traducción, no un motor: no decide nada. Toda la decisión sigue
 * viviendo en `evaluatePermission()`, que permanece intacto. En particular, un
 * actor `DEVICE` no obtiene permisos de negocio por esta vía: la restricción
 * está en el dominio, y proyectar asignaciones no la altera.
 *
 * Vive en la capa `application` porque traduce entre `contracts` y `domain`, y
 * `runtime` no puede depender de `domain` según module-boundaries.json.
 */
export function toRoleAssignments(claims: AuthorizationSnapshotClaims): RoleAssignment[] {
  return claims.assignments.map((assignment) =>
    // Se construye a través de la factory del dominio para que las invariantes
    // se validen aquí y no se confíe en que el emisor las respetó.
    createRoleAssignment({
      scope: createAssignmentScope(
        assignment.tenant_id,
        assignment.company_id,
        assignment.branch_id,
      ),
      status: assignment.status,
      validFrom: new Date(assignment.valid_from),
      validUntil: assignment.valid_until === null ? null : new Date(assignment.valid_until),
      roleStatus: assignment.role_status,
      permissions: assignment.permissions.map((permission) => ({
        code: permission.code,
        status: permission.status,
      })),
    }),
  );
}
