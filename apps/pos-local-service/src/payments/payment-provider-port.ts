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
  readonly idempotencyKey: string;
}

export interface PaymentProviderIntentResult {
  readonly providerCode: string;
  readonly providerReference: string;
  readonly status: "PENDING" | "APPROVED" | "REJECTED";
}

export interface PaymentProviderEvidence {
  readonly providerCode: string;
  readonly providerReference: string;
  readonly providerTransactionId: string;
  readonly amount: string;
  readonly currencyCode: "COP";
  readonly status: "PENDING" | "APPROVED" | "REJECTED";
  readonly receivedAt: string;
  readonly payerReference?: string;
}

/**
 * Minimal provider boundary for QR and other provider-backed payment flows.
 * Implementations must not mutate the local Payments database directly.
 */
export interface PaymentProviderPort {
  createPaymentIntent(
    input: PaymentProviderIntent,
  ): Promise<PaymentProviderIntentResult>;

  getPaymentStatus(input: {
    readonly providerReference: string;
  }): Promise<PaymentProviderEvidence>;

  normalizeNotification(input: unknown): Promise<PaymentProviderEvidence>;
}
