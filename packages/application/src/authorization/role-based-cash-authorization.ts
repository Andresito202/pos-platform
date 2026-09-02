import { roleMayCloseCashShift, roleMayOpenCashShift, roleMayRegisterCashWithdrawal, type Actor, type CashMovementType, type TenantScope } from "@pos-platform/domain";
import type { CashAuthorizationPort } from "../ports/cash-authorization-port.js";
import type { UserRoleAssignmentRepository } from "../ports/user-role-assignment-repository.js";

/**
 * The real CashAuthorizationPort implementation this project can honestly
 * build today: it evaluates the actual role/permission-matrix rules
 * against a real UserRoleAssignmentRepository — it is not a fake, and it
 * belongs outside tests/. What makes it currently unusable in production
 * is NOT this class: it is that nothing in this runtime can ever
 * construct a real `Actor{type:'USER'}` (UC-AUTH-001 login is not
 * implemented) or a real UserRoleAssignmentRepository adapter (DDL gate).
 * Wiring this into apps/pos-local-service before either exists would
 * silently accept a device actor as if it had proven a user identity —
 * exactly the "Authentication confusion" this block's own rules warn
 * against, which is why `type !== "USER"` is checked first and denies.
 */
export class RoleBasedCashAuthorization implements CashAuthorizationPort {
  constructor(private readonly assignments: UserRoleAssignmentRepository) {}

  async canOpenShift(actor: Actor, scope: TenantScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignments(actor.id, scope);
    return assignments.some((assignment) => assignment.coversScope(scope) && roleMayOpenCashShift(assignment.role));
  }

  async canRegisterMovement(actor: Actor, movementType: CashMovementType, scope: TenantScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    if (movementType !== "CASH_WITHDRAWAL") return false;
    const assignments = await this.assignments.listActiveAssignments(actor.id, scope);
    return assignments.some((assignment) => assignment.coversScope(scope) && roleMayRegisterCashWithdrawal(assignment.role));
  }

  async canCloseShift(actor: Actor, scope: TenantScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignments(actor.id, scope);
    return assignments.some((assignment) => assignment.coversScope(scope) && roleMayCloseCashShift(assignment.role));
  }
}
