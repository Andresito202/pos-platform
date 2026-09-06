import {
  roleMayAssignIdentifier,
  roleMayCreatePresentation,
  roleMayCreateProduct,
  roleMayCreateVariant,
  roleMayDeactivateProduct,
  roleMayDefineConversion,
  roleMayUpdateProduct,
  type Actor,
  type CompanyScope,
  type Role,
} from "@pos-platform/domain";
import type { CatalogAuthorizationPort } from "../ports/catalog-authorization-port.js";
import type { UserRoleAssignmentRepository } from "../ports/user-role-assignment-repository.js";

/**
 * Real CatalogAuthorizationPort implementation — same posture as
 * RoleBasedCashAuthorization: a genuine rule engine, not a test double,
 * unusable in production only because nothing can construct a real USER
 * actor yet (UC-AUTH-001 blocked) or back UserRoleAssignmentRepository
 * with real data (DDL gate).
 *
 * `canCreateVariant`/`canCreatePresentation`/`canAssignIdentifier`/
 * `canDefineConversion` fail closed for every actor and every role — B26
 * HD-01/HD-02/HD-03 and a B27 finding, respectively — because
 * `catalog-role-policy.ts`'s corresponding functions unconditionally
 * return `false` until permission-matrix.md gets a real row for each.
 */
export class RoleBasedCatalogAuthorization implements CatalogAuthorizationPort {
  constructor(private readonly assignments: UserRoleAssignmentRepository) {}

  async canCreateProduct(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayCreateProduct);
  }

  async canUpdateProduct(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayUpdateProduct);
  }

  async canDeactivateProduct(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayDeactivateProduct);
  }

  async canCreateVariant(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayCreateVariant);
  }

  async canCreatePresentation(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayCreatePresentation);
  }

  async canAssignIdentifier(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayAssignIdentifier);
  }

  async canDefineConversion(actor: Actor, scope: CompanyScope): Promise<boolean> {
    return this.check(actor, scope, roleMayDefineConversion);
  }

  private async check(actor: Actor, scope: CompanyScope, roleMay: (role: Role) => boolean): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignmentsForCompany(actor.id, scope);
    return assignments.some((assignment) => assignment.coversCompany(scope) && roleMay(assignment.role));
  }
}
