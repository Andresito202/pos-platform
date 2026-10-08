import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { SqliteAdminMetricsStore } from "./sqlite-admin-metrics-store.js";

/**
 * The product matrix defines aggregate sales/cash visibility separately from
 * operational receipt/shift permissions. Until those canonical aggregate-read
 * grants are materialized in the central authorization package, these metrics
 * must remain unavailable rather than inheriting a broader operational grant.
 */
export const PERMISSION_ADMIN_INVENTORY_READ = "INVENTORY_STOCK_READ";

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

    const canReadInventory = evaluatePermission({
      actor, permission: PERMISSION_ADMIN_INVENTORY_READ, scope: operationScope, at, assignments,
    }).allowed;

    // Do not reuse SALES_RECEIPT_READ or CASH_SHIFT_OPEN here. Those permissions
    // authorize operational actions/reads, not branch-wide administrative
    // aggregates. Returning null is fail-closed until canonical aggregate-read
    // permissions are published by the central authorization authority.
    const sales = null;
    const inventory = canReadInventory ? this.store.readInventory(scope) : null;
    const cash = null;

    return {
      sales_completed_count: sales?.count ?? null,
      sales_completed_amount: sales?.amount ?? null,
      inventory_tracked_count: inventory,
      cash_open_shift_count: cash,
    };
  }
}
