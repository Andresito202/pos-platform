/**
 * Boundary between Payments and an external financial provider.
 *
 * The provider is the financial authority. Payments remains responsible for
 * the local payment lifecycle, idempotency and sale completion. A QR image
 * alone is not payment evidence and must never complete a payment.
 */
export interface PaymentProviderIntent {
  readonly paymentId: string;
  readonly saleId: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly cashRegisterId: string;
  readonly amount: string;
  readonly currencyCode: "COP";
  /**
   * Protects the local operation from being repeated. Supplied by the caller
   * (`DEC-016` §7.2) and therefore never an identity Camacho asserts to a
   * third party — it must not travel to the provider as a reference.
   */
  readonly idempotencyKey: string;
  /**
   * Commercial reference Camacho presents to the provider. Chosen by the
   * application layer, never by the renderer and never by the adapter
   * (`DEC-016` §21). Distinct from `idempotencyKey` by contract even when a
   * flow happens to derive one from the other.
   */
  readonly merchantReference: string;
}

export interface PaymentProviderCheckout {
  /**
   * Provider-owned checkout surface. The renderer may present the URL but
   * never constructs or signs it.
   */
  readonly kind: "WEB_URL";
  readonly url: string;
}

export interface PaymentProviderIntentResult {
  readonly providerCode: string;
  /** Echo of the reference the intent carried. Never the provider's own id. */
  readonly merchantReference: string;
  readonly status: "PENDING" | "APPROVED" | "REJECTED";
  readonly checkout: PaymentProviderCheckout | null;
}

export interface PaymentProviderEvidence {
  readonly providerCode: string;
  /** The merchant reference as the provider echoes it back. */
  readonly providerReference: string;
  /** Identity the provider assigned to the transaction. */
  readonly providerTransactionId: string;
  readonly amount: string;
  readonly currencyCode: "COP";
  readonly status: "PENDING" | "APPROVED" | "REJECTED";
  readonly receivedAt: string;
  readonly payerReference?: string;
}

/**
 * Why the provider is not asked to return an evidence object carrying a
 * `"UNKNOWN"` status: evidence *is* the provider's answer. When a query times
 * out there is no reference, no transaction id, no amount and no receipt time
 * to put in one, and inventing them would be the fabrication this boundary
 * exists to prevent. `DEC-016` §6 already models it this way — its
 * `ProviderOutcome` has `UNKNOWN { }`, an empty variant beside the ones that
 * carry evidence. `PAY-007` rule 1: a timeout does not produce `FAILED`.
 *
 * So uncertainty is a *variant*, not a status value, and the type makes it
 * impossible to read evidence out of an outcome that has none.
 */
export type PaymentProviderUncertainty =
  /** The request was sent and the answer never arrived. */
  | "TIMEOUT"
  /** The request failed before any response was read. */
  | "NETWORK"
  /** The provider answered that it could not serve the query (5xx, throttled). */
  | "PROVIDER_UNAVAILABLE"
  /** The provider answered with something this contract cannot read. */
  | "MALFORMED_RESPONSE"
  /** The provider reports its own processing failed — not a commercial verdict. */
  | "PROVIDER_ERROR";

export type PaymentProviderOutcome =
  | { readonly kind: "EVIDENCE"; readonly evidence: PaymentProviderEvidence }
  | { readonly kind: "UNKNOWN"; readonly reason: PaymentProviderUncertainty };

/**
 * Minimal provider boundary for QR and other provider-backed payment flows.
 * Implementations must not mutate the local Payments database directly.
 */
export interface PaymentProviderPort {
  createPaymentIntent(
    input: PaymentProviderIntent,
  ): Promise<PaymentProviderIntentResult>;

  /**
   * Queries the provider by the identity the provider itself assigned. A
   * merchant reference is not accepted here: providers generally offer no
   * lookup by it (Wompi's `GET /v1/transactions/{id}` has no such form), so
   * the contract asks for the only identity that can actually be resolved.
   *
   * Returns `UNKNOWN` when the question could not be answered. It never
   * returns rejection for a failure of ours: absence of evidence of approval
   * is not evidence of rejection.
   */
  getPaymentStatus(input: {
    readonly providerTransactionId: string;
  }): Promise<PaymentProviderOutcome>;

  /**
   * A notification that fails verification is not uncertainty — it is an
   * untrusted input, and it still throws. `UNKNOWN` here means the
   * notification was authentic and said the provider's own processing
   * failed.
   */
  normalizeNotification(input: unknown): Promise<PaymentProviderOutcome>;
}
