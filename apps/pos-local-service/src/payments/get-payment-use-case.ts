import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { PaymentView, SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_PAYMENT_READ = "PAYMENTS_PAYMENT_READ";

export interface GetPaymentRequest {
  readonly paymentId: string;
}

export type GetPaymentResult =
  | { readonly kind: "FOUND"; readonly payment: PaymentView }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Consulta de un pago.
 *
 * El ámbito procede de la configuración local, de modo que un pago de otro
 * tenant no es visible: la consulta filtra por `tenant_id` confiable y devuelve
 * `NOT_FOUND`, sin distinguir «no existe» de «no es tuyo».
 */
export class GetPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: GetPaymentRequest,
  ): GetPaymentResult {
    const actor = createActor("USER", authSnapshot.claims.user_id);

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_PAYMENT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.paymentStore.get(scope, request.paymentId);
  }
}
