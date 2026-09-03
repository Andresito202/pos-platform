import * as z from "zod";
import { StableCodeSchema, UuidSchema } from "./primitives.js";

/**
 * Frontera de validación del modelo de autorización. El dominio
 * (`@pos-platform/domain`) no depende de Zod ni de ninguna librería: aquí se
 * valida lo que cruza una frontera y allí se decide. No es duplicación; es la
 * separación entre el DTO validado y la regla de negocio.
 */

// `USER`, `PLATFORM_ACCOUNT` y `SYSTEM` provienen de los CHECK de
// `001_central_foundation`; `DEVICE` del CHECK de `local_operation_audit`.
export const ActorTypeSchema = z.enum(["USER", "PLATFORM_ACCOUNT", "SYSTEM", "DEVICE"]);

export const PermissionCodeSchema = StableCodeSchema;

export const ActorSchema = z.strictObject({
  actor_type: ActorTypeSchema,
  actor_id: UuidSchema.nullable(),
}).superRefine((actor, context) => {
  // `(actor_type = 'SYSTEM') = (actor_id IS NULL)`.
  if (actor.actor_type === "SYSTEM" && actor.actor_id !== null) {
    context.addIssue({
      code: "custom",
      path: ["actor_id"],
      message: "SYSTEM actor must not carry an id",
    });
  }
  if (actor.actor_type !== "SYSTEM" && actor.actor_id === null) {
    context.addIssue({
      code: "custom",
      path: ["actor_id"],
      message: `${actor.actor_type} actor requires an id`,
    });
  }
});

/**
 * Ámbito de una operación. Nunca se acepta desde el cliente: lo construye el
 * servidor a partir de su contexto de ejecución. Este esquema existe para
 * validar ese contexto, no para recibirlo por la frontera.
 */
export const AuthorizationScopeSchema = z.strictObject({
  tenant_id: UuidSchema,
  company_id: UuidSchema.nullable(),
  branch_id: UuidSchema.nullable(),
}).superRefine((scope, context) => {
  // `user_role_assignments_branch_scope_ck`.
  if (scope.branch_id !== null && scope.company_id === null) {
    context.addIssue({
      code: "custom",
      path: ["branch_id"],
      message: "a branch scope requires a company",
    });
  }
});

export type ActorType = z.infer<typeof ActorTypeSchema>;
export type PermissionCode = z.infer<typeof PermissionCodeSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type AuthorizationScope = z.infer<typeof AuthorizationScopeSchema>;
