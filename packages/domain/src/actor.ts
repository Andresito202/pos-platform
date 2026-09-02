/**
 * Who performed an operation. `type` mirrors the actor_type discriminator
 * already normative in the AuditEvent conceptual model
 * (docs/architecture/conceptual-data-model.md) — a system/device actor is
 * identified by type alone, per that model's own rule 2. This runtime has
 * no User/Session yet, so 'USER' exists in the type for forward compat but
 * nothing in this vertical constructs one; using it without a real identity
 * system behind it would be exactly the fabricated auth this project
 * explicitly forbids.
 */
export type ActorType = "DEVICE" | "USER" | "SYSTEM";

export class Actor {
  private constructor(readonly type: ActorType, readonly id: string) {
    if (!id) throw new TypeError("Actor.id must not be empty");
  }

  static device(deviceId: string): Actor {
    return new Actor("DEVICE", deviceId);
  }

  equals(other: Actor): boolean {
    return this.type === other.type && this.id === other.id;
  }
}
