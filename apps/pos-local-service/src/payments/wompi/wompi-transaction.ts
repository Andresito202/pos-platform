import * as z from "zod";
import type { PaymentProviderEvidence, PaymentProviderOutcome } from "../payment-provider-port.js";
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
 * `DECLINED` and `VOIDED` are commercial verdicts: Wompi is telling us the
 * transaction will not produce money, and both fold into `REJECTED`.
 *
 * `ERROR` is **not** one of them, and folding it into `REJECTED` (as this
 * function did until `D-3`) was wrong: `ERROR` is Wompi reporting that its
 * own processing failed, which says nothing about whether the customer was
 * charged. Treating it as rejection turned a failure of the provider into a
 * financial verdict against the customer. It is uncertainty, so it leaves
 * this function through `toPaymentProviderOutcome` as `UNKNOWN`, never here.
 */
export function mapWompiStatus(
  status: Exclude<WompiTransactionStatus, "ERROR">,
): PaymentProviderEvidence["status"] {
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
 * Converts a validated Wompi transaction into a boundary outcome.
 * `receivedAt` is when the caller obtained this evidence (query time or
 * webhook delivery time), not a Wompi-side timestamp — the port defines it
 * as receipt time, and Wompi's own timestamps are not part of the contract.
 *
 * A transaction Wompi reports as `ERROR` yields `UNKNOWN`: it is authentic,
 * it has a real id, but it carries no verdict this system may act on.
 */
export function toPaymentProviderOutcome(
  transaction: WompiTransaction,
  receivedAt: string,
): PaymentProviderOutcome {
  if (transaction.currency !== "COP") {
    throw new WompiCurrencyMismatchError(transaction.currency);
  }
  if (transaction.status === "ERROR") {
    return { kind: "UNKNOWN", reason: "PROVIDER_ERROR" };
  }

  const base: PaymentProviderEvidence = {
    providerCode: WOMPI_PROVIDER_CODE,
    providerReference: transaction.reference,
    providerTransactionId: transaction.id,
    amount: centsToAmount(transaction.amount_in_cents),
    currencyCode: "COP",
    status: mapWompiStatus(transaction.status),
    receivedAt,
  };

  const evidence = transaction.customer_email
    ? { ...base, payerReference: transaction.customer_email }
    : base;

  return { kind: "EVIDENCE", evidence };
}
