import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Narrow port so Payments owns confirmation timing without importing pharmacy
 * use-cases. The definitive revalidation runs inside the payment transaction.
 */
export interface PharmacySaleEligibilityPort {
  revalidateSaleEligibility(scope: SyncScope, saleId: string):
    | { kind: "OK" }
    | { kind: "DENIED"; reason: string };

  /**
   * Records that confirmed local coverage exists but dispensation cannot
   * proceed. Does **not** claim an external bank reversal.
   */
  recordPaymentReconciliationPending(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    saleId: string;
    reason: string;
    evidenceNote: string;
    correlationId: string;
    causationId: string | null;
  }): void;
}
