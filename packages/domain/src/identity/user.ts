export type UserStatus = "ACTIVE" | "INACTIVE";

/**
 * "User... representa la identidad autenticable global... No utiliza
 * tenant_id como autoridad de pertenencia" (docs/architecture/tenant-model.md).
 * Deliberately has NO password/credential/MFA field: UC-AUTH-001 (login)
 * requires those, and this repository has not chosen a concrete
 * authentication mechanism (hashing algorithm, token format, session
 * store) — inventing one here would be exactly the fabricated security
 * this block's rules forbid. This type exists only so TenantMembership /
 * UserRoleAssignment have a real identity to reference.
 */
export class User {
  private constructor(readonly id: string, readonly status: UserStatus) {}

  static active(id: string): User {
    if (!id) throw new TypeError("User.id must not be empty");
    return new User(id, "ACTIVE");
  }

  isActive(): boolean {
    return this.status === "ACTIVE";
  }
}
