import { PermissionCode } from "@pos-platform/contracts";
import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { InsufficientStockOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_TRANSFER_REPORT = PermissionCode.PAYMENTS_TRANSFER_REPORT;

export interface RegisterTransferPaymentRequest {
  readonly saleId: string;
  readonly amount: string;
  /** Metadato de atestiguación (p. ej. `NEQUI`). No es autoridad ni SDK. */
  readonly providerCode: string | null;
  /** Comprobante que el operador transcribe. No prueba nada por sí solo. */
  readonly providerReference: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterTransferPaymentResult =
  | { readonly kind: "REGISTERED"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_PAYABLE" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | InsufficientStockOutcome;

function requestChecksum(request: RegisterTransferPaymentRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.amount,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      provider_code: request.providerCode,
      provider_reference: request.providerReference,
      sale_id: request.saleId,
    }))
    .digest("hex");
}

/**
 * `UC-PAY-003` — reporte de una transferencia, sin confirmarla.
 *
 * El pago queda en `CREATED` y **no imputa**: sin imputación no hay cobertura, y
 * sin cobertura la venta no puede completarse. Confirmar es un acto separado con
 * permiso propio, de modo que reportar y confirmar puedan exigirse a personas
 * distintas (`DEC-016` §8).
 */
export class RegisterTransferPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterTransferPaymentRequest,
  ): RegisterTransferPaymentResult {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_TRANSFER_REPORT,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const outcome = this.paymentStore.register({
      scope,
      sessionId,
      operatorUserId,
      saleId: request.saleId,
      amount: request.amount,
      method: "TRANSFER",
      tenderedAmount: null,
      changeAmount: null,
      providerCode: request.providerCode,
      providerReference: request.providerReference,
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

    if (outcome.kind === "REGISTERED") return { kind: "REGISTERED", paymentId: outcome.paymentId };
    if (outcome.kind === "IDEMPOTENT") return { kind: "IDEMPOTENT", paymentId: outcome.paymentId };
    if (outcome.kind === "CONFIRMED") {
      // Inalcanzable: una transferencia nunca confirma al registrarse.
      throw new Error("transfer payment must not confirm on registration");
    }
    if (outcome.kind === "OVERPAYMENT_NOT_ALLOWED"
      || outcome.kind === "CASH_SHIFT_MISSING"
      || outcome.kind === "CASH_SHIFT_NOT_OPEN") {
      throw new Error(`unreachable outcome for transfer registration: ${outcome.kind}`);
    }
    return outcome;
  }
}
