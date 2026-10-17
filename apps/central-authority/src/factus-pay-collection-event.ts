import { timingSafeEqual } from "node:crypto";
import { QrPaymentObservationSchema, type QrPaymentObservation } from "@pos-platform/contracts";

interface FactusPayCollection {
  readonly reference_code?: unknown;
  readonly amount?: unknown;
  readonly status?: unknown;
  readonly payer?: unknown;
}

interface FactusPayWebhookBody {
  readonly data?: unknown;
}

const MAX_COLLECTION_AMOUNT_COP = 12_100_000;

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function collectionAmount(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("FACTUS_PAY_INVALID_AMOUNT");
  }
  const raw = String(value);
  // Reject exponent notation, signs, separators, and more than six decimals.
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error("FACTUS_PAY_INVALID_AMOUNT");
  }
  const [whole, fraction = ""] = raw.split(".");
  const amount = whole + "." + fraction.padEnd(6, "0");
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > MAX_COLLECTION_AMOUNT_COP) {
    throw new Error("FACTUS_PAY_INVALID_AMOUNT");
  }
  return amount;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

/**
 * Authenticates and normalizes the Factus Pay collection webhook documented at
 * https://pay-developers.factus.com.co/webhooks/.
 *
 * Factus Pay authenticates this callback with the configured query parameter
 * named key; the documented contract does not specify an HMAC signature.
 * This function performs no persistence or payment confirmation: callers must
 * durably record the event before returning 2xx and correlate its reference
 * and exact amount with a pending POS payment.
 */
export function verifyFactusPayCollectionWebhook(
  input: unknown,
  suppliedKey: string | null,
  expectedKey: string,
  observedAt: Date = new Date(),
): QrPaymentObservation {
  if (expectedKey.length < 32) throw new Error("FACTUS_PAY_WEBHOOK_KEY_TOO_SHORT");
  if (suppliedKey === null || !constantTimeEqual(suppliedKey, expectedKey)) {
    throw new Error("FACTUS_PAY_UNAUTHORIZED");
  }
  if (!Number.isFinite(observedAt.getTime())) throw new Error("FACTUS_PAY_INVALID_OBSERVED_AT");
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("FACTUS_PAY_INVALID_EVENT");
  }

  const data = (input as FactusPayWebhookBody).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("FACTUS_PAY_COLLECTION_MISSING");
  }
  const collection = data as FactusPayCollection;
  if (collection.status !== "paid") throw new Error("FACTUS_PAY_COLLECTION_NOT_PAID");

  const reference = optionalString(collection.reference_code, 160);
  if (reference === null) throw new Error("FACTUS_PAY_REFERENCE_MISSING");

  const payer = typeof collection.payer === "object" && collection.payer !== null && !Array.isArray(collection.payer)
    ? collection.payer as Record<string, unknown>
    : null;

  return QrPaymentObservationSchema.parse({
    external_transaction_id: reference,
    external_reference: reference,
    provider_code: "FACTUS_PAY",
    status: "APPROVED",
    amount: collectionAmount(collection.amount),
    currency_code: "COP",
    payer_display_name: optionalString(payer?.name, 200),
    payer_reference: optionalString(payer?.reference, 200) ?? optionalString(payer?.email, 200),
    observed_at: observedAt.toISOString(),
  });
}
