import { CanonicalPermission } from "@pos-platform/contracts";
import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { InsufficientStockOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";
import { FactusPayClient, FactusPayClientError } from "./factus-pay-client.js";

export const PERMISSION_FACTUS_PAY_VERIFY = CanonicalPermission.PAYMENTS_PAYMENT_REGISTER;

const PROVIDER_CODE = "FACTUS_PAY";

export interface VerifyFactusPayCollectionRequest {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type VerifyFactusPayCollectionResult =
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
  | { readonly kind: "PAYMENT_NOT_FACTUS_PAY" }
  | { readonly kind: "VERSION_CONFLICT" }
  | { readonly kind: "OVERPAYMENT_NOT_ALLOWED" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | { readonly kind: "FACTUS_PAY_NOT_CONFIGURED" }
  | { readonly kind: "FACTUS_PAY_NOT_PAID" }
  | { readonly kind: "FACTUS_PAY_VERIFICATION_FAILED" }
  | InsufficientStockOutcome
  | { readonly kind: "PHARMACY_ELIGIBILITY_LOST"; readonly reason: string };

function requestChecksum(request: VerifyFactusPayCollectionRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      expected_version: request.expectedVersion,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      payment_id: request.paymentId,
    }))
    .digest("hex");
}

export class VerifyFactusPayCollectionUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly factusPay: FactusPayClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: VerifyFactusPayCollectionRequest,
  ): Promise<VerifyFactusPayCollectionResult> {
    if (this.factusPay === null) return { kind: "FACTUS_PAY_NOT_CONFIGURED" };

    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_FACTUS_PAY_VERIFY,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const found = this.paymentStore.get(scope, request.paymentId);
    if (found.kind === "NOT_FOUND") return { kind: "PAYMENT_NOT_FOUND" };
    const payment = found.payment;
    if (payment.method !== "QR" || payment.providerCode !== PROVIDER_CODE) {
      return { kind: "PAYMENT_NOT_FACTUS_PAY" };
    }
    if (payment.providerReference === null) return { kind: "PAYMENT_NOT_CONFIRMABLE" };

    // Confirmed retransmission: resolve via existing idempotency before status gates.
    // Never duplicates movements / coverage / inventory / sale completion.
    if (payment.status === "CONFIRMED") {
      return this.paymentStore.confirmTransfer({
        scope,
        sessionId,
        operatorUserId,
        paymentId: request.paymentId,
        expectedVersion: request.expectedVersion,
        allocationId: randomUUID(),
        operationId: uuidV7(),
        saleCompletionOperationId: uuidV7(),
        idempotencyKey: request.idempotencyKey,
        requestChecksum: requestChecksum(request, operatorUserId),
        correlationId: request.correlationId,
        causationId: request.causationId,
      });
    }

    if (payment.status !== "CREATED") return { kind: "PAYMENT_NOT_CONFIRMABLE" };
    if (payment.version !== request.expectedVersion) return { kind: "VERSION_CONFLICT" };

    try {
      const detail = await this.factusPay.getCollection({
        referenceCode: payment.providerReference,
        expectedAmountScale6: payment.expectedAmount,
      });
      if (detail.status !== "paid") return { kind: "FACTUS_PAY_NOT_PAID" };
    } catch (error) {
      if (error instanceof FactusPayClientError && error.code === "FACTUS_PAY_NOT_CONFIGURED") {
        return { kind: "FACTUS_PAY_NOT_CONFIGURED" };
      }
      return { kind: "FACTUS_PAY_VERIFICATION_FAILED" };
    }

    return this.paymentStore.confirmTransfer({
      scope,
      sessionId,
      operatorUserId,
      paymentId: request.paymentId,
      expectedVersion: request.expectedVersion,
      allocationId: randomUUID(),
      operationId: uuidV7(),
      saleCompletionOperationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
