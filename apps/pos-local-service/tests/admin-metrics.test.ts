import { describe, expect, it, vi } from "vitest";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { CanonicalPermission } from "@pos-platform/contracts";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";
import { GetAdminMetricsUseCase } from "../src/admin/get-admin-metrics-use-case.js";
import type { SqliteAdminMetricsStore } from "../src/admin/sqlite-admin-metrics-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const USER = "018f0000-0000-7000-8000-000000000006";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

function auth(permissions: string[]): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-07T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: "2026-09-07T10:00:00.000Z" };
}

function createStore(overrides: Partial<{
  readSales: ReturnType<typeof vi.fn>;
  readInventory: ReturnType<typeof vi.fn>;
  readCash: ReturnType<typeof vi.fn>;
  readPayments: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    readSales: overrides.readSales ?? vi.fn((_scope: SyncScope, options?: { businessDate?: string }) =>
      options?.businessDate
        ? { count: 2, amount: "400.000000" }
        : { count: 8, amount: "123456.000000" }),
    readInventory: overrides.readInventory ?? vi.fn(() => 21),
    readCash: overrides.readCash ?? vi.fn(() => 1),
    readPayments: overrides.readPayments ?? vi.fn(() => ({
      confirmed_count: 3,
      confirmed_amount: "9000.000000",
      confirmed_cash_amount: "5000.000000",
      confirmed_transfer_amount: "3000.000000",
      confirmed_qr_amount: "1000.000000",
      pending_transfer_count: 2,
    })),
  } as unknown as SqliteAdminMetricsStore & {
    readSales: ReturnType<typeof vi.fn>;
    readInventory: ReturnType<typeof vi.fn>;
    readCash: ReturnType<typeof vi.fn>;
    readPayments: ReturnType<typeof vi.fn>;
  };
}

const at = new Date("2026-09-07T15:00:00.000Z");
const businessDate = "2026-09-07";

const nullPayments = {
  payments_confirmed_count: null, payments_confirmed_amount: null,
  payments_confirmed_cash_amount: null, payments_confirmed_transfer_amount: null,
  payments_confirmed_qr_amount: null, payments_pending_transfer_count: null,
};

const scopeMeta = {
  metrics_scope: "INSTALLATION_BRANCH" as const,
  metrics_period_timezone: "America/Bogota" as const,
  metrics_business_date: businessDate,
};

