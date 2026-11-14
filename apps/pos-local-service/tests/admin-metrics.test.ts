import { describe, expect, it } from "vitest";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
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

const SCOPE: SyncScope = { tenantId: TENANT, companyId: COMPANY, branchId: BRANCH, deviceId: DEVICE, installationId: INSTALL };

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

const store = {
  readSales: () => ({ count: 8, amount: "123456.000000" }),
  readInventory: () => 21,
  readCash: () => 1,
} as unknown as SqliteAdminMetricsStore;

describe("GetAdminMetricsUseCase", () => {
  it("no reutiliza permisos operativos para exponer agregados administrativos", () => {
    const result = new GetAdminMetricsUseCase(store).execute(
      SCOPE, auth(["SALES_RECEIPT_READ", "INVENTORY_STOCK_READ", "CASH_SHIFT_OPEN"]),
      new Date("2026-09-07T10:00:00.000Z"),
    );
    expect(result).toEqual({
      sales_completed_count: null, sales_completed_amount: null,
      inventory_tracked_count: 21, cash_open_shift_count: null,
    });
  });

  it("no amplía acceso cuando el snapshot no tiene permisos de lectura", () => {
    expect(new GetAdminMetricsUseCase(store).execute(
      SCOPE, auth([]), new Date("2026-09-07T10:00:00.000Z"),
    )).toEqual({
      sales_completed_count: null, sales_completed_amount: null,
      inventory_tracked_count: null, cash_open_shift_count: null,
    });
  });
});
