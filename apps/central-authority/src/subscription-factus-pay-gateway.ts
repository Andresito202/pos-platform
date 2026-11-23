/**
 * Port for the existing Factus Pay collection adapter used by POS Caja.
 * Central injects a real client when credentials are provisioned; otherwise
 * subscription quotes remain PENDING and cannot be confirmed by free text.
 */
export type SubscriptionFactusPayCollection = {
  readonly referenceCode: string;
  readonly amountScale6: string;
  readonly status: string;
  readonly qr: string | null;
  readonly currencyCode: "COP";
};

export type SubscriptionFactusPayGateway = {
  recoverOrCreateCollection(input: {
    readonly referenceCode: string;
    readonly amountScale6: string;
    readonly expirationSeconds: number;
  }): Promise<SubscriptionFactusPayCollection>;
  getCollection(input: {
    readonly referenceCode: string;
    readonly expectedAmountScale6: string;
  }): Promise<SubscriptionFactusPayCollection>;
};

export class SubscriptionFactusPayGatewayError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "SubscriptionFactusPayGatewayError";
  }
}
