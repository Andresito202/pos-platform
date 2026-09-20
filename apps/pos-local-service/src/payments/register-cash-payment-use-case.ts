import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { InsufficientStockOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_PAYMENT_REGISTER = "PAYMENTS_PAYMENT_REGISTER";

export interface RegisterCashPaymentRequest {
  readonly saleId: string;
  readonly amount: string;
  /** Efectivo entregado por el cliente. Opcional; sólo forense (`DEC-016` §10.5). */
  readonly tenderedAmount: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterCashPaymentResult =
  | {
      readonly kind: "CONFIRMED";
      readonly paymentId: string;
      readonly saleCompleted: boolean;
      readonly confirmedCoverage: string;
      readonly payableAmount: string;
      readonly changeAmount: string | null;
    }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_PAYABLE" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | InsufficientStockOutcome
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "OVERPAYMENT_NOT_ALLOWED" }
  | { readonly kind: "CASH_SHIFT_MISSING" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" }
  | { readonly kind: "INSUFFICIENT_TENDER" };

function requestChecksum(request: RegisterCashPaymentRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.amount,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      sale_id: request.saleId,
      tendered_amount: request.tenderedAmount,
    }))
    .digest("hex");
}

/**
 * `UC-PAY-001` en su variante efectivo — `DEC-016` §5.
 *
 * El efectivo es autoridad local: registrar es confirmar. La operación imputa,
 * asienta en caja y, si con ello la cobertura queda completa, completa la venta
 * — todo en una sola transacción.
 */
export class RegisterCashPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterCashPaymentRequest,
  ): RegisterCashPaymentResult {
    const at = this.now();

    // 1. Actor USER del snapshot verificado — nunca del llamador.
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_PAYMENT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    // 2. Vuelto: lo calcula la capa confiable, no el llamador.
    let changeAmount: string | null = null;
    if (request.tenderedAmount !== null) {
      const tendered = scale6ToBigInt(request.tenderedAmount);
      const amount = scale6ToBigInt(request.amount);
      if (tendered < amount) return { kind: "INSUFFICIENT_TENDER" };
      changeAmount = bigIntToScale6(tendered - amount);
    }

    const outcome = this.paymentStore.register({
      scope,
      sessionId,
      operatorUserId,
      saleId: request.saleId,
      amount: request.amount,
      method: "CASH",
      tenderedAmount: request.tenderedAmount,
      changeAmount,
      providerCode: null,
      providerReference: null,
      groupId: randomUUID(),
      paymentId: randomUUID(),
      attemptId: randomUUID(),
      allocationId: randomUUID(),
      movementId: randomUUID(),
      operationId: uuidV7(),
      saleCompletionOperationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });

    if (outcome.kind === "CONFIRMED") {
      return {
        kind: "CONFIRMED",
        paymentId: outcome.paymentId,
        saleCompleted: outcome.saleCompleted,
        confirmedCoverage: outcome.confirmedCoverage,
        payableAmount: outcome.payableAmount,
        changeAmount,
      };
    }
    if (outcome.kind === "IDEMPOTENT") return { kind: "IDEMPOTENT", paymentId: outcome.paymentId };
    if (outcome.kind === "REGISTERED") {
      // Inalcanzable: el efectivo confirma siempre. Se trata como defecto.
      throw new Error("cash payment must confirm on registration");
    }
    if (outcome.kind === "PROVIDER_REFERENCE_REQUIRED") throw new Error("cash payment cannot require provider reference");
    if (outcome.kind === "CUSTOMER_REQUIRED"
      || outcome.kind === "CREDIT_ACCOUNT_NOT_FOUND"
      || outcome.kind === "CREDIT_LIMIT_EXCEEDED"
      || outcome.kind === "CREDIT_NOT_AVAILABLE") {
      // Exclusivos de `CUSTOMER_CREDIT`: el efectivo no los puede producir.
      throw new Error(`unreachable outcome for cash registration: ${outcome.kind}`);
    }
    return outcome;
  }
}