describe("GetAdminMetricsUseCase", () => {
  it("rechaza usuario sin permisos de auditoría, inventario ni reporting", () => {
    expect(new GetAdminMetricsUseCase(createStore()).execute(
      SCOPE, auth([]), at,
    )).toEqual({ kind: "UNAUTHORIZED" });
  });

  it("rechaza perfil tipo Caja sin grants REPORTING_* ni auditoría", () => {
    expect(new GetAdminMetricsUseCase(createStore()).execute(
      SCOPE,
      auth([
        CanonicalPermission.SALES_SALE_CREATE,
        CanonicalPermission.SALES_RECEIPT_READ,
        CanonicalPermission.CASH_SHIFT_OPEN,
        CanonicalPermission.PAYMENTS_PAYMENT_REGISTER,
      ]),
      at,
    )).toEqual({ kind: "UNAUTHORIZED" });
  });

  it("auditoría sin Reporting deja agregados en null (no cero)", () => {
    const store = createStore();
    expect(new GetAdminMetricsUseCase(store).execute(
      SCOPE, auth([CanonicalPermission.AUDIT_EVENT_READ]), at,
    )).toEqual({
      kind: "AVAILABLE",
      metrics: {
        sales_completed_count: null, sales_completed_amount: null,
        sales_completed_today_count: null, sales_completed_today_amount: null,
        inventory_tracked_count: null, cash_open_shift_count: null,
        ...nullPayments, ...scopeMeta,
      },
    });
    expect(store.readSales).not.toHaveBeenCalled();
    expect(store.readCash).not.toHaveBeenCalled();
    expect(store.readPayments).not.toHaveBeenCalled();
  });

  it("no reutiliza permisos operativos para exponer agregados administrativos", () => {
    const store = createStore();
    const result = new GetAdminMetricsUseCase(store).execute(
      SCOPE,
      auth([
        CanonicalPermission.SALES_RECEIPT_READ,
        CanonicalPermission.INVENTORY_STOCK_READ,
        CanonicalPermission.CASH_SHIFT_OPEN,
        CanonicalPermission.PAYMENTS_PAYMENT_READ,
        CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM,
      ]),
      at,
    );
    expect(result).toEqual({
      kind: "AVAILABLE",
      metrics: {
        sales_completed_count: null, sales_completed_amount: null,
        sales_completed_today_count: null, sales_completed_today_amount: null,
        inventory_tracked_count: 21, cash_open_shift_count: null,
        ...nullPayments, ...scopeMeta,
      },
    });
    expect(store.readSales).not.toHaveBeenCalled();
    expect(store.readCash).not.toHaveBeenCalled();
    expect(store.readPayments).not.toHaveBeenCalled();
  });

  it("distingue cero real de null cuando hay grant REPORTING pero sin movimientos", () => {
    const store = createStore({
      readSales: vi.fn(() => ({ count: 0, amount: "0.000000" })),
      readCash: vi.fn(() => 0),
      readPayments: vi.fn(() => ({
        confirmed_count: 0,
        confirmed_amount: "0.000000",
        confirmed_cash_amount: "0.000000",
        confirmed_transfer_amount: "0.000000",
        confirmed_qr_amount: "0.000000",
        pending_transfer_count: 0,
      })),
    });
    expect(new GetAdminMetricsUseCase(store).execute(
      SCOPE,
      auth([
        CanonicalPermission.REPORTING_SALES_AGGREGATE_READ,
        CanonicalPermission.REPORTING_CASH_AGGREGATE_READ,
        CanonicalPermission.REPORTING_PAYMENTS_AGGREGATE_READ,
      ]),
      at,
    )).toEqual({
      kind: "AVAILABLE",
      metrics: {
        sales_completed_count: 0,
        sales_completed_amount: "0.000000",
        sales_completed_today_count: 0,
        sales_completed_today_amount: "0.000000",
        inventory_tracked_count: null,
        cash_open_shift_count: 0,
        payments_confirmed_count: 0,
        payments_confirmed_amount: "0.000000",
        payments_confirmed_cash_amount: "0.000000",
        payments_confirmed_transfer_amount: "0.000000",
        payments_confirmed_qr_amount: "0.000000",
        payments_pending_transfer_count: 0,
        ...scopeMeta,
      },
    });
  });

  it("habilita acumulado y ventas de hoy con filtro de fecha comercial America/Bogota", () => {
    const store = createStore();
    const result = new GetAdminMetricsUseCase(store).execute(
      SCOPE,
      auth([
        CanonicalPermission.AUDIT_EVENT_READ,
        CanonicalPermission.REPORTING_SALES_AGGREGATE_READ,
        CanonicalPermission.REPORTING_CASH_AGGREGATE_READ,
      ]),
      at,
    );
    expect(result).toEqual({
      kind: "AVAILABLE",
      metrics: {
        sales_completed_count: 8,
        sales_completed_amount: "123456.000000",
        sales_completed_today_count: 2,
        sales_completed_today_amount: "400.000000",
        inventory_tracked_count: null,
        cash_open_shift_count: 1,
        ...nullPayments, ...scopeMeta,
      },
    });
    expect(store.readSales).toHaveBeenNthCalledWith(1, SCOPE);
    expect(store.readSales).toHaveBeenNthCalledWith(2, SCOPE, { businessDate });
  });

  it("expone pagos confirmados sin tratar pendientes como recaudo", () => {
    const store = createStore();
    expect(new GetAdminMetricsUseCase(store).execute(
      SCOPE, auth([CanonicalPermission.REPORTING_PAYMENTS_AGGREGATE_READ]), at,
    )).toEqual({
      kind: "AVAILABLE",
      metrics: {
        sales_completed_count: null, sales_completed_amount: null,
        sales_completed_today_count: null, sales_completed_today_amount: null,
        inventory_tracked_count: null, cash_open_shift_count: null,
        payments_confirmed_count: 3,
        payments_confirmed_amount: "9000.000000",
        payments_confirmed_cash_amount: "5000.000000",
        payments_confirmed_transfer_amount: "3000.000000",
        payments_confirmed_qr_amount: "1000.000000",
        payments_pending_transfer_count: 2,
        ...scopeMeta,
      },
    });
  });

  it("usa fecha comercial Bogotá al cruzar medianoche UTC", () => {
    const store = createStore();
    // 2026-09-08 04:30 UTC = 2026-09-07 23:30 America/Bogota
    new GetAdminMetricsUseCase(store).execute(
      SCOPE, auth([CanonicalPermission.REPORTING_SALES_AGGREGATE_READ]),
      new Date("2026-09-08T04:30:00.000Z"),
    );
    expect(store.readSales).toHaveBeenNthCalledWith(2, SCOPE, { businessDate: "2026-09-07" });
  });
});
