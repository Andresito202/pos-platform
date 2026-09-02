import { roleMayCreateProduct, type Actor, type CompanyScope } from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import type { UserRoleAssignmentRepository } from "../ports/user-role-assignment-repository.js";

/**
 * Real CatalogAuthorizationPort implementation — same posture as
 * RoleBasedCashAuthorization (packages/application/src/authorization/
 * role-based-cash-authorization.ts): a genuine rule engine, not a test
 * double, unusable in production only because nothing can construct a
 * real USER actor yet (UC-AUTH-001 blocked) or back
 * UserRoleAssignmentRepository with real data (DDL gate).
 */
export class RoleBasedCatalogAuthorization implements CatalogAuthorizationPort {
  constructor(private readonly assignments: UserRoleAssignmentRepository) {}

  async canCreateProduct(actor: Actor, scope: CompanyScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignmentsForCompany(actor.id, scope);
    return assignments.some((assignment) => assignment.coversCompany(scope) && roleMayCreateProduct(assignment.role));
  }
}
