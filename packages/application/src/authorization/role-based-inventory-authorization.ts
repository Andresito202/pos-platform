import {
  roleMayAdjustInventory,
  roleMayConsumeInventoryReservation,
  roleMayRegisterWaste,
  roleMayReleaseInventoryReservation,
  roleMayReserveInventory,
  roleMayTransferInventory,
  type Actor,
  type CompanyScope,
  type Role,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { UserRoleAssignmentRepository } from "../ports/user-role-assignment-repository.js";

/**
 * Real InventoryAuthorizationPort implementation — same posture as
 * RoleBasedCashAuthorization/RoleBasedCatalogAuthorization: a genuine rule
 * engine, unusable in production only because no real USER actor can be
 * constructed yet (UC-AUTH-001 blocked) and no adapter backs
 * UserRoleAssignmentRepository (DDL gate).
 *
 * `canReserveInventory`/`canConsumeInventoryReservation`/
 * `canReleaseInventoryReservation` fail closed for every actor — B31's
 * `ARCHITECTURAL DECISION`: no permission-matrix.md row exists for these,
 * and no real calling process (Sales) exists yet to inherit authorization
 * from.
 */
export class RoleBasedInventoryAuthorization implements InventoryAuthorizationPort {
  constructor(private readonly assignments: UserRoleAssignmentRepository) {}

  async canAdjustInventory(actor: Actor, scope: TenantScope): Promise<boolean> {
    return this.checkTenantScoped(actor, scope, roleMayAdjustInventory);
  }

  async canRegisterWaste(actor: Actor, scope: TenantScope): Promise<boolean> {
    return this.checkTenantScoped(actor, scope, roleMayRegisterWaste);
  }

  async canTransferInventory(actor: Actor, scope: CompanyScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignmentsForCompany(actor.id, scope);
    return assignments.some((assignment) => assignment.coversCompany(scope) && roleMayTransferInventory(assignment.role));
  }

  async canReserveInventory(actor: Actor, scope: TenantScope): Promise<boolean> {
    return this.checkTenantScoped(actor, scope, roleMayReserveInventory);
  }

  async canConsumeInventoryReservation(actor: Actor, scope: TenantScope): Promise<boolean> {
    return this.checkTenantScoped(actor, scope, roleMayConsumeInventoryReservation);
  }

  async canReleaseInventoryReservation(actor: Actor, scope: TenantScope): Promise<boolean> {
    return this.checkTenantScoped(actor, scope, roleMayReleaseInventoryReservation);
  }

  private async checkTenantScoped(actor: Actor, scope: TenantScope, roleMay: (role: Role) => boolean): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignments(actor.id, scope);
    return assignments.some((assignment) => assignment.coversScope(scope) && roleMay(assignment.role));
  }
}
