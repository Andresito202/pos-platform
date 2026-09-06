import type { Payment } from "./payment.js";

/** `docs/domain/event-catalog.md`, already-catalogued name: `PaymentInitiated`. */
export class PaymentInitiated {
  readonly type = "PaymentInitiated";
  private constructor(readonly paymentId: string, readonly tenantId: string, readonly companyId: string, readonly occurredAt: Date) {}
  static from(payment: Payment, now: Date): PaymentInitiated {
    return new PaymentInitiated(payment.id, payment.scope.tenantId, payment.scope.companyId, now);
  }
}
