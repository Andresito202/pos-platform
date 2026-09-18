import * as z from "zod";
import type { PaymentProviderEvidence } from "../payment-provider-port.js";
import { centsToAmount } from "./wompi-money.js";

export const WOMPI_PROVIDER_CODE = "WOMPI";

/**
 * Wompi's real transaction status enum (`GET /v1/transactions/{id}` and the
 * `transaction.updated` event carry the same set).
 */
export const WompiTransactionStatusSchema = z.enum([
  "APPROVED",
  "DECLINED",
  "VOIDED",
  "ERROR",
  "PENDING",
]);
export type WompiTransactionStatus = z.infer<typeof WompiTransactionStatusSchema>;

export const WompiTransactionSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  status: WompiTransactionStatusSchema,
  amount_in_cents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  customer_email: z.string().nullable().optional(),
});
export type WompiTransaction = z.infer<typeof WompiTransactionSchema>;

/**
 * `PaymentProviderPort` is a closed three-state contract (`PENDING` /
 * `APPROVED` / `REJECTED`) and this branch's task explicitly forbids adding
 * new internal states to accommodate Wompi. Wompi's `DECLINED`, `VOIDED` and
 * `ERROR` all mean the same thing to the domain: the transaction did not and
 * will not produce money — none of them is authoritative confirmation, so
 * all three fold into `REJECTED`. `APPROVED` and `PENDING` map directly.
 */
export function mapWompiStatus(status: WompiTransactionStatus): PaymentProviderEvidence["status"] {
  if (status === "APPROVED") return "APPROVED";
  if (status === "PENDING") return "PENDING";
  return "REJECTED";
}

export class WompiCurrencyMismatchError extends Error {
  constructor(readonly currency: string) {
    super(`Wompi transaction currency '${currency}' is not COP`);
    this.name = "WompiCurrencyMismatchError";
  }
}

/**
 * Converts a validated Wompi transaction into the boundary evidence type.
 * `receivedAt` is when the caller obtained this evidence (query time or
 * webhook delivery time), not a Wompi-side timestamp — the port defines it
 * as receipt time, and Wompi's own timestamps are not part of the contract.
 */
export function toPaymentProviderEvidence(
  transaction: WompiTransaction,
  receivedAt: string,
): PaymentProviderEvidence {
  if (transaction.currency !== "COP") {
    throw new WompiCurrencyMismatchError(transaction.currency);
  }

  const evidence: PaymentProviderEvidence = {
    providerCode: WOMPI_PROVIDER_CODE,
    providerReference: transaction.reference,
    providerTransactionId: transaction.id,
    amount: centsToAmount(transaction.amount_in_cents),
    currencyCode: "COP",
    status: mapWompiStatus(transaction.status),
    receivedAt,
  };

  return transaction.customer_email
    ? { ...evidence, payerReference: transaction.customer_email }
    : evidence;
}
