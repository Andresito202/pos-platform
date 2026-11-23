import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

export type PaymentsAggregate = {
  readonly confirmed_count: number;
  readonly confirmed_amount: string;
  readonly confirmed_cash_amount: string;
  readonly confirmed_transfer_amount: string;
  readonly confirmed_qr_amount: string;
  readonly pending_transfer_count: number;
};

export class SqliteAdminMetricsStore {
  constructor(private readonly database: LocalDatabase) {}

  readSales(scope: SyncScope): { readonly count: number; readonly amount: string } {
    const rows = this.database.native.prepare(
      `SELECT fiscal_total_amount
       FROM sales_sales
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND status='COMPLETED'`,
    ).all(scope.tenantId, scope.companyId, scope.branchId) as Array<{ fiscal_total_amount: string }>;

    const amountUnits = rows.reduce(
      (sum, row) => sum + scale6ToBigInt(row.fiscal_total_amount),
      0n,
    );
    return { count: rows.length, amount: bigIntToScale6(amountUnits) };
  }

  readInventory(scope: SyncScope): number {
    const row = this.database.native.prepare(
      `SELECT count(*) AS count
       FROM inventory_stock
       WHERE tenant_id=? AND company_id=? AND branch_id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as { count: number };
    return row.count;
  }

  readCash(scope: SyncScope): number {
    const row = this.database.native.prepare(
      `SELECT count(*) AS count
       FROM cash_shift
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND status IN ('OPEN','CLOSING')`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as { count: number };
    return row.count;
  }

  /**
   * Collected money = CONFIRMED payments only. CREATED/PENDING/CANCELLED/FAILED
   * transfers are never summed into confirmed amounts. Method totals are taken
   * from `confirmed_amount` (scale-6 text → bigint), not JavaScript number.
   */
  readPayments(scope: SyncScope): PaymentsAggregate {
    const confirmed = this.database.native.prepare(
      `SELECT payment_method, confirmed_amount
       FROM payments_payments
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND status='CONFIRMED'`,
    ).all(scope.tenantId, scope.companyId, scope.branchId) as Array<{
      payment_method: string;
      confirmed_amount: string;
    }>;

    let total = 0n;
    let cash = 0n;
    let transfer = 0n;
    let qr = 0n;
    for (const row of confirmed) {
      const amount = scale6ToBigInt(row.confirmed_amount);
      total += amount;
      if (row.payment_method === "CASH") cash += amount;
      else if (row.payment_method === "TRANSFER") transfer += amount;
      else if (row.payment_method === "QR") qr += amount;
    }

    const pending = this.database.native.prepare(
      `SELECT count(*) AS count
       FROM payments_payments
       WHERE tenant_id=? AND company_id=? AND branch_id=?
         AND payment_method='TRANSFER'
         AND status IN ('CREATED','PENDING','REVIEW_REQUIRED')`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as { count: number };

    return {
      confirmed_count: confirmed.length,
      confirmed_amount: bigIntToScale6(total),
      confirmed_cash_amount: bigIntToScale6(cash),
      confirmed_transfer_amount: bigIntToScale6(transfer),
      confirmed_qr_amount: bigIntToScale6(qr),
      pending_transfer_count: pending.count,
    };
  }
}
