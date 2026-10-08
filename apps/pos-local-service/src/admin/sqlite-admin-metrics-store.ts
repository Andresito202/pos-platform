import type { LocalDatabase } from "@pos-platform/database-sqlite";
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
      `SELECT count(*) AS count,
              COALESCE(SUM(CAST(fiscal_total_amount AS REAL)), 0) AS amount
       FROM sales_sales
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND status='COMPLETED'`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as { count: number; amount: number };

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

    // Dashboard read only. The amount is re-canonicalized from the persisted
    // scale-6 text without moving calculation authority into the renderer.
    const amount = Number.isFinite(sales.amount) ? sales.amount.toFixed(6) : "0.000000";

    return {
      salesCompletedCount: sales.count,
      salesCompletedAmount: amount,
      inventoryTrackedCount: inventory.count,
      cashOpenShiftCount: cash.count,
    };
  }
}
