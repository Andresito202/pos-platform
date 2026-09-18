import { randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { ConfirmProviderPaymentUseCase } from "./confirm-provider-payment-use-case.js";
import type { PaymentProviderEvidence, PaymentProviderPort } from "./payment-provider-port.js";
import type { ConfirmProviderPaymentOutcome, SqlitePaymentStore } from "./sqlite-payment-store.js";

export const PERMISSION_PAYMENTS_PAYMENT_READ = "PAYMENTS_PAYMENT_READ";

export interface ReconcileProviderPaymentRequest {
  readonly paymentId: string;
  /**
   * The Wompi-issued transaction id — from a checkout redirect or a
   * previously verified webhook, never a value this use case invents.
   * Wompi's only status-query endpoint (`GET /v1/transactions/{id}`)
   * requires it; see `wompi-payment-provider.ts` and `DEC-016` §19.
   */
  readonly providerTransactionId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ReconcileProviderPaymentResult =
  | { readonly kind: "EVIDENCE_APPLIED"; readonly outcome: ConfirmProviderPaymentOutcome }
  | { readonly kind: "STILL_PENDING" }
  | { readonly kind: "PROVIDER_REJECTED"; readonly evidence: PaymentProviderEvidence }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "PAYMENT_NOT_RECONCILABLE" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * On-demand reconciliation for a QR/provider payment stuck `PENDING`
 * locally — `DEC-016` D-2.
 *
 * Exists because Wompi's webhook delivery is not guaranteed and its
 * checkout redirect is documented as "informative only, never a
 * validation method" — so the caller may need to actively ask Wompi what
 * really happened, using the transaction id the redirect carried. This
 * use case is that ask: it only ever *reads* the provider; the actual
 * state change still goes through the unmodified
 * `ConfirmProviderPaymentUseCase`/`SqlitePaymentStore.confirmProviderPayment`,
 * whose existing guards (payment must be `PENDING`/`CREATED`, provider
 * transaction id must not already belong to another payment, amount/
 * currency must match) are what actually prevent a double confirmation —
 * not a client-supplied idempotency key, consistent with `DEC-016` §7.4.
 *
 * Deliberately does **not** auto-cancel on a `REJECTED` verdict: cancelling
 * a pending `Payment` is `CancelPaymentUseCase`'s job, and folding it in
 * here would mix an operator-authority action into what is otherwise a
 * provider-authority read. The caller decides.
 *
 * Background/unattended polling (sweeping every stuck `PENDING` payment
 * without a known transaction id) is **out of scope for this use case** —
 * Wompi has no lookup-by-reference endpoint, so nothing can be reconciled
 * without first learning a real transaction id from a redirect or a
 * webhook, and today nothing durably persists a transaction id learned
 * before confirmation. That gap needs a schema decision (a new column on
 * `payments_payment_attempts`, dual-dialect) explicitly authorized before
 * it can be built — see the session report.
 */
export class ReconcileProviderPaymentUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly provider: PaymentProviderPort,
    private readonly confirm: ConfirmProviderPaymentUseCase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ReconcileProviderPaymentRequest,
  ): Promise<ReconcileProviderPaymentResult> {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_PAYMENTS_PAYMENT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const found = this.paymentStore.get(scope, request.paymentId);
    if (found.kind !== "FOUND") return { kind: "PAYMENT_NOT_FOUND" };
    if (found.payment.method !== "QR" || found.payment.status !== "PENDING") {
      return { kind: "PAYMENT_NOT_RECONCILABLE" };
    }

    const evidence = await this.provider.getPaymentStatus({
      providerReference: request.providerTransactionId,
    });

    if (evidence.status === "PENDING") return { kind: "STILL_PENDING" };
    if (evidence.status === "REJECTED") return { kind: "PROVIDER_REJECTED", evidence };

    // A fresh key per call, not one derived from the request: correctness
    // here comes from the confirmation guards above, not from this key —
    // see the class doc. Reusing a deterministic key would instead make a
    // harmless retry fail as IDEMPOTENCY_CONFLICT, because the evidence's
    // receivedAt (part of the confirm checksum) differs on every query.
    const outcome = this.confirm.execute(scope, {
      paymentId: request.paymentId,
      expectedVersion: found.payment.version,
      evidence,
      idempotencyKey: `reconcile:${randomUUID()}`,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
    return { kind: "EVIDENCE_APPLIED", outcome };
  }
}
