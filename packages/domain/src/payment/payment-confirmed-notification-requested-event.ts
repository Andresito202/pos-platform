import type { PaymentConfirmed } from "./payment-confirmed-event.js";

/**
 * NEW name, not yet in `docs/domain/event-catalog.md` — added per
 * B28-PAYNOTIF FASE 2-C, which explicitly allows this exact name "solo si
 * encaja con PAY-007 y event-catalog.md". It fits both: PAY-007 forbids
 * inventing a new `Payment`/`PaymentAttempt` state or mixing state
 * machines, and this is neither — it is a downstream artifact DERIVED
 * FROM an already-produced `PaymentConfirmed`, never itself a state or a
 * trigger for one. `Payment.status` never reads or depends on whether a
 * notification was ever requested, sent, or deduplicated.
 *
 * `notificationId` is deterministic (`payment-confirmed:<paymentId>`), not
 * random — this is the FASE 2-F "identificador estable necesario para
 * deduplicar" the notification itself, a separate concern from payment
 * idempotency: `Payment.confirm()` can only ever succeed once per payment
 * (guarded by `PAYMENT_NOT_PENDING`/version), so the underlying
 * `PaymentConfirmed` event this is derived from is itself produced at
 * most once — but DELIVERY of the resulting notification can still be
 * retried (reconnection, at-least-once delivery), and `notificationId`
 * lets `PosNotificationPort` reject a repeat delivery of the SAME
 * notification without touching `Payment`/`PaymentAttempt` state at all.
 */
export class PaymentConfirmedNotificationRequested {
  readonly type = "PaymentConfirmedNotificationRequested";
  private constructor(
    readonly notificationId: string,
    readonly notificationType: "PAYMENT_CONFIRMED",
    readonly paymentId: string,
    readonly saleId: string,
    readonly amount: string,
    readonly currencyCode: string,
    readonly paymentMethod: string,
    readonly providerCode: string | null,
    readonly externalReference: string | null,
    readonly occurredAt: Date,
  ) {}

  static from(confirmed: PaymentConfirmed): PaymentConfirmedNotificationRequested {
    return new PaymentConfirmedNotificationRequested(
      `payment-confirmed:${confirmed.paymentId}`,
      "PAYMENT_CONFIRMED",
      confirmed.paymentId,
      confirmed.collectionSubjectId,
      confirmed.amount,
      confirmed.currencyCode,
      confirmed.paymentMethod,
      confirmed.providerCode,
      confirmed.providerReference,
      confirmed.occurredAt,
    );
  }
}
