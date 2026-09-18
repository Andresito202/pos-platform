import { createHash } from "node:crypto";
import type { PaymentProviderCheckout, PaymentProviderIntent } from "../payment-provider-port.js";
import { amountToCents } from "./wompi-money.js";

export interface WompiCheckoutCredentials {
  readonly publicKey: string;
  readonly integritySecret: string;
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

  return {
    kind: "WEB_URL",
    url: WompiCheckoutBaseUrl + "?" + params.toString(),
  };
}
