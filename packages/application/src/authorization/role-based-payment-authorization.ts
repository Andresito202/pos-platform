import { roleMayInitiatePayment, type Actor, type TenantScope } from "@pos-platform/domain";
import type { PaymentAuthorizationPort } from "../ports/payment-authorization-port.js";
import type { UserRoleAssignmentRepository } from "../ports/user-role-assignment-repository.js";

/**
 * Real PaymentAuthorizationPort implementation — same posture as
 * RoleBasedCatalogAuthorization: a genuine rule engine, not a test
 * double, unusable in production only because nothing can construct a
 * real USER actor yet (UC-AUTH-001 blocked) or back
 * UserRoleAssignmentRepository with real data (DDL gate).
 *
 * `canInitiatePayment` fails closed for every role — `roleMayInitiatePayment`
 * unconditionally returns `false` until `payments.transfer.report` gets a
 * real permission-matrix.md row.
 */
export class RoleBasedPaymentAuthorization implements PaymentAuthorizationPort {
  constructor(private readonly assignments: UserRoleAssignmentRepository) {}

  async canInitiatePayment(actor: Actor, scope: TenantScope): Promise<boolean> {
    if (actor.type !== "USER") return false;
    const assignments = await this.assignments.listActiveAssignments(actor.id, scope);
    return assignments.some((assignment) => assignment.coversScope(scope) && roleMayInitiatePayment(assignment.role));
  }
}
