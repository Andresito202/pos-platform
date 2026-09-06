import {
  Money,
  Payment,
  PaymentAttempt,
  PaymentDomainError,
  PaymentInitiated,
  type Actor,
  type MerchantCollectionIdentifier,
  type PaymentAuthorityType,
  type PaymentMethod,
  type TenantScope,
} from "@pos-platform/domain";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { PaymentAttemptRepository } from "../ports/payment-attempt-repository.js";
import type { PaymentAuthorizationPort } from "../ports/payment-authorization-port.js";
import type { PaymentRepository } from "../ports/payment-repository.js";

export interface InitiatePaymentCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly collectionSubjectType: string;
  readonly collectionSubjectId: string;
  readonly paymentMethod: PaymentMethod;
  readonly authorityType: PaymentAuthorityType;
  readonly amount: string;
  readonly currencyCode: string;
  readonly collectionIdentifier: MerchantCollectionIdentifier | null;
  readonly originDeviceId: string | null;
  readonly correlationId: string | null;
  readonly idempotencyKey: string;
}

export type InitiatePaymentResult =
  | { readonly kind: "INITIATED"; readonly payment: Payment; readonly attempt: PaymentAttempt; readonly event: PaymentInitiated }
  | { readonly kind: "ALREADY_INITIATED"; readonly payment: Payment }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "INVALID_AMOUNT" };

/**
 * UC-PAY-001, narrowed to the QR/Llave-style flow (`Payment` and its one
 * `PaymentAttempt` both start `PENDING`, no cash/card/credit branches).
 * Test #1 of B28-PAYNOTIF FASE 5 ("iniciar pago NO genera confirmación")
 * is structural here: this use case has no path that can ever return a
 * `CONFIRMED` status or a `PaymentConfirmed` event — only
 * `ConfirmPaymentUseCase` can produce those, and only from a real,
 * verified confirmation source.
 */
export class InitiatePaymentUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly attemptRepository: PaymentAttemptRepository,
    private readonly authorization: PaymentAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: InitiatePaymentCommand): Promise<InitiatePaymentResult> {
    const authorized = await this.authorization.canInitiatePayment(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const replay = await this.paymentRepository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (replay) return { kind: "ALREADY_INITIATED", payment: replay };

    let amount: Money;
    try {
      amount = Money.fromString(command.amount);
      if (!amount.isPositive()) throw new PaymentDomainError("NON_POSITIVE_PAYMENT_AMOUNT", "amount must be strictly positive");
    } catch {
      return { kind: "REJECTED", reason: "INVALID_AMOUNT" };
    }

    const now = this.clock.now();
    const paymentId = this.idGenerator.newId();

    const payment = Payment.initiate({
      id: paymentId,
      scope: command.scope,
      collectionSubjectType: command.collectionSubjectType,
      collectionSubjectId: command.collectionSubjectId,
      paymentMethod: command.paymentMethod,
      authorityType: command.authorityType,
      expectedAmount: amount,
      currencyCode: command.currencyCode,
      originDeviceId: command.originDeviceId,
      initiatedByActor: command.actor,
      correlationId: command.correlationId,
      createdAt: now,
    });

    const attempt = PaymentAttempt.initiate({
      id: this.idGenerator.newId(),
      scope: command.scope,
      paymentId,
      attemptNumber: 1,
      paymentMethod: command.paymentMethod,
      authorityType: command.authorityType,
      amount,
      currencyCode: command.currencyCode,
      collectionIdentifier: command.collectionIdentifier,
      correlationId: command.correlationId,
      initiatedAt: now,
    });

    await this.paymentRepository.save(payment, command.idempotencyKey);
    await this.attemptRepository.save(attempt, command.idempotencyKey);

    return { kind: "INITIATED", payment, attempt, event: PaymentInitiated.from(payment, now) };
  }
}
