import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { RegisterPaymentOutcome, SqlitePaymentStore } from "../payments/sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_CREDIT_AUTHORIZE = "PAYMENTS_CREDIT_AUTHORIZE";

export interface RegisterCreditPaymentRequest {
  readonly saleId: string;
  readonly amount: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterCreditPaymentResult =
  | RegisterPaymentOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(request: RegisterCreditPaymentRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.amount,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      sale_id: request.saleId,
    }))
    .digest("hex");
}

/**
 * Cobra una venta a crédito: `CUSTOMER_CREDIT` cubre la cobertura y la
 * obligación queda en el libro del cliente (`DEC-005`).
 *
 * **No es un sistema de pagos paralelo.** Reutiliza `SqlitePaymentStore.register`
 * entero: el mismo `Payment`, el mismo intento, la misma imputación, la misma
 * guarda de sobrepago y el mismo `completeSaleIfCovered` que completa la venta
 * y saca la mercancía. Lo único que cambia respecto del efectivo es que no hay
 * turno que exigir ni caja donde asentar, y que además nace una deuda.
 *
 * Autorizar una venta fiada es una facultad propia: `DEC-002` §159 exige que
 * la aprobación quede auditada, y auditarla sólo significa algo si alguien
 * concreto tuvo que tenerla.
 */
export class RegisterCreditPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterCreditPaymentRequest,
  ): RegisterCreditPaymentResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_PAYMENTS_CREDIT_AUTHORIZE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.paymentStore.register({
      scope,
      sessionId,
      operatorUserId,
      saleId: request.saleId,
      amount: request.amount,
      method: "CUSTOMER_CREDIT",
      tenderedAmount: null,
      changeAmount: null,
      providerCode: null,
      providerReference: null,
      groupId: randomUUID(),
      paymentId: randomUUID(),
      attemptId: randomUUID(),
      allocationId: randomUUID(),
      creditTransactionId: randomUUID(),
      // El crédito no asienta en caja, pero `register` exige la identidad del
      // movimiento por contrato: se genera y no se usa.
      movementId: randomUUID(),
      operationId: randomUUID(),
      saleCompletionOperationId: randomUUID(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
