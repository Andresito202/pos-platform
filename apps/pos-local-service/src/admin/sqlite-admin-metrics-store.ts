import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

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
}
