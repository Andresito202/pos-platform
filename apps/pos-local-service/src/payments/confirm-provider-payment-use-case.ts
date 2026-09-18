import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { PaymentProviderEvidence } from "./payment-provider-port.js";
import type {
  ConfirmProviderPaymentOutcome,
  SqlitePaymentStore,
} from "./sqlite-payment-store.js";

export interface ConfirmProviderPaymentRequest {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly evidence: PaymentProviderEvidence;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

function requestChecksum(request: ConfirmProviderPaymentRequest): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.evidence.amount,
      currency_code: request.evidence.currencyCode,
      idempotency_key: request.idempotencyKey,
      payment_id: request.paymentId,
      provider_code: request.evidence.providerCode,
      provider_reference: request.evidence.providerReference,
      provider_transaction_id: request.evidence.providerTransactionId,
      received_at: request.evidence.receivedAt,
      status: request.evidence.status,
    }))
    .digest("hex");
}

/**
 * Internal provider callback boundary.
 *
 * This use case is intentionally not an IPC operation: provider evidence is
 * accepted only from trusted infrastructure after authentication and
 * normalization. The renderer cannot assert financial authority.
 */
export class ConfirmProviderPaymentUseCase {
  constructor(private readonly paymentStore: SqlitePaymentStore) {}

  execute(
    scope: SyncScope,
    request: ConfirmProviderPaymentRequest,
  ): ConfirmProviderPaymentOutcome {
    if (request.evidence.status !== "APPROVED"
      || request.evidence.providerCode.trim() === ""
      || request.evidence.providerReference.trim() === ""
      || request.evidence.providerTransactionId.trim() === "") {
      return { kind: "EVIDENCE_NOT_AUTHORIZED" };
    }

    return this.paymentStore.confirmProviderPayment({
      scope,
      // Provider callbacks have no interactive user session. Use a UUID for this
      // trusted callback execution so the durable-sync contract remains valid.
      sessionId: randomUUID(),
      operatorUserId: scope.deviceId,
      auditActorType: "SYSTEM",
      auditActorId: null,
      paymentId: request.paymentId,
      expectedVersion: request.expectedVersion,
      providerCode: request.evidence.providerCode,
      providerReference: request.evidence.providerReference,
      providerTransactionId: request.evidence.providerTransactionId,
      amount: request.evidence.amount,
      currencyCode: request.evidence.currencyCode,
      receivedAt: request.evidence.receivedAt,
      payerReference: request.evidence.payerReference ?? null,
      allocationId: randomUUID(),
      attemptId: randomUUID(),
      saleCompletionOperationId: randomUUID(),
      operationId: randomUUID(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
