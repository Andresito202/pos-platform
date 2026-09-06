import { Money } from "../money.js";
import type { Actor } from "../actor.js";
import type { TenantScope } from "../tenant-scope.js";
import { PaymentDomainError } from "./payment-domain-errors.js";
import type { PaymentAuthorityType, PaymentMethod } from "./payment-method.js";

/**
 * `PaymentStatus` per PAY-007, narrowed to what this block's single-
 * attempt flow reaches: `PARTIALLY_CONFIRMED` (mixed payments), `CANCELLED`
 * and `REVIEW_REQUIRED` are real, closed values of the same field, not
 * modeled here — mixed-payment coordination and manual review are out of
 * scope for B28-PAYNOTIF (registered as a remaining gap, not silently
 * dropped).
 */
export type PaymentStatus = "PENDING" | "CONFIRMED" | "FAILED";

export interface InitiatePaymentInput {
  readonly id: string;
  readonly scope: TenantScope;
  /**
   * `payments-schema.md` puts the sale/order/receivable reference on
   * `PaymentAllocation` (via `PaymentGroup`), not directly on `Payment` —
   * this block does not model `PaymentGroup`/`PaymentAllocation` (out of
   * scope: this is a single, unmixed payment). `collectionSubjectId`
   * reuses `PaymentAllocation`'s own real column name directly on
   * `Payment` as a deliberate simplification for this narrower flow,
   * flagged here so a future block does not mistake it for an already-
   * closed physical decision.
   */
  readonly collectionSubjectType: string;
  readonly collectionSubjectId: string;
  readonly paymentMethod: PaymentMethod;
  readonly authorityType: PaymentAuthorityType;
  readonly expectedAmount: Money;
  readonly currencyCode: string;
  readonly originDeviceId: string | null;
  readonly initiatedByActor: Actor;
  readonly correlationId: string | null;
  readonly createdAt: Date;
}

/**
 * Payment — "resultado financiero agregado" (PAY-007), never the technical
 * intent-to-pay itself (that is `PaymentAttempt`). Immutable, version-per-
 * write. Initial status is `PENDING` — UC-PAY-001's own "Estados iniciales
 * por método" table allows `STATIC_QR -> PENDING` directly (no `CREATED`
 * hop observed), the same collapsing reasoning `PaymentAttempt` uses.
 */
export class Payment {
  private constructor(
    readonly id: string,
    readonly scope: TenantScope,
    readonly collectionSubjectType: string,
    readonly collectionSubjectId: string,
    readonly paymentMethod: PaymentMethod,
    readonly authorityType: PaymentAuthorityType,
    readonly expectedAmount: Money,
    readonly confirmedAmount: Money,
    readonly currencyCode: string,
    readonly originDeviceId: string | null,
    readonly initiatedByActor: Actor,
    readonly correlationId: string | null,
    readonly status: PaymentStatus,
    readonly version: number,
    readonly createdAt: Date,
    readonly confirmedAt: Date | null,
  ) {}

  static initiate(input: InitiatePaymentInput): Payment {
    if (!input.expectedAmount.isPositive()) {
      throw new PaymentDomainError("NON_POSITIVE_PAYMENT_AMOUNT", "payment amount must be strictly positive");
    }
    if (!input.currencyCode.trim()) {
      throw new PaymentDomainError("EMPTY_CURRENCY_CODE", "currency code must not be empty");
    }
    return new Payment(
      input.id, input.scope, input.collectionSubjectType, input.collectionSubjectId, input.paymentMethod,
      input.authorityType, input.expectedAmount, Money.zero(), input.currencyCode, input.originDeviceId,
      input.initiatedByActor, input.correlationId, "PENDING", 1, input.createdAt, null,
    );
  }

  private assertVersion(expectedVersion: number): void {
    if (this.version !== expectedVersion) {
      throw new PaymentDomainError("PAYMENT_VERSION_CONFLICT", `expected version ${expectedVersion}, payment is at ${this.version}`);
    }
  }

  /**
   * PAY-007 "Reglas entre agregados" #1: "PaymentAttempt.CONFIRMED puede
   * contribuir a Payment.CONFIRMED" — called by the use case AFTER the
   * corresponding `PaymentAttempt.confirm()` succeeds, never implicitly.
   * A single, unmixed payment's one attempt fully covers it, so
   * `confirmedAmount` is set to the full `expectedAmount` — mixed/partial
   * coverage (`PARTIALLY_CONFIRMED`) is out of scope, see the type's own
   * doc comment.
   */
  confirm(expectedVersion: number, confirmedAt: Date): Payment {
    this.assertVersion(expectedVersion);
    if (this.status !== "PENDING") {
      throw new PaymentDomainError("PAYMENT_NOT_PENDING", `payment ${this.id} is not PENDING (status=${this.status})`);
    }
    return new Payment(
      this.id, this.scope, this.collectionSubjectType, this.collectionSubjectId, this.paymentMethod,
      this.authorityType, this.expectedAmount, this.expectedAmount, this.currencyCode, this.originDeviceId,
      this.initiatedByActor, this.correlationId, "CONFIRMED", this.version + 1, this.createdAt, confirmedAt,
    );
  }
}
