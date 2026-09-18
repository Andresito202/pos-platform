import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { InsufficientStockOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_TRANSFER_CONFIRM = "PAYMENTS_TRANSFER_CONFIRM";

export interface ConfirmTransferPaymentRequest {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ConfirmTransferPaymentResult =
  | {
      readonly kind: "CONFIRMED";
      readonly paymentId: string;
      readonly saleCompleted: boolean;
      readonly confirmedCoverage: string;
      readonly payableAmount: string;
    }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "PAYMENT_NOT_CONFIRMABLE" }
  | { readonly kind: "VERSION_CONFLICT" }
  | { readonly kind: "OVERPAYMENT_NOT_ALLOWED" }
  | InsufficientStockOutcome
  | { readonly kind: "SALE_ALREADY_COMPLETED" };

function requestChecksum(request: ConfirmTransferPaymentRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      expected_version: request.expectedVersion,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      payment_id: request.paymentId,
    }))
    .digest("hex");
}

/**
 * `UC-PAY-003` — confirmación por atestiguación manual.
 *
 * Es el punto en que una transferencia produce cobertura y, si con ello la
 * venta queda cubierta, **la completa en la misma transacción**.
 *
 * El permiso es distinto del de reporte: quien atestigua asume la
 * responsabilidad financiera del hecho.
 */
export class ConfirmTransferPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ConfirmTransferPaymentRequest,
  ): ConfirmTransferPaymentResult {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_TRANSFER_CONFIRM,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.paymentStore.confirmTransfer({
      scope,
      sessionId,
      operatorUserId,
      paymentId: request.paymentId,
      expectedVersion: request.expectedVersion,
      allocationId: randomUUID(),
      attemptId: randomUUID(),
      operationId: randomUUID(),
      saleCompletionOperationId: randomUUID(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
