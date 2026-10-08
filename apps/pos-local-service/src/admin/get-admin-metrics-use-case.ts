import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { SqliteAdminMetricsStore } from "./sqlite-admin-metrics-store.js";

export const PERMISSION_ADMIN_SALES_READ = "SALES_RECEIPT_READ";
export const PERMISSION_ADMIN_INVENTORY_READ = "INVENTORY_STOCK_READ";
export const PERMISSION_ADMIN_CASH_READ = "CASH_SHIFT_OPEN";

export interface AdminMetricsResult {
  readonly sales_completed_count: number | null;
  readonly sales_completed_amount: string | null;
  readonly inventory_tracked_count: number | null;
  readonly cash_open_shift_count: number | null;
}

export class GetAdminMetricsUseCase {
  constructor(private readonly store: SqliteAdminMetricsStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    at: Date = new Date(),
  ): AdminMetricsResult {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);
    const assignments = toRoleAssignments(authSnapshot.claims);
    const metrics = this.store.read(scope);

    const canReadSales = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_SALES_READ, scope: operationScope, at, assignments,
    }).allowed;
    const canReadInventory = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_INVENTORY_READ, scope: operationScope, at, assignments,
    }).allowed;
    const canReadCash = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_CASH_READ, scope: operationScope, at, assignments,
    }).allowed;

    return {
      sales_completed_count: canReadSales ? metrics.salesCompletedCount : null,
      sales_completed_amount: canReadSales ? metrics.salesCompletedAmount : null,
      inventory_tracked_count: canReadInventory ? metrics.inventoryTrackedCount : null,
      cash_open_shift_count: canReadCash ? metrics.cashOpenShiftCount : null,
    };
  }
}
