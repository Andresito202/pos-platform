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
   * Web Checkout never calls a Wompi API to "create" anything — the
   * checkout URL is a client-side redirect Wompi later resolves. There is
   * therefore no provider-issued reference at this point; DEC-016 §7.1
   * ("hacia proveedor: la misma clave, propagada") is the documented answer
   * for what to propagate as that reference, so the idempotency key is
   * reused as the Wompi `reference` query param.
   */
  async createPaymentIntent(input: PaymentProviderIntent): Promise<PaymentProviderIntentResult> {
    const providerReference = input.idempotencyKey;
    const checkout = buildWompiWebCheckout(
      { intent: input, providerReference },
      this.credentials.checkout,
    );

    return {
      providerCode: WOMPI_PROVIDER_CODE,
      providerReference,
      status: "PENDING",
      checkout,
    };
  }

  /**
   * `input.providerReference` must already be the Wompi-issued transaction
   * id (from a checkout redirect or verified webhook), not the merchant
   * reference `createPaymentIntent` propagates above — Wompi's `GET
   * /v1/transactions/{id}` has no lookup-by-reference form. `docs/adr/
   * DEC-016-payment-v1-local-architecture.md` §19 records why
   * `PaymentProviderPort` was not changed to carry this distinction
   * explicitly, and defers that decision to when D-2 (polling/reconciliación)
   * is actually designed.
   */
  async getPaymentStatus(input: { readonly providerReference: string }): Promise<PaymentProviderEvidence> {
    const transaction = await getWompiTransaction(
      input.providerReference,
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
