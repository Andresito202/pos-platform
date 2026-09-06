import type { Payment, TenantScope } from "@pos-platform/domain";

/**
 * B28-PAYNOTIF. No SQLite/PostgreSQL adapter implements this — Payments'
 * own physical model (`payments-schema.md`) is `CLOSED` documentally but
 * has no DDL/adapter yet, same DDL-gate posture as Cash before B22 and
 * Catalog today.
 */
export interface PaymentRepository {
  findById(scope: TenantScope, paymentId: string): Promise<Payment | null>;

  /** Idempotent-replay lookup for INITIATE. */
  findByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<Payment | null>;
  save(payment: Payment, idempotencyKey: string): Promise<void>;

  /** Idempotent-replay lookup for CONFIRM — a distinct namespace from INITIATE's key. */
  findConfirmationByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<Payment | null>;
  saveConfirmation(payment: Payment, idempotencyKey: string): Promise<void>;
}
