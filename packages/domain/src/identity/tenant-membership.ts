export type TenantMembershipType = "OWNER" | "ADMIN" | "MEMBER" | "SERVICE";
export type TenantMembershipStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

/**
 * "Relaciona explícitamente un User con un Tenant. Es la autoridad de
 * pertenencia... Una pertenencia no concede por sí sola todos los
 * permisos" (tenant-model.md). Only OWNER/ADMIN/MEMBER/SERVICE are
 * modeled — the exact four types the document names, transcribed.
 */
export class TenantMembership {
  private constructor(
    readonly userId: string,
    readonly tenantId: string,
    readonly membershipType: TenantMembershipType,
    readonly status: TenantMembershipStatus,
  ) {}

  static active(userId: string, tenantId: string, membershipType: TenantMembershipType): TenantMembership {
    if (!userId) throw new TypeError("TenantMembership.userId must not be empty");
    if (!tenantId) throw new TypeError("TenantMembership.tenantId must not be empty");
    return new TenantMembership(userId, tenantId, membershipType, "ACTIVE");
  }

  isActive(): boolean {
    return this.status === "ACTIVE";
  }
}
