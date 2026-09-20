import type { QrPaymentObservation, QrPaymentMatch } from "@pos-platform/contracts";

export interface PendingQrPayment {
  readonly paymentId: string;
  readonly saleId: string;
  readonly expectedAmount: string;
  readonly currencyCode: string;
  readonly version: number;
}

/**
 * Correlates trusted provider evidence to pending QR payments without guessing.
 *
 * The caller must have already authenticated and deduplicated the provider
 * observation. This function is deliberately pure so it can be exercised before
 * wiring it into the Local Service transaction boundary.
 */
export function matchQrPaymentObservation(
  observation: QrPaymentObservation,
  pendingPayments: readonly PendingQrPayment[],
  seenExternalTransactionIds: ReadonlySet<string>,
): QrPaymentMatch {
  if (seenExternalTransactionIds.has(observation.external_transaction_id)) {
    return {
      outcome: "DUPLICATE_EXTERNAL_TRANSACTION",
      payment_id: null,
      sale_id: null,
      expected_amount: null,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  if (observation.status === "PENDING") {
    return {
      outcome: "PENDING",
      payment_id: null,
      sale_id: null,
      expected_amount: null,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  if (observation.status === "DECLINED") {
    return {
      outcome: "DECLINED",
      payment_id: null,
      sale_id: null,
      expected_amount: null,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  if (observation.status !== "APPROVED") {
    return {
      outcome: "UNKNOWN",
      payment_id: null,
      sale_id: null,
      expected_amount: null,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  const currencyMatches = pendingPayments.filter((payment) => payment.currencyCode === observation.currency_code);
  if (currencyMatches.length === 0) {
    return {
      outcome: "CURRENCY_MISMATCH",
      payment_id: null,
      sale_id: null,
      expected_amount: null,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  const amountMatches = currencyMatches.filter((payment) => payment.expectedAmount === observation.amount);
  if (amountMatches.length === 0) {
    return {
      outcome: "AMOUNT_MISMATCH",
      payment_id: null,
      sale_id: null,
      expected_amount: currencyMatches[0]!.expectedAmount,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  if (amountMatches.length !== 1) {
    return {
      outcome: "AMBIGUOUS",
      payment_id: null,
      sale_id: null,
      expected_amount: observation.amount,
      observed_amount: observation.amount,
      payer_display_name: observation.payer_display_name,
      external_transaction_id: observation.external_transaction_id,
      version: null,
    };
  }

  const payment = amountMatches[0]!;
  return {
    outcome: "MATCHED",
    payment_id: payment.paymentId,
    sale_id: payment.saleId,
    expected_amount: payment.expectedAmount,
    observed_amount: observation.amount,
    payer_display_name: observation.payer_display_name,
    external_transaction_id: observation.external_transaction_id,
    version: payment.version,
  };
}
