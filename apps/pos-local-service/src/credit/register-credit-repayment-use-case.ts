import { createHash, randomUUID } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { RegisterRepaymentOutcome, SqliteCreditStore } from "./sqlite-credit-store.js";

export const PERMISSION_CUSTOMERS_CREDIT_REPAYMENT_REGISTER = "CUSTOMERS_CREDIT_REPAYMENT_REGISTER";

export interface RegisterCreditRepaymentRequest {
  readonly customerId: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly method: "CASH" | "TRANSFER";
  /** Caja donde entra el efectivo. Obligatoria si `method` es `CASH`. */
  readonly cashRegisterId: string | null;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterCreditRepaymentResult =
  | RegisterRepaymentOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(request: RegisterCreditRepaymentRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.amount,
      currency_code: request.currencyCode,
      customer_id: request.customerId,
      idempotency_key: request.idempotencyKey,
      method: request.method,
      operator_user_id: operatorUserId,
    }))
    .digest("hex");
}

/**
 * Registra un abono de un cliente contra su deuda.
 *
 * **Un abono no es el pago de una venta.** No crea `Payment`, no imputa en
 * `payments_payment_allocations` y no completa nada: las ventas que originaron
 * la deuda ya se completaron al fiarlas. Paga una obligación, no un cobro
 * pendiente — y de hecho no podría hacerlo de otro modo, porque
 * `collection_subject_type` sólo admite `'SALE'`.
 *
 * Lo que sí hace es reducir el saldo, y con ello liberar cupo. En efectivo,
 * además, el dinero entra al cajón como `CASH_PAYMENT` por el puerto de caja:
 * es efectivo realmente recibido, así que la caja sí lo registra
 * (`DEC-002` §146 regla 10).
 */
export class RegisterCreditRepaymentUseCase {
  constructor(
    private readonly creditStore: SqliteCreditStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterCreditRepaymentRequest,
  ): RegisterCreditRepaymentResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CUSTOMERS_CREDIT_REPAYMENT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.creditStore.registerRepayment({
      scope,
      sessionId,
      operatorUserId,
      transactionId: randomUUID(),
      customerId: request.customerId,
      amount: request.amount,
      currencyCode: request.currencyCode,
      method: request.method,
      cashRegisterId: request.cashRegisterId,
      movementId: randomUUID(),
      businessDate: request.businessDate,
      operationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
