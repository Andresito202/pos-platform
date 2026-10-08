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

    const canReadSales = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_SALES_READ, scope: operationScope, at, assignments,
    }).allowed;
    const canReadInventory = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_INVENTORY_READ, scope: operationScope, at, assignments,
    }).allowed;
    const canReadCash = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_CASH_READ, scope: operationScope, at, assignments,
    }).allowed;

    const sales = canReadSales ? this.store.readSales(scope) : null;
    const inventory = canReadInventory ? this.store.readInventory(scope) : null;
    const cash = canReadCash ? this.store.readCash(scope) : null;

    return {
      sales_completed_count: sales?.count ?? null,
      sales_completed_amount: sales?.amount ?? null,
      inventory_tracked_count: inventory,
      cash_open_shift_count: cash,
    };
  }
}
