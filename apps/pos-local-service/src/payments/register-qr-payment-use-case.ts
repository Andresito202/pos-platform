import { createHash } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { PaymentProviderPort } from "./payment-provider-port.js";
import type { RegisterPaymentOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_TRANSFER_REPORT = "PAYMENTS_TRANSFER_REPORT";

export interface RegisterQrPaymentRequest {
  readonly saleId: string;
  readonly amount: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterQrPaymentResult =
  /**
   * `providerReference` here is the merchant reference (`DEC-016` §21). The
   * name is kept because it feeds the ratified `payment.register.qr` IPC
   * field of the same name; renaming that contract is a separate decision.
   */
  | { readonly kind: "PENDING"; readonly paymentId: string; readonly providerReference: string; readonly checkoutUrl: string | null }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_PAYABLE" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "PROVIDER_REJECTED" }
  | { readonly kind: "PROVIDER_REFERENCE_REQUIRED" }
  | { readonly kind: "OVERPAYMENT_NOT_ALLOWED" }
  | { readonly kind: "UNAUTHORIZED" };

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
 * payment intent.
 *
 * This use case owns the commercial identity Camacho shows the provider: it
 * passes `paymentId` as the `merchantReference` (`DEC-016` §21). Two things
 * it deliberately does not do — let the renderer choose that reference, and
 * let `idempotencyKey` become it. The key protects the local operation and
 * is caller-supplied; making it the external reference would hand a
 * caller-chosen string to a third party and tie two independent lifecycles
 * together. Approval still requires a `providerTransactionId` from
 * authorized evidence, which is a different identity again.
 */
export class RegisterQrPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly provider: PaymentProviderPort,
  ) {}

  async execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterQrPaymentRequest,
  ): Promise<RegisterQrPaymentResult> {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_TRANSFER_REPORT,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: new Date(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED" };
    const checksum = requestChecksum(request);
    const existing = this.paymentStore.findPaymentByIdempotency(scope, request.idempotencyKey, checksum);
    if (existing.kind !== "NEW") return existing;

    const context = this.paymentStore.getPaymentIntentContext(scope, request.saleId);
    if (context.kind !== "FOUND") {
      return context.kind === "NOT_FOUND"
        ? { kind: "SALE_NOT_FOUND" }
        : { kind: "SALE_NOT_PAYABLE" };
    }

    if (context.currencyCode !== "COP") return { kind: "CURRENCY_MISMATCH" };

    const paymentId = uuidV7();
    const providerIntent = await this.provider.createPaymentIntent({
      paymentId,
      saleId: request.saleId,
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      cashRegisterId: context.cashRegisterId,
      amount: request.amount,
      currencyCode: "COP",
      idempotencyKey: request.idempotencyKey,
      merchantReference: paymentId,
    });

    if (providerIntent.providerCode.trim() === "" || providerIntent.merchantReference.trim() === "") {
      return { kind: "PROVIDER_REFERENCE_REQUIRED" };
    }

    if (providerIntent.status === "REJECTED") {
      return { kind: "PROVIDER_REJECTED" };
    }

    const outcome: RegisterPaymentOutcome = this.paymentStore.register({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      saleId: request.saleId,
      amount: request.amount,
      method: "QR",
      tenderedAmount: null,
      changeAmount: null,
      providerCode: providerIntent.providerCode,
      providerReference: providerIntent.merchantReference,
      groupId: uuidV7(),
      paymentId,
      attemptId: uuidV7(),
      allocationId: uuidV7(),
      movementId: uuidV7(),
      operationId: uuidV7(),
      saleCompletionOperationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: checksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });

    if (outcome.kind === "REGISTERED") {
      return {
        kind: "PENDING",
        paymentId: outcome.paymentId,
        providerReference: providerIntent.merchantReference,
        checkoutUrl: providerIntent.checkout?.kind === "WEB_URL"
          ? providerIntent.checkout.url
          : null,
      };
    }
    if (outcome.kind === "IDEMPOTENT") return outcome;
    if (outcome.kind === "CONFIRMED") {
      throw new Error("QR provider payment must not confirm on intent creation");
    }
    if (outcome.kind === "SALE_NOT_FOUND" || outcome.kind === "SALE_NOT_PAYABLE" || outcome.kind === "SALE_ALREADY_COMPLETED" || outcome.kind === "CURRENCY_MISMATCH" || outcome.kind === "PROVIDER_REFERENCE_REQUIRED") return outcome;
    if (outcome.kind === "OVERPAYMENT_NOT_ALLOWED") return outcome;
    throw new Error(`unexpected QR registration outcome: ${outcome.kind}`);
  }
}
