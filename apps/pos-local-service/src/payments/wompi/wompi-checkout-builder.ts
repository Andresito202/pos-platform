import { createHash } from "node:crypto";
import type { PaymentProviderCheckout, PaymentProviderIntent } from "../payment-provider-port.js";
import { amountToCents } from "./wompi-money.js";

export interface WompiCheckoutCredentials {
  readonly publicKey: string;
  readonly integritySecret: string;
  /**
   * Where Wompi sends the customer back after checkout, with its
   * `transaction.id` appended. Optional per Wompi: omitted, Wompi shows its
   * own "return to store" page instead of redirecting anywhere, and nothing
   * else about the checkout changes.
   *
   * Wompi's own docs are explicit that this redirect is "informative only,
   * never a validation method" — it is not part of the signed integrity
   * checksum (`signature:integrity` covers only reference/amount/currency/
   * secret) and must never be treated as payment evidence. It exists solely
   * to hand `ReconcileProviderPaymentUseCase` a `providerTransactionId` to
   * ask Wompi about (`DEC-016` §20); the real answer still comes from
   * `GET /v1/transactions/{id}` or the webhook, not from this URL firing.
   */
  readonly redirectUrl?: string;
}

export interface WompiCheckoutInput {
  readonly intent: PaymentProviderIntent;
  readonly providerReference: string;
}

const WompiCheckoutBaseUrl = "https://checkout.wompi.co/p/";

function integritySignature(
  reference: string,
  amountInCents: string,
  integritySecret: string,
): string {
  return createHash("sha256")
    .update(reference + amountInCents + "COP" + integritySecret, "utf8")
    .digest("hex");
}

export function buildWompiWebCheckout(
  input: WompiCheckoutInput,
  credentials: WompiCheckoutCredentials,
): PaymentProviderCheckout {
  if (input.intent.currencyCode !== "COP") {
    throw new Error("Wompi Web Checkout only supports COP");
  }
  if (!credentials.publicKey) throw new Error("Wompi public key is required");
  if (!credentials.integritySecret) throw new Error("Wompi integrity secret is required");
  if (!input.providerReference) throw new Error("Wompi payment reference is required");
  if (credentials.redirectUrl !== undefined) validateRedirectUrl(credentials.redirectUrl);

  const amountInCents = amountToCents(input.intent.amount);
  const signature = integritySignature(
    input.providerReference,
    amountInCents,
    credentials.integritySecret,
  );

  const params = new URLSearchParams({
    "public-key": credentials.publicKey,
    currency: "COP",
    "amount-in-cents": amountInCents,
    reference: input.providerReference,
    "signature:integrity": signature,
  });
  if (credentials.redirectUrl !== undefined) {
    params.set("redirect-url", credentials.redirectUrl);
  }

  return {
    kind: "WEB_URL",
    url: WompiCheckoutBaseUrl + "?" + params.toString(),
  };
}

function validateRedirectUrl(redirectUrl: string): void {
  if (!redirectUrl.trim()) throw new Error("Wompi redirect URL must not be blank");
  try {
    new URL(redirectUrl);
  } catch {
    throw new Error("Wompi redirect URL must be an absolute, well-formed URL");
  }
}
