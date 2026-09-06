import type { Payment } from "./payment.js";
import type { PaymentAttempt } from "./payment-attempt.js";

/** `docs/domain/event-catalog.md`, already-catalogued name: `PaymentConfirmed`. */
export class PaymentConfirmed {
  readonly type = "PaymentConfirmed";
  private constructor(
    readonly paymentId: string,
    readonly tenantId: string,
    readonly companyId: string,
    readonly collectionSubjectType: string,
    readonly collectionSubjectId: string,
    readonly amount: string,
    readonly currencyCode: string,
    readonly paymentMethod: string,
    readonly providerCode: string | null,
    readonly providerReference: string | null,
    readonly occurredAt: Date,
  ) {}

  static from(payment: Payment, attempt: PaymentAttempt, now: Date): PaymentConfirmed {
    return new PaymentConfirmed(
      payment.id,
      payment.scope.tenantId,
      payment.scope.companyId,
      payment.collectionSubjectType,
      payment.collectionSubjectId,
      payment.confirmedAmount.toString(),
      payment.currencyCode,
      payment.paymentMethod,
      attempt.providerCode,
      attempt.providerReference,
      now,
    );
  }
}
