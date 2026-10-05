import * as z from "zod";
import { UuidSchema, ExpectedVersionSchema } from "./primitives.js";

/**
 * QR-001 — static destination configuration.
 *
 * The QR itself is presentation data; it is never payment authority. A static
 * QR identifies the destination account/address only. Verification of money
 * received must come from an authenticated provider/bank observation.
 */
export const QrStaticDestinationSchema = z.strictObject({
  provider_code: z.string().min(1).max(32).regex(/^[A-Z][A-Z0-9_]*$/),
  display_name: z.string().min(1).max(120),
  qr_image_data_url: z.string().min(1).max(2_000_000),
  destination_reference: z.string().min(1).max(160),
  active: z.boolean(),
});

export type QrStaticDestination = z.infer<typeof QrStaticDestinationSchema>;

/**
 * Evidence emitted by a trusted external payment provider.
 *
 * `payer_display_name` is nullable because providers are not required to expose
 * a payer identity. The POS must never manufacture one from untrusted input.
 */
export const QrPaymentObservationSchema = z.strictObject({
  external_transaction_id: z.string().min(1).max(160),
  external_reference: z.string().min(1).max(160).nullable(),
  provider_code: z.string().min(1).max(32).regex(/^[A-Z][A-Z0-9_]*$/),
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "UNKNOWN"]),
  amount: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{6}$/),
  currency_code: z.string().length(3).regex(/^[A-Z]{3}$/),
  payer_display_name: z.string().min(1).max(200).nullable(),
  payer_reference: z.string().min(1).max(200).nullable(),
  observed_at: z.string().datetime({ offset: true }),
});

export type QrPaymentObservation = z.infer<typeof QrPaymentObservationSchema>;

/**
 * Result of correlating provider evidence to one pending POS payment.
 * Ambiguity is explicit: equal-amount concurrent sales must never be guessed.
 */
export const QrPaymentMatchOutcomeSchema = z.enum([
  "MATCHED",
  "PENDING",
  "DECLINED",
  "UNKNOWN",
  "AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
  "AMBIGUOUS",
  "DUPLICATE_EXTERNAL_TRANSACTION",
]);

export const QrPaymentMatchSchema = z.strictObject({
  outcome: QrPaymentMatchOutcomeSchema,
  payment_id: UuidSchema.nullable(),
  sale_id: UuidSchema.nullable(),
  expected_amount: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{6}$/).nullable(),
  observed_amount: z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{6}$/).nullable(),
  payer_display_name: z.string().min(1).max(200).nullable(),
  external_transaction_id: z.string().min(1).max(160).nullable(),
  version: ExpectedVersionSchema.nullable(),
});

export type QrPaymentMatch = z.infer<typeof QrPaymentMatchSchema>;
