import { createHash, timingSafeEqual } from "node:crypto";
import * as z from "zod";
import type { PaymentProviderEvidence } from "../payment-provider-port.js";
import { WompiTransactionSchema } from "./wompi-transaction.js";
import { toPaymentProviderEvidence } from "./wompi-transaction.js";

export interface WompiEventsCredentials {
  readonly eventsSecret: string;
}

export class WompiWebhookMalformedError extends Error {
  constructor(reason: string) {
    super(`Wompi webhook payload is malformed: ${reason}`);
    this.name = "WompiWebhookMalformedError";
  }
}

export class WompiWebhookUnsupportedEventError extends Error {
  constructor(readonly event: string) {
    super(`Wompi webhook event '${event}' is not handled by this normalizer`);
    this.name = "WompiWebhookUnsupportedEventError";
  }
}

export class WompiWebhookSignatureInvalidError extends Error {
  constructor() {
    super("Wompi webhook checksum does not match the signed properties");
    this.name = "WompiWebhookSignatureInvalidError";
  }
}

const WompiWebhookEnvelopeSchema = z.object({
  event: z.string().min(1),
  data: z.object({
    transaction: WompiTransactionSchema,
  }),
  sent_at: z.string().min(1),
  timestamp: z.number().int(),
  signature: z.object({
    properties: z.array(z.string().min(1)).min(1),
    checksum: z.string().min(1),
  }),
});
export type WompiWebhookEnvelope = z.infer<typeof WompiWebhookEnvelopeSchema>;

const TRANSACTION_UPDATED_EVENT = "transaction.updated";

function resolveDotPath(root: unknown, path: string): string {
  const value = path.split(".").reduce<unknown>((node, key) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[key];
  }, root);

  if (value === undefined || value === null) {
    throw new WompiWebhookMalformedError(`signed property '${path}' is missing from the event payload`);
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new WompiWebhookMalformedError(`signed property '${path}' is not a primitive value`);
  }
  return String(value);
}

/**
 * Wompi's event integrity check: SHA-256 of the concatenation, in the order
 * `signature.properties` declares, of the values those dot-paths resolve to
 * inside `data`, followed by `timestamp`, followed by the merchant's events
 * secret. Paths are walked generically rather than hardcoded so a Wompi
 * payload that signs a different property set is still verified correctly.
 */
function computeWompiChecksum(envelope: WompiWebhookEnvelope, eventsSecret: string): string {
  const concatenated = envelope.signature.properties
    .map((path) => resolveDotPath(envelope.data, path))
    .join("");
  return createHash("sha256")
    .update(concatenated + String(envelope.timestamp) + eventsSecret, "utf8")
    .digest("hex");
}

export function verifyWompiWebhookChecksum(
  envelope: WompiWebhookEnvelope,
  credentials: WompiEventsCredentials,
): boolean {
  const expected = computeWompiChecksum(envelope, credentials.eventsSecret);
  const received = envelope.signature.checksum.toLowerCase();

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Normalizes a `transaction.updated` Wompi webhook into the boundary
 * evidence type. Rejects anything that is not that exact event, fails
 * schema validation, or fails checksum verification — a webhook is an
 * untrusted input (`DEC-016` §6 rule 5) and must never reach the payment
 * store as authoritative evidence unverified.
 */
export async function normalizeWompiTransactionUpdatedEvent(
  rawPayload: unknown,
  credentials: WompiEventsCredentials,
  receivedAt: string = new Date().toISOString(),
): Promise<PaymentProviderEvidence> {
  const parsed = WompiWebhookEnvelopeSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new WompiWebhookMalformedError(parsed.error.message);
  }
  const envelope = parsed.data;

  if (envelope.event !== TRANSACTION_UPDATED_EVENT) {
    throw new WompiWebhookUnsupportedEventError(envelope.event);
  }

  if (!verifyWompiWebhookChecksum(envelope, credentials)) {
    throw new WompiWebhookSignatureInvalidError();
  }

  return toPaymentProviderEvidence(envelope.data.transaction, receivedAt);
}
