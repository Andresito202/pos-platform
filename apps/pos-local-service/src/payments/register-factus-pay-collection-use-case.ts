import { CanonicalPermission } from "@pos-platform/contracts";
import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { InsufficientStockOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";
import { FactusPayClient, FactusPayClientError } from "./factus-pay-client.js";

export const PERMISSION_FACTUS_PAY_COLLECT = CanonicalPermission.PAYMENTS_PAYMENT_REGISTER;

const PROVIDER_CODE = "FACTUS_PAY";

export interface RegisterFactusPayCollectionRequest {
  readonly saleId: string;
  readonly amount: string;
  readonly expirationSeconds: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterFactusPayCollectionResult =
  | {
      readonly kind: "COLLECTED";
      readonly paymentId: string;
      readonly referenceCode: string;
      readonly qr: string | null;
      readonly providerStatus: string;
    }
  | {
      readonly kind: "IDEMPOTENT";
      readonly paymentId: string;
      readonly referenceCode: string;
      readonly qr: string | null;
      readonly providerStatus: string;
    }
  | {
      readonly kind: "REGISTERED_PROVIDER_FAILED";
      readonly paymentId: string;
      readonly referenceCode: string;
    }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_PAYABLE" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "FACTUS_PAY_NOT_CONFIGURED" }
  | { readonly kind: "FACTUS_PAY_AMOUNT_INVALID" }
  | InsufficientStockOutcome;

function requestChecksum(request: RegisterFactusPayCollectionRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      amount: request.amount,
      expiration_seconds: request.expirationSeconds,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      sale_id: request.saleId,
    }))
    .digest("hex");
}

function referenceCode(): string {
  return `POS-${randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
}

export class RegisterFactusPayCollectionUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly factusPay: FactusPayClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: RegisterFactusPayCollectionRequest,
  ): Promise<RegisterFactusPayCollectionResult> {
    if (this.factusPay === null) return { kind: "FACTUS_PAY_NOT_CONFIGURED" };

    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_FACTUS_PAY_COLLECT,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const reference = referenceCode();
    const paymentId = randomUUID();
    const outcome = this.paymentStore.register({
      scope,
      sessionId,
      operatorUserId,
      saleId: request.saleId,
      amount: request.amount,
      method: "QR",
      tenderedAmount: null,
      changeAmount: null,
      providerCode: PROVIDER_CODE,
      providerReference: reference,
      groupId: randomUUID(),
      paymentId,
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

    if (outcome.kind === "IDEMPOTENCY_CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };
    if (outcome.kind === "SALE_NOT_FOUND") return { kind: "SALE_NOT_FOUND" };
    if (outcome.kind === "SALE_NOT_PAYABLE") return { kind: "SALE_NOT_PAYABLE" };
    if (outcome.kind === "SALE_ALREADY_COMPLETED") return { kind: "SALE_ALREADY_COMPLETED" };
    if (outcome.kind === "CURRENCY_MISMATCH") return { kind: "CURRENCY_MISMATCH" };
    if (outcome.kind === "INSUFFICIENT_STOCK") return outcome;
    if (outcome.kind === "CONFIRMED") {
      throw new Error("Factus Pay collection must not confirm on registration");
    }
    if (outcome.kind !== "REGISTERED" && outcome.kind !== "IDEMPOTENT") {
      throw new Error(`unreachable outcome for Factus Pay registration: ${outcome.kind}`);
    }

    const resolvedPaymentId = outcome.paymentId;
    let resolvedReference = reference;
    if (outcome.kind === "IDEMPOTENT") {
      const replay = this.paymentStore.get(scope, resolvedPaymentId);
      if (replay.kind === "FOUND" && replay.payment.providerReference !== null) {
        resolvedReference = replay.payment.providerReference;
      }
    }

    try {
      const collection = await this.factusPay.createCollection({
        referenceCode: resolvedReference,
        amountScale6: request.amount,
        expirationSeconds: request.expirationSeconds,
      });
      return {
        kind: outcome.kind === "IDEMPOTENT" ? "IDEMPOTENT" : "COLLECTED",
        paymentId: resolvedPaymentId,
        referenceCode: collection.referenceCode,
        qr: collection.qr,
        providerStatus: collection.status,
      };
    } catch (error) {
      if (error instanceof FactusPayClientError) {
        if (error.code === "FACTUS_PAY_NOT_CONFIGURED") return { kind: "FACTUS_PAY_NOT_CONFIGURED" };
        if (error.code === "FACTUS_PAY_AMOUNT_INVALID") return { kind: "FACTUS_PAY_AMOUNT_INVALID" };
      }
      return {
        kind: "REGISTERED_PROVIDER_FAILED",
        paymentId: resolvedPaymentId,
        referenceCode: resolvedReference,
      };
    }
  }
}