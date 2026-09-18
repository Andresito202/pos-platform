import { createHash } from "node:crypto";
import type { PaymentProviderCheckout, PaymentProviderIntent } from "../payment-provider-port.js";

export interface WompiCheckoutCredentials {
  readonly publicKey: string;
  readonly integritySecret: string;
}

export interface WompiCheckoutInput {
  readonly intent: PaymentProviderIntent;
  readonly providerReference: string;
}

const WompiCheckoutBaseUrl = "https://checkout.wompi.co/p/";

function amountToCents(amount: string): string {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount);
  if (match === null) throw new Error("Wompi amount must be a non-negative decimal");

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(6, "0");

  // POS money uses scale 6. COP checkout accepts centavos, so the four
  // sub-cent digits must be zero; silently rounding financial amounts is forbidden.
  if (fraction.slice(2) !== "0000") {
    throw new Error("Wompi amount has precision below one COP cent");
  }

  return (whole * 100n + BigInt(fraction.slice(0, 2))).toString();
}

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
