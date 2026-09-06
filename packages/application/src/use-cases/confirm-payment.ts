import {
  Money,
  Payment,
  PaymentAttempt,
  PaymentConfirmed,
  PaymentConfirmedNotificationRequested,
  PaymentDomainError,
  type TenantScope,
} from "@pos-platform/domain";
import type { Clock } from "../ports/clock.js";
import type { PaymentAttemptRepository } from "../ports/payment-attempt-repository.js";
import type { PaymentConfirmationAuthenticityPort, PaymentConfirmationEvidence } from "../ports/payment-confirmation-authenticity-port.js";
import type { PaymentRepository } from "../ports/payment-repository.js";
import type { PosNotificationPort } from "../ports/pos-notification-port.js";

export interface ConfirmPaymentCommand {
  readonly scope: TenantScope;
  readonly paymentId: string;
  readonly evidence: PaymentConfirmationEvidence;
  readonly idempotencyKey: string;
}

export type ConfirmPaymentResult =
  | {
      readonly kind: "CONFIRMED";
      readonly payment: Payment;
      readonly attempt: PaymentAttempt;
      readonly event: PaymentConfirmed;
      readonly notification: PaymentConfirmedNotificationRequested;
      readonly notificationDispatch: "DELIVERED" | "ALREADY_DELIVERED";
    }
  | { readonly kind: "ALREADY_CONFIRMED"; readonly payment: Payment; readonly attempt: PaymentAttempt }
  | {
      readonly kind: "REJECTED";
      readonly reason:
        | "NOT_AUTHENTIC"
        | "PROVIDER_REFERENCE_ALREADY_USED"
        | "PAYMENT_NOT_FOUND"
        | "ATTEMPT_NOT_FOUND"
        | "AMOUNT_MISMATCH"
        | "CURRENCY_MISMATCH"
        | "PAYMENT_NOT_PENDING"
        | "ATTEMPT_NOT_PENDING";
    };

/**
 * The automated confirmation path the B28-PAYNOTIF diagram describes
 * ("FUENTE EXTERNA CONFIABLE CONFIRMA" -> `PaymentConfirmed`). System-to-
 * system, per UC-PAY-001's own actor list ("servicio de pagos",
 * "integración externa autenticada") — there is no human role check here,
 * `PaymentConfirmationAuthenticityPort` is the real gate.
 *
 * Pipeline order is not invented: it transcribes `payments-schema.md`'s
 * own sentence verbatim — "verifican autenticidad, replay, provider
 * reference, amount, currency, tenant/configuración y transición antes
 * de producir el estado autoritativo."
 *
 * Resolving an inbound webhook's raw payload to `paymentId` (matching a
 * merchant collection identifier to an internal payment) is explicitly
 * OUT of scope — that is adapter/infrastructure work belonging to a
 * future webhook receiver, not this use case, which starts from an
 * already-structured `PaymentConfirmationEvidence` plus a resolved
 * `paymentId`.
 */
export class ConfirmPaymentUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly attemptRepository: PaymentAttemptRepository,
    private readonly authenticity: PaymentConfirmationAuthenticityPort,
    private readonly notificationPort: PosNotificationPort,
    private readonly clock: Clock,
  ) {}

  async execute(command: ConfirmPaymentCommand): Promise<ConfirmPaymentResult> {
    const authentic = await this.authenticity.verify(command.evidence);
    if (!authentic) return { kind: "REJECTED", reason: "NOT_AUTHENTIC" };

    const replayPayment = await this.paymentRepository.findConfirmationByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replayPayment) {
      const replayAttempt = await this.attemptRepository.findConfirmationByIdempotencyKey(command.scope, command.idempotencyKey);
      if (replayAttempt) return { kind: "ALREADY_CONFIRMED", payment: replayPayment, attempt: replayAttempt };
    }

    const { providerCode, providerReferenceType, providerReference } = command.evidence;
    const referenceOwner = await this.attemptRepository.findByProviderReference(command.scope, providerCode, providerReferenceType, providerReference);
    if (referenceOwner && referenceOwner.paymentId !== command.paymentId) {
      return { kind: "REJECTED", reason: "PROVIDER_REFERENCE_ALREADY_USED" };
    }

    const payment = await this.paymentRepository.findById(command.scope, command.paymentId);
    if (!payment) return { kind: "REJECTED", reason: "PAYMENT_NOT_FOUND" };

    const attempt = await this.attemptRepository.findPendingByPaymentId(command.scope, command.paymentId);
    if (!attempt) return { kind: "REJECTED", reason: "ATTEMPT_NOT_FOUND" };

    let evidenceAmount: Money;
    try {
      evidenceAmount = Money.fromString(command.evidence.amount);
    } catch {
      return { kind: "REJECTED", reason: "AMOUNT_MISMATCH" };
    }
    if (!evidenceAmount.equals(payment.expectedAmount)) {
      return { kind: "REJECTED", reason: "AMOUNT_MISMATCH" };
    }
    if (command.evidence.currencyCode !== payment.currencyCode) {
      return { kind: "REJECTED", reason: "CURRENCY_MISMATCH" };
    }

    const now = this.clock.now();

    let confirmedAttempt: PaymentAttempt;
    try {
      confirmedAttempt = attempt.confirm(attempt.version, providerCode, providerReferenceType, providerReference, now);
    } catch (error) {
      if (error instanceof PaymentDomainError && error.code === "ATTEMPT_NOT_PENDING") {
        return { kind: "REJECTED", reason: "ATTEMPT_NOT_PENDING" };
      }
      throw error;
    }

    let confirmedPayment: Payment;
    try {
      confirmedPayment = payment.confirm(payment.version, now);
    } catch (error) {
      if (error instanceof PaymentDomainError && error.code === "PAYMENT_NOT_PENDING") {
        return { kind: "REJECTED", reason: "PAYMENT_NOT_PENDING" };
      }
      throw error;
    }

    await this.attemptRepository.saveConfirmation(confirmedAttempt, command.idempotencyKey);
    await this.paymentRepository.saveConfirmation(confirmedPayment, command.idempotencyKey);

    const event = PaymentConfirmed.from(confirmedPayment, confirmedAttempt, now);
    const notification = PaymentConfirmedNotificationRequested.from(event);
    const notificationDispatch = await this.notificationPort.notify(notification);

    return { kind: "CONFIRMED", payment: confirmedPayment, attempt: confirmedAttempt, event, notification, notificationDispatch };
  }
}
