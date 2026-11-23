import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { SqliteAdminMetricsStore } from "./sqlite-admin-metrics-store.js";

/**
 * Inventory stock count remains gated by the operational stock-read permission
 * already enforced elsewhere. Sales/cash/payments aggregates require dedicated
 * REPORTING_* grants — never SALES_RECEIPT_READ, CASH_SHIFT_OPEN, or
 * PAYMENTS_PAYMENT_READ.
 */
export const PERMISSION_ADMIN_INVENTORY_READ = CanonicalPermission.INVENTORY_STOCK_READ;
export const PERMISSION_REPORTING_SALES_AGGREGATE_READ =
  CanonicalPermission.REPORTING_SALES_AGGREGATE_READ;
export const PERMISSION_REPORTING_CASH_AGGREGATE_READ =
  CanonicalPermission.REPORTING_CASH_AGGREGATE_READ;
export const PERMISSION_REPORTING_PAYMENTS_AGGREGATE_READ =
  CanonicalPermission.REPORTING_PAYMENTS_AGGREGATE_READ;

export interface AdminMetricsResult {
  readonly sales_completed_count: number | null;
  readonly sales_completed_amount: string | null;
  readonly inventory_tracked_count: number | null;
  readonly cash_open_shift_count: number | null;
  readonly payments_confirmed_count: number | null;
  readonly payments_confirmed_amount: string | null;
  readonly payments_confirmed_cash_amount: string | null;
  readonly payments_confirmed_transfer_amount: string | null;
  readonly payments_confirmed_qr_amount: string | null;
  readonly payments_pending_transfer_count: number | null;
}

export class GetAdminMetricsUseCase {
  constructor(private readonly store: SqliteAdminMetricsStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    at: Date = new Date(),
  ): { kind: "UNAUTHORIZED" } | { kind: "AVAILABLE"; metrics: AdminMetricsResult } {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);
    const assignments = toRoleAssignments(authSnapshot.claims);

    const allowed = (permission: string): boolean => evaluatePermission({
      actor, permission, scope: operationScope, at, assignments,
    }).allowed;

    const canAudit = allowed(CanonicalPermission.AUDIT_EVENT_READ);
    const canReadInventory = allowed(PERMISSION_ADMIN_INVENTORY_READ);
    const canReadSales = allowed(PERMISSION_REPORTING_SALES_AGGREGATE_READ);
    const canReadCash = allowed(PERMISSION_REPORTING_CASH_AGGREGATE_READ);
    const canReadPayments = allowed(PERMISSION_REPORTING_PAYMENTS_AGGREGATE_READ);

    // Surface gate: at least one administrative or reporting read must be present.
    // Cashiers with only operational grants stay unauthorized.
    if (!canAudit && !canReadInventory && !canReadSales && !canReadCash && !canReadPayments) {
      return { kind: "UNAUTHORIZED" };
    }

    const sales = canReadSales ? this.store.readSales(scope) : null;
    const inventory = canReadInventory ? this.store.readInventory(scope) : null;
    const cash = canReadCash ? this.store.readCash(scope) : null;
    const payments = canReadPayments ? this.store.readPayments(scope) : null;

    return {
      kind: "AVAILABLE",
      metrics: {
        sales_completed_count: sales?.count ?? null,
        sales_completed_amount: sales?.amount ?? null,
        inventory_tracked_count: inventory,
        cash_open_shift_count: cash,
        payments_confirmed_count: payments?.confirmed_count ?? null,
        payments_confirmed_amount: payments?.confirmed_amount ?? null,
        payments_confirmed_cash_amount: payments?.confirmed_cash_amount ?? null,
        payments_confirmed_transfer_amount: payments?.confirmed_transfer_amount ?? null,
        payments_confirmed_qr_amount: payments?.confirmed_qr_amount ?? null,
        payments_pending_transfer_count: payments?.pending_transfer_count ?? null,
      },
    };
  }
}
