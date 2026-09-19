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
 * A `PENDING` verdict from Wompi is recorded via
 * `SqlitePaymentStore.recordObservedProviderTransaction`
 * (`MIGRATION_016`) before returning `STILL_PENDING` — non-authoritative,
 * best-effort, never touches `status`. That is what makes a future
 * background sweep buildable at all (`DEC-016` §20.5): it can read
 * `payments_payment_attempts_reconciliation_sweep_idx` for a transaction
 * id instead of having none to poll with. The sweep job itself — a
 * scheduler that walks that index and calls `execute` for each row — is
 * still **out of scope for this use case**; this only stops throwing the
 * transaction id away.
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

    if (evidence.status === "PENDING") {
      // Best-effort, non-authoritative: recording it never confirms
      // anything (MIGRATION_016, DEC-016 §20) — it only gives a future
      // reconciliation sweep a transaction id to read instead of nothing.
      // If the payment stopped being reconcilable in the time this HTTP
      // round trip took (a concurrent webhook confirmed or cancelled it),
      // the write is a harmless no-op; the STILL_PENDING verdict below is
      // Wompi's, unaffected by whether the write landed.
      this.paymentStore.recordObservedProviderTransaction(
        scope, request.paymentId, request.providerTransactionId, this.now().toISOString(),
      );
      return { kind: "STILL_PENDING" };
    }
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
