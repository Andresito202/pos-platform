import { roleMayAdjustInventory, type Actor, type TenantScope } from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { UserRoleAssignmentRepository } from "../ports/user-role-assignment-repository.js";

/**
 * Real InventoryAuthorizationPort implementation — same posture as
 * RoleBasedCashAuthorization/RoleBasedCatalogAuthorization: a genuine rule
 * engine, unusable in production only because no real USER actor can be
 * constructed yet (UC-AUTH-001 blocked) and no adapter backs
 * UserRoleAssignmentRepository (DDL gate).
 */
export class RoleBasedInventoryAuthorization implements InventoryAuthorizationPort {
  constructor(private readonly assignments: UserRoleAssignmentRepository) {}

  async canAdjustInventory(actor: Actor, scope: TenantScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignments(actor.id, scope);
    return assignments.some((assignment) => assignment.coversScope(scope) && roleMayAdjustInventory(assignment.role));
  }
}
