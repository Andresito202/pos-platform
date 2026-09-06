import { Money } from "../money.js";
import type { TenantScope } from "../tenant-scope.js";
import { PaymentDomainError } from "./payment-domain-errors.js";
import type { MerchantCollectionIdentifier } from "./merchant-collection-identifier.js";
import type { PaymentAuthorityType, PaymentMethod } from "./payment-method.js";

/**
 * `PaymentAttemptStatus` per PAY-007 (`docs/domain/payment-state-model.md`),
 * narrowed to the subset this block's flow actually reaches: `PROCESSING`,
 * `REQUIRES_ACTION`, `CANCELLED` and `REVIEW_REQUIRED` are real, closed
 * values of the same field but no code path in this block produces them —
 * same posture as `Product.status`'s unreachable `DRAFT` (B27 precedent).
 * No alias is introduced; every value used here is one of PAY-007's own.
 */
export type PaymentAttemptStatus = "CREATED" | "PENDING" | "CONFIRMED" | "DECLINED" | "FAILED" | "EXPIRED" | "UNKNOWN";

export interface InitiatePaymentAttemptInput {
  readonly id: string;
  readonly scope: TenantScope;
  readonly paymentId: string;
  readonly attemptNumber: number;
  readonly paymentMethod: PaymentMethod;
  readonly authorityType: PaymentAuthorityType;
  readonly amount: Money;
  readonly currencyCode: string;
  readonly collectionIdentifier: MerchantCollectionIdentifier | null;
  readonly correlationId: string | null;
  readonly initiatedAt: Date;
}

/**
 * PaymentAttempt — "ciclo de vida técnico de un intento de pago" (PAY-007).
 * Immutable, version-per-write (same architectural precedent as
 * `CashShift`/`Product`).
 *
 * Initial status is `PENDING`, not `CREATED`: for a QR/Llave collection
 * identifier, there is no outbound round-trip to a provider between
 * "the record exists" and "we are now waiting for confirmation" (unlike
 * the card/proveedor-externo flow in UC-PAY-001 §3, which explicitly
 * sends a request between those two moments) — the same reasoning
 * `CashShift` already used to skip the observably-empty `CLOSING` state.
 * `CREATED -> PENDING` remains a legal PAY-007 transition either way.
 */
export class PaymentAttempt {
  private constructor(
    readonly id: string,
    readonly scope: TenantScope,
    readonly paymentId: string,
    readonly attemptNumber: number,
    readonly paymentMethod: PaymentMethod,
    readonly authorityType: PaymentAuthorityType,
    readonly amount: Money,
    readonly currencyCode: string,
    readonly collectionIdentifier: MerchantCollectionIdentifier | null,
    readonly providerCode: string | null,
    readonly providerReferenceType: string | null,
    readonly providerReference: string | null,
    readonly correlationId: string | null,
    readonly status: PaymentAttemptStatus,
    readonly version: number,
    readonly initiatedAt: Date,
    readonly confirmedAt: Date | null,
  ) {}

  static initiate(input: InitiatePaymentAttemptInput): PaymentAttempt {
    if (!input.amount.isPositive()) {
      throw new PaymentDomainError("NON_POSITIVE_PAYMENT_AMOUNT", "payment attempt amount must be strictly positive");
    }
    if (!input.currencyCode.trim()) {
      throw new PaymentDomainError("EMPTY_CURRENCY_CODE", "currency code must not be empty");
    }
    return new PaymentAttempt(
      input.id, input.scope, input.paymentId, input.attemptNumber, input.paymentMethod, input.authorityType,
      input.amount, input.currencyCode, input.collectionIdentifier, null, null, null, input.correlationId,
      "PENDING", 1, input.initiatedAt, null,
    );
  }

  private assertVersion(expectedVersion: number): void {
    if (this.version !== expectedVersion) {
      throw new PaymentDomainError("ATTEMPT_VERSION_CONFLICT", `expected version ${expectedVersion}, attempt is at ${this.version}`);
    }
  }

  /**
   * `payments-schema.md`: "Webhook y polling son entradas no confiables al
   * adapter: verifican autenticidad, replay, provider reference, amount,
   * currency, tenant/configuración y transición antes de producir el
   * estado autoritativo." All of those checks happen in the application
   * layer (`ConfirmPaymentUseCase`) BEFORE this method is ever called —
   * this method only enforces the one invariant it can see on its own:
   * the transition itself (`PENDING -> CONFIRMED`, PAY-007-legal) and the
   * optimistic version guard.
   */
  confirm(expectedVersion: number, providerCode: string, providerReferenceType: string, providerReference: string, confirmedAt: Date): PaymentAttempt {
    this.assertVersion(expectedVersion);
    if (this.status !== "PENDING") {
      throw new PaymentDomainError("ATTEMPT_NOT_PENDING", `attempt ${this.id} is not PENDING (status=${this.status})`);
    }
    if (!providerCode.trim()) {
      throw new PaymentDomainError("EMPTY_PROVIDER_CODE", "provider code must not be empty to confirm an attempt");
    }
    if (!providerReference.trim()) {
      throw new PaymentDomainError("EMPTY_PROVIDER_REFERENCE", "provider reference must not be empty to confirm an attempt");
    }
    return new PaymentAttempt(
      this.id, this.scope, this.paymentId, this.attemptNumber, this.paymentMethod, this.authorityType,
      this.amount, this.currencyCode, this.collectionIdentifier, providerCode, providerReferenceType, providerReference,
      this.correlationId, "CONFIRMED", this.version + 1, this.initiatedAt, confirmedAt,
    );
  }
}
