import type {
  PaymentProviderIntent,
  PaymentProviderIntentResult,
  PaymentProviderOutcome,
  PaymentProviderPort,
  PaymentProviderUncertainty,
} from "../payment-provider-port.js";
import { buildWompiWebCheckout, type WompiCheckoutCredentials } from "./wompi-checkout-builder.js";
import { toPaymentProviderOutcome } from "./wompi-transaction.js";
import {
  getWompiTransaction,
  WompiHttpError,
  WompiMalformedResponseError,
  WompiNetworkError,
  WompiTimeoutError,
  type WompiHttpClientDependencies,
} from "./wompi-http-client.js";
import { WOMPI_PROVIDER_CODE } from "./wompi-transaction.js";
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
   * the merchant reference is useless here. The port says so in its own
   * signature (`providerTransactionId`) — `DEC-016` §21.
   *
   * A query that cannot be answered returns `UNKNOWN` (`DEC-016` §6 rule 1),
   * never rejection. What does *not* become `UNKNOWN` is a fault of ours
   * rather than of the answer: bad credentials, a transaction id the
   * provider does not recognise, or a malformed request keep throwing, so an
   * operational defect stays visible instead of hiding behind every payment
   * looking merely uncertain.
   */
  async getPaymentStatus(input: { readonly providerTransactionId: string }): Promise<PaymentProviderOutcome> {
    try {
      const transaction = await getWompiTransaction(
        input.providerTransactionId,
        { publicKey: this.credentials.checkout.publicKey },
        this.dependencies,
      );
      return toPaymentProviderOutcome(transaction, this.now());
    } catch (cause: unknown) {
      const reason = uncertaintyFor(cause);
      if (reason === null) throw cause;
      return { kind: "UNKNOWN", reason };
    }
  }

  /**
   * Verification failures keep throwing: an unsigned or forged notification
   * is an untrusted input, not an uncertain answer, and must never be
   * softened into `UNKNOWN`.
   */
  async normalizeNotification(input: unknown): Promise<PaymentProviderOutcome> {
    return normalizeWompiTransactionUpdatedEvent(input, this.credentials.events, this.now());
  }

  private now(): string {
    return this.dependencies.clock ? this.dependencies.clock() : new Date().toISOString();
  }
}

/**
 * Which failures mean "we could not determine the outcome" and which mean
 * "this deployment is broken". `null` means the second: rethrow it.
 *
 * `WompiTransactionNotFoundError` is deliberately absent. A 404 on an id we
 * supplied ourselves is a correlation defect, not a payment whose result is
 * pending discovery, and swallowing it as `UNKNOWN` would make a wrong id
 * indistinguishable from a slow provider.
 */
function uncertaintyFor(cause: unknown): PaymentProviderUncertainty | null {
  if (cause instanceof WompiTimeoutError) return "TIMEOUT";
  if (cause instanceof WompiNetworkError) return "NETWORK";
  if (cause instanceof WompiMalformedResponseError) return "MALFORMED_RESPONSE";
  if (cause instanceof WompiHttpError) {
    // 5xx and 429 say the provider could not answer right now. 401/403 and the
    // rest say we asked wrongly, which is not uncertainty about the payment.
    return cause.status >= 500 || cause.status === 429 ? "PROVIDER_UNAVAILABLE" : null;
  }
  return null;
}
