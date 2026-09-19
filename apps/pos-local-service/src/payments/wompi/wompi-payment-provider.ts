import type {
  PaymentProviderEvidence,
  PaymentProviderIntent,
  PaymentProviderIntentResult,
  PaymentProviderPort,
} from "../payment-provider-port.js";
import { buildWompiWebCheckout, type WompiCheckoutCredentials } from "./wompi-checkout-builder.js";
import { getWompiTransaction, type WompiHttpClientDependencies } from "./wompi-http-client.js";
import { WOMPI_PROVIDER_CODE, toPaymentProviderEvidence } from "./wompi-transaction.js";
import { normalizeWompiTransactionUpdatedEvent, type WompiEventsCredentials } from "./wompi-webhook-verifier.js";

export interface WompiPaymentProviderCredentials {
  /**
   * `checkout.publicKey` is also what authenticates `GET
   * /v1/transactions/{id}` (Wompi's status-query endpoint takes the public
   * key, not the private key — verified against Wompi's docs) — there is no
   * separate query credential to carry.
   */
  readonly checkout: WompiCheckoutCredentials;
  readonly events: WompiEventsCredentials;
}

/**
 * Realizes `PaymentProviderPort` for Wompi. Not wired into `main.ts` by this
 * change — that requires the productive secret-sourcing wiring, which is
 * explicitly out of scope here.
 */
export class WompiPaymentProvider implements PaymentProviderPort {
  constructor(
    private readonly credentials: WompiPaymentProviderCredentials,
    private readonly dependencies: WompiHttpClientDependencies & { readonly clock?: () => string } = {},
  ) {}

  /**
   * Web Checkout never calls a Wompi API to "create" anything — the checkout
   * URL is a client-side redirect Wompi later resolves, so no Wompi-issued
   * identity exists at this point. The adapter therefore carries the
   * merchant reference the application layer decided (`DEC-016` §21); it does
   * not choose one, and in particular does not reach for `idempotencyKey`.
   */
  async createPaymentIntent(input: PaymentProviderIntent): Promise<PaymentProviderIntentResult> {
    const checkout = buildWompiWebCheckout(
      { intent: input, merchantReference: input.merchantReference },
      this.credentials.checkout,
    );

    return {
      providerCode: WOMPI_PROVIDER_CODE,
      merchantReference: input.merchantReference,
      status: "PENDING",
      checkout,
    };
  }

  /**
   * Wompi's `GET /v1/transactions/{id}` has no lookup-by-reference form, so
   * the merchant reference is useless here. The port now says so in its own
   * signature (`providerTransactionId`) instead of leaving it to a comment
   * — `DEC-016` §21.
   */
  async getPaymentStatus(input: { readonly providerTransactionId: string }): Promise<PaymentProviderEvidence> {
    const transaction = await getWompiTransaction(
      input.providerTransactionId,
      { publicKey: this.credentials.checkout.publicKey },
      this.dependencies,
    );
    return toPaymentProviderEvidence(transaction, this.now());
  }

  async normalizeNotification(input: unknown): Promise<PaymentProviderEvidence> {
    return normalizeWompiTransactionUpdatedEvent(input, this.credentials.events, this.now());
  }

  private now(): string {
    return this.dependencies.clock ? this.dependencies.clock() : new Date().toISOString();
  }
}
