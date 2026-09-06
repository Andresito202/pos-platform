import type { PaymentAttempt, TenantScope } from "@pos-platform/domain";

/** B28-PAYNOTIF. No adapter implements this — same DDL-gate posture as PaymentRepository. */
export interface PaymentAttemptRepository {
  findPendingByPaymentId(scope: TenantScope, paymentId: string): Promise<PaymentAttempt | null>;

  /**
   * `payments-schema.md`: "Referencia externa es única por (tenant_id,
   * provider_code, provider_reference_type, provider_reference)" — the
   * real physical uniqueness this method backs, used to reject a reused
   * provider reference before it can confirm an unrelated attempt.
   */
  findByProviderReference(
    scope: TenantScope,
    providerCode: string,
    providerReferenceType: string,
    providerReference: string,
  ): Promise<PaymentAttempt | null>;

  save(attempt: PaymentAttempt, idempotencyKey: string): Promise<void>;

  /** Idempotent-replay lookup for CONFIRM. */
  findConfirmationByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<PaymentAttempt | null>;
  saveConfirmation(attempt: PaymentAttempt, idempotencyKey: string): Promise<void>;
}
