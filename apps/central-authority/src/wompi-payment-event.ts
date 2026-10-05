import { createHash, timingSafeEqual } from "node:crypto";
import { QrPaymentObservationSchema, type QrPaymentObservation } from "@pos-platform/contracts";

interface WompiEvent {
  readonly event?: unknown;
  readonly data?: unknown;
  readonly environment?: unknown;
  readonly signature?: unknown;
  readonly timestamp?: unknown;
}

interface WompiTransaction {
  readonly id?: unknown;
  readonly reference?: unknown;
  readonly amount_in_cents?: unknown;
  readonly currency?: unknown;
  readonly status?: unknown;
  readonly customer_email?: unknown;
}

interface WompiSignature {
  readonly properties?: unknown;
  readonly checksum?: unknown;
}

function propertyValue(root: unknown, path: string): string | null {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" || typeof current === "number" || typeof current === "boolean"
    ? String(current)
    : null;
}

function secureEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function scale6FromCents(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("WOMPI_INVALID_AMOUNT");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}0000`;
}

/**
 * Verifies and normalizes Wompi `transaction.updated` events.
 *
 * This function deliberately has no database side effects. Persistence and
 * correlation belong to the central payment-ingestion transaction, where the
 * external transaction id can be deduplicated before any Payment/Sale mutation.
 */
export function verifyWompiTransactionEvent(input: unknown, eventSecret: string): QrPaymentObservation {
  if (!eventSecret) throw new Error("WOMPI_EVENT_SECRET_REQUIRED");
  if (typeof input !== "object" || input === null) throw new Error("WOMPI_INVALID_EVENT");

  const event = input as WompiEvent;
  if (event.event !== "transaction.updated") throw new Error("WOMPI_UNSUPPORTED_EVENT");
  if (event.environment !== "prod" && event.environment !== "test") throw new Error("WOMPI_INVALID_ENVIRONMENT");
  if (!Number.isSafeInteger(event.timestamp)) throw new Error("WOMPI_INVALID_TIMESTAMP");

  const signature = event.signature as WompiSignature | undefined;
  const properties = signature?.properties;
  const checksum = signature?.checksum;
  if (!Array.isArray(properties) || properties.some((value) => typeof value !== "string")) {
    throw new Error("WOMPI_INVALID_SIGNATURE_PROPERTIES");
  }
  if (typeof checksum !== "string" || checksum.length !== 64) throw new Error("WOMPI_INVALID_CHECKSUM");

  const transaction = (event.data as { transaction?: unknown } | undefined)?.transaction as WompiTransaction | undefined;
  if (transaction === undefined) throw new Error("WOMPI_TRANSACTION_MISSING");

  const material = properties.map((path) => propertyValue(event.data, path)).map((value) => value ?? "").join("")
    + String(event.timestamp)
    + eventSecret;
  const calculated = createHash("sha256").update(material, "utf8").digest("hex");
  if (!secureEqualHex(calculated, checksum)) throw new Error("WOMPI_INVALID_CHECKSUM");

  if (typeof transaction.id !== "string" || transaction.id.length === 0) throw new Error("WOMPI_TRANSACTION_ID_MISSING");
  const amountInCents = transaction.amount_in_cents;
  if (typeof amountInCents !== "number" || !Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
    throw new Error("WOMPI_INVALID_AMOUNT");
  }
  if (typeof transaction.currency !== "string" || !/^[A-Z]{3}$/.test(transaction.currency)) {
    throw new Error("WOMPI_INVALID_CURRENCY");
  }
  if (typeof transaction.status !== "string") throw new Error("WOMPI_INVALID_STATUS");

  const status = transaction.status === "APPROVED"
    ? "APPROVED"
    : transaction.status === "DECLINED" || transaction.status === "ERROR" || transaction.status === "VOIDED"
      ? "DECLINED"
      : transaction.status === "PENDING" ? "PENDING" : "UNKNOWN";

  return QrPaymentObservationSchema.parse({
    external_transaction_id: transaction.id,
    external_reference: typeof transaction.reference === "string" ? transaction.reference : null,
    provider_code: "WOMPI",
    status,
    amount: scale6FromCents(amountInCents),
    currency_code: transaction.currency,
    payer_display_name: null,
    payer_reference: typeof transaction.customer_email === "string" ? transaction.customer_email : null,
    observed_at: new Date((event.timestamp as number) * 1000).toISOString(),
  });
}
