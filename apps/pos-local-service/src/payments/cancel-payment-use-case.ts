import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7, CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_PAYMENT_CANCEL = CanonicalPermission.PAYMENTS_PAYMENT_CANCEL;

export interface CancelPaymentRequest {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type CancelPaymentResult =
  | { readonly kind: "CANCELLED"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "PAYMENT_NOT_CANCELLABLE" }
  | { readonly kind: "VERSION_CONFLICT" };

function requestChecksum(request: CancelPaymentRequest, operatorUserId: string): string {
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
 * Cancela un pago **no confirmado**, liberando a la venta de un componente que
 * el operador abandonó.
 *
 * Un pago confirmado es inmutable: `DEC-002` prohíbe su sobrescritura
 * destructiva, y deshacerlo es una operación compensatoria (`Refund` /
 * `Reversal`) que V1 no implementa. Por eso `PAYMENT_NOT_CANCELLABLE` no es un
 * fallo de la operación sino la regla financiera funcionando.
 */
export class CancelPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: CancelPaymentRequest,
  ): CancelPaymentResult {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_PAYMENT_CANCEL,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.paymentStore.cancel({
      scope,
      sessionId,
      operatorUserId,
      paymentId: request.paymentId,
      expectedVersion: request.expectedVersion,
      operationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
