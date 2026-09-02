import type { CompanyScope } from "../company-scope.js";
import { IdentityDomainError } from "../identity/identity-domain-errors.js";
import type { TenantMembership } from "../identity/tenant-membership.js";
import { TenantScope } from "../tenant-scope.js";
import type { Role } from "./role.js";

/**
 * "Asigna roles y alcance operativo dentro de una TenantMembership... no
 * puede ampliar el acceso fuera del tenant asociado" (tenant-model.md,
 * rule 6). The constructor enforces that directly: scope.tenantId must
 * equal the membership's tenantId, or construction fails — this is not a
 * runtime check bolted on later, it is impossible to build an assignment
 * that violates the rule.
 */
export class UserRoleAssignment {
  private constructor(
    readonly userId: string,
    readonly role: Role,
    readonly scope: TenantScope,
  ) {}

  static within(membership: TenantMembership, role: Role, scope: TenantScope): UserRoleAssignment {
    if (scope.tenantId !== membership.tenantId) {
      throw new IdentityDomainError(
        "ASSIGNMENT_OUTSIDE_MEMBERSHIP_TENANT",
        `assignment scope tenant ${scope.tenantId} is outside membership tenant ${membership.tenantId}`,
      );
    }
    return new UserRoleAssignment(membership.userId, role, scope);
  }

  coversScope(requested: TenantScope): boolean {
    return this.scope.equals(requested);
  }

  /**
   * Company-level resources (Catalog: "compartido por empresa") are
   * covered by ANY assignment within that tenant+company, regardless of
   * which branch it was granted for — permission-matrix.md's own "Crear
   * producto" row gives BRANCH_MANAGER an unconditional "Sí", so a
   * branch-scoped assignment already authorizes company-wide catalog
   * actions per the matrix itself; this is not a widening invented here.
   */
  coversCompany(requested: CompanyScope): boolean {
    return this.scope.tenantId === requested.tenantId && this.scope.companyId === requested.companyId;
  }
}
