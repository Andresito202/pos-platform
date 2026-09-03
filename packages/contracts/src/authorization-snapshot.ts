import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";
import { PermissionCodeSchema } from "./authorization.js";

/**
 * Contrato del Signed Authorization Snapshot (DEC-011). Es la frontera de
 * validación de la proyección de autorización que la autoridad central emite
 * hacia el POS Local Service.
 *
 * El sobre `{ claims, signature }` replica deliberadamente `SignedLicenseSchema`:
 * ambos son artefactos firmados con Ed25519 sobre `canonicalJson(claims)` y se
 * verifican con la misma maquinaria. No se introduce un segundo mecanismo.
 *
 * Un snapshot que satisfaga este esquema **no está autorizado por ello**. Este
 * contrato valida forma; la autoridad la establece la verificación de firma,
 * el binding y la vigencia.
 */

export const AssignmentStatusSchema = z.enum(["ACTIVE", "REVOKED"]);
export const RoleStatusSchema = z.enum(["ACTIVE", "RETIRED"]);
export const PermissionStatusSchema = z.enum(["ACTIVE", "RETIRED"]);

/**
 * Los estados se transportan explícitamente en vez de filtrarse en el emisor:
 * un rol retirado o un permiso retirado deben denegar de forma expresa y no
 * desaparecer del conjunto evaluado.
 */
export const GrantedPermissionSchema = z.strictObject({
  code: PermissionCodeSchema,
  status: PermissionStatusSchema,
});

// Cotas de tamaño para impedir un payload no acotado. No son reglas de negocio.
const MAX_ASSIGNMENTS = 64;
const MAX_PERMISSIONS_PER_ASSIGNMENT = 256;

export const SnapshotAssignmentSchema = z.strictObject({
  tenant_id: UuidSchema,
  company_id: UuidSchema.nullable(),
  branch_id: UuidSchema.nullable(),
  status: AssignmentStatusSchema,
  valid_from: UtcDateTimeSchema,
  valid_until: UtcDateTimeSchema.nullable(),
  role_status: RoleStatusSchema,
  permissions: z.array(GrantedPermissionSchema).max(MAX_PERMISSIONS_PER_ASSIGNMENT),
}).superRefine((assignment, context) => {
  // `user_role_assignments_branch_scope_ck`: una sucursal sin empresa no es un
  // ámbito expresable en el modelo central.
  if (assignment.branch_id !== null && assignment.company_id === null) {
    context.addIssue({
      code: "custom",
      path: ["branch_id"],
      message: "a branch scope requires a company",
    });
  }
  // `user_role_assignments_range_ck`, con vigencia semiabierta [from, until).
  if (
    assignment.valid_until !== null
    && Date.parse(assignment.valid_until) <= Date.parse(assignment.valid_from)
  ) {
    context.addIssue({
      code: "custom",
      path: ["valid_until"],
      message: "valid_until must be later than valid_from",
    });
  }
  const codes = assignment.permissions.map((permission) => permission.code);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({
      code: "custom",
      path: ["permissions"],
      message: "permission codes must be unique within an assignment",
    });
  }
});

export const AuthorizationSnapshotClaimsSchema = z.strictObject({
  snapshot_id: UuidSchema,
  // Binding completo exigido por DEC-011: instalación, dispositivo y usuario.
  user_id: UuidSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  // La monotonía es responsabilidad del emisor. Aquí solo se valida la forma;
  // la regla "sequence > máxima aceptada" pertenece al estado local persistido.
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issued_at: UtcDateTimeSchema,
  // No admite null, a diferencia de la licencia: DEC-011 exige vigencia acotada
  // y no contempla un snapshot de autorización perpetuo.
  expires_at: UtcDateTimeSchema,
  assignments: z.array(SnapshotAssignmentSchema).max(MAX_ASSIGNMENTS),
  key_id: StableCodeSchema,
}).superRefine((claims, context) => {
  if (Date.parse(claims.expires_at) <= Date.parse(claims.issued_at)) {
    context.addIssue({
      code: "custom",
      path: ["expires_at"],
      message: "expires_at must be later than issued_at",
    });
  }
  const ids = claims.assignments.map(
    (assignment) => `${assignment.tenant_id}|${assignment.company_id ?? ""}|${assignment.branch_id ?? ""}`,
  );
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["assignments"],
      message: "assignments must not repeat a scope",
    });
  }
});

export const SignedAuthorizationSnapshotSchema = z.strictObject({
  claims: AuthorizationSnapshotClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;
export type RoleStatus = z.infer<typeof RoleStatusSchema>;
export type PermissionStatus = z.infer<typeof PermissionStatusSchema>;
export type GrantedPermission = z.infer<typeof GrantedPermissionSchema>;
export type SnapshotAssignment = z.infer<typeof SnapshotAssignmentSchema>;
export type AuthorizationSnapshotClaims = z.infer<typeof AuthorizationSnapshotClaimsSchema>;
export type SignedAuthorizationSnapshot = z.infer<typeof SignedAuthorizationSnapshotSchema>;
