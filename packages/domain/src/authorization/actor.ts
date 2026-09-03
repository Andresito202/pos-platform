import { AuthorizationModelError } from "./errors.js";

/**
 * Tipos de actor reconocidos por el modelo. `USER` y `PLATFORM_ACCOUNT` y
 * `SYSTEM` provienen de los CHECK de `001_central_foundation`; `DEVICE` del
 * CHECK de `local_operation_audit` en SQLite.
 */
export const ACTOR_TYPES = ["USER", "PLATFORM_ACCOUNT", "SYSTEM", "DEVICE"] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

export interface Actor {
  readonly type: ActorType;
  /** Nulo únicamente para `SYSTEM`, conforme al CHECK del modelo central. */
  readonly id: string | null;
}

/**
 * Un rol solo puede asignarse a un usuario: `authorization.user_role_assignments`
 * referencia `tenancy.tenant_memberships`, que a su vez referencia
 * `identity.users`. No existe ninguna ruta desde un dispositivo o el sistema
 * hacia un rol, de modo que ningún actor distinto de `USER` puede portar un
 * permiso de negocio. Esto no es una restricción de conveniencia: es la forma
 * del modelo ya materializado.
 */
export function canHoldBusinessPermissions(actorType: ActorType): boolean {
  return actorType === "USER";
}

export function createActor(type: ActorType, id: string | null): Actor {
  if (!ACTOR_TYPES.includes(type)) {
    throw new AuthorizationModelError(`unknown actor type: ${String(type)}`);
  }
  // `(actor_type = 'SYSTEM') = (actor_id IS NULL)` en el modelo central.
  if (type === "SYSTEM" && id !== null) {
    throw new AuthorizationModelError("SYSTEM actor must not carry an id");
  }
  if (type !== "SYSTEM") {
    if (id === null) throw new AuthorizationModelError(`${type} actor requires an id`);
    if (id.trim() === "") throw new AuthorizationModelError(`${type} actor id must not be blank`);
  }
  return { type, id };
}
