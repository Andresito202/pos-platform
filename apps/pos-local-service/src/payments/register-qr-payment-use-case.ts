import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { PaymentProviderPort } from "./payment-provider-port.js";
import type { RegisterPaymentOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";

export interface RegisterQrPaymentRequest {
  readonly saleId: string;
  readonly amount: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterQrPaymentResult =
  | { readonly kind: "PENDING"; readonly paymentId: string; readonly providerReference: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_PAYABLE" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "PROVIDER_REFERENCE_REQUIRED" };

function requestChecksum(request: RegisterQrPaymentRequest): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.amount,
      idempotency_key: request.idempotencyKey,
      sale_id: request.saleId,
    }))
    .digest("hex");
}

/**
 * Creates a local pending Payment only after the provider has created its
 * payment intent. The returned provider reference is retained as the
 * correlation anchor; approval still requires a separate provider transaction
 * identifier from authorized evidence.
 */
export class RegisterQrPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly provider: PaymentProviderPort,
  ) {}

  async execute(
    scope: SyncScope,
    request: RegisterQrPaymentRequest,
  ): Promise<RegisterQrPaymentResult> {
    const context = this.paymentStore.getPaymentIntentContext(scope, request.saleId);
    if (context.kind !== "FOUND") {
      return context.kind === "NOT_FOUND"
        ? { kind: "SALE_NOT_FOUND" }
        : { kind: "SALE_NOT_PAYABLE" };
    }

    const paymentId = randomUUID();
    const providerIntent = await this.provider.createPaymentIntent({
      paymentId,
      saleId: request.saleId,
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      cashRegisterId: context.cashRegisterId,
      amount: request.amount,
      currencyCode: "COP",
    });

    if (providerIntent.status === "REJECTED") {
      return { kind: "SALE_NOT_PAYABLE" };
    }

    const outcome: RegisterPaymentOutcome = this.paymentStore.register({
      scope,
      sessionId: "provider-intent",
      operatorUserId: scope.deviceId,
      saleId: request.saleId,
      amount: request.amount,
      method: "QR",
      tenderedAmount: null,
      changeAmount: null,
      providerCode: providerIntent.providerCode,
      providerReference: providerIntent.providerReference,
      groupId: randomUUID(),
      paymentId,
      attemptId: randomUUID(),
      allocationId: randomUUID(),
      movementId: randomUUID(),
      operationId: randomUUID(),
      saleCompletionOperationId: randomUUID(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });

    if (outcome.kind === "REGISTERED") {
      return {
        kind: "PENDING",
        paymentId: outcome.paymentId,
        providerReference: providerIntent.providerReference,
      };
    }
    if (outcome.kind === "IDEMPOTENT") return outcome;
    if (outcome.kind === "CONFIRMED") {
      throw new Error("QR provider payment must not confirm on intent creation");
    }
    return outcome as RegisterQrPaymentResult;
  }
}
