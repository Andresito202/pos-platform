import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

export interface AdminMetrics {
  readonly salesCompletedCount: number;
  readonly salesCompletedAmount: string;
  readonly inventoryTrackedCount: number;
  readonly cashOpenShiftCount: number;
}

export class SqliteAdminMetricsStore {
  constructor(private readonly database: LocalDatabase) {}

  read(scope: SyncScope): AdminMetrics {
    const sales = this.database.native.prepare(
      `SELECT fiscal_total_amount
       FROM sales_sales
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND status='COMPLETED'`,
    ).all(scope.tenantId, scope.companyId, scope.branchId) as Array<{ fiscal_total_amount: string }>;

    const inventory = this.database.native.prepare(
      `SELECT count(*) AS count
       FROM inventory_stock
       WHERE tenant_id=? AND company_id=? AND branch_id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as { count: number };

    const cash = this.database.native.prepare(
      `SELECT count(*) AS count
       FROM cash_shift
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND status IN ('OPEN','CLOSING')`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as { count: number };

    // Dashboard read only. Money stays integer-at-scale-6; JavaScript floating
    // point is deliberately not used for a financial total.
    const amountUnits = sales.reduce((sum, row) => sum + scale6ToBigInt(row.fiscal_total_amount), 0n);

    return {
      salesCompletedCount: sales.length,
      salesCompletedAmount: bigIntToScale6(amountUnits),
      salesCompletedAmount: amount,
      inventoryTrackedCount: inventory.count,
      cashOpenShiftCount: cash.count,
    };
  }
}
