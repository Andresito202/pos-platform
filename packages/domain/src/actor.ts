/**
 * Who performed an operation. `type` mirrors the actor_type discriminator
 * already normative in the AuditEvent conceptual model
 * (docs/architecture/conceptual-data-model.md) — a system/device actor is
 * identified by type alone, per that model's own rule 2.
 *
 * `forUser` (added for SEC-003/authorization) constructs the shape only —
 * it does not authenticate anyone. Constructing one does not mean a real
 * login happened; RoleBasedCashAuthorization treats a USER actor as
 * "claims to be this user" and still requires a real, scope-covering
 * UserRoleAssignment to authorize anything. No file under apps/ calls
 * `forUser` — there is no login flow (UC-AUTH-001) to produce a
 * genuinely authenticated id, so nothing in the runtime can legitimately
 * call it yet. It exists so the authorization engine's ALLOW path is
 * actually tested, not just its DENY path.
 */
export type ActorType = "DEVICE" | "USER" | "SYSTEM";

export class Actor {
  private constructor(readonly type: ActorType, readonly id: string) {
    if (!id) throw new TypeError("Actor.id must not be empty");
  }

  static device(deviceId: string): Actor {
    return new Actor("DEVICE", deviceId);
  }

  static forUser(userId: string): Actor {
    return new Actor("USER", userId);
  }

  equals(other: Actor): boolean {
    return this.type === other.type && this.id === other.id;
  }
}
