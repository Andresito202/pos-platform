import { describe, expect, it, vi } from "vitest";
import { CanonicalPermission } from "@pos-platform/contracts";
import { ListAuditEventsUseCase } from "../src/audit/list-audit-events-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SqliteAuditStore } from "../src/audit/sqlite-audit-store.js";

const TENANT = "11111111-1111-7111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-7222-8222-222222222222";
const COMPANY = "33333333-3333-7333-8333-333333333333";
const BRANCH = "44444444-4444-7444-8444-444444444444";
const USER = "55555555-5555-7555-8555-555555555555";

const request = {
  query: "",
  actionCode: null,
  resourceType: null,
  actorType: null,
  from: null,
  to: null,
  limit: 20,
  offset: 0,
} as const;

function snapshot(
  assignmentTenant = TENANT,
  permissionCode: string = CanonicalPermission.AUDIT_EVENT_READ,
): StoredAuthorizationSnapshot {
  return {
    claims: {
      snapshot_id: "66666666-6666-7666-8666-666666666666",
      user_id: USER,
      installation_id: "77777777-7777-7777-8777-777777777777",
      device_id: "88888888-8888-7888-8888-888888888888",
      sequence: 1,
      issued_at: "2026-10-08T00:00:00.000Z",
      expires_at: "2026-10-09T00:00:00.000Z",
      key_id: "SSA-2026-01",
      assignments: [{
        tenant_id: assignmentTenant,
        company_id: COMPANY,
        branch_id: BRANCH,
        status: "ACTIVE",
        valid_from: "2026-10-01T00:00:00.000Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: [{ code: permissionCode, status: "ACTIVE" }],
      }],
    },
    signature: "A".repeat(96),
    activatedAt: "2026-10-08T00:00:00.000Z",
  };
}

function store() {
  return {
    list: vi.fn().mockReturnValue({ events: [], hasMore: false }),
  } as unknown as SqliteAuditStore;
}

describe("ListAuditEventsUseCase authorization", () => {
  it("allows audit read only with the canonical audit permission", () => {
    const auditStore = store();
    const result = new ListAuditEventsUseCase(auditStore).execute(
      { tenantId: TENANT, companyId: COMPANY, branchId: BRANCH },
      snapshot(),
      request,
      new Date("2026-10-08T12:00:00.000Z"),
    );

    expect(result).toEqual({ kind: "FOUND", events: [], hasMore: false });
    expect(auditStore.list).toHaveBeenCalledTimes(1);
  });

  it("denies audit read when the permission is absent and does not query the store", () => {
    const auditStore = store();
    const result = new ListAuditEventsUseCase(auditStore).execute(
      { tenantId: TENANT, companyId: COMPANY, branchId: BRANCH },
      snapshot(TENANT, CanonicalPermission.SALES_RECEIPT_READ),
      request,
      new Date("2026-10-08T12:00:00.000Z"),
    );

    expect(result.kind).toBe("UNAUTHORIZED");
    expect(auditStore.list).not.toHaveBeenCalled();
  });

  it("denies an assignment from another tenant even when it carries audit read", () => {
    const auditStore = store();
    const result = new ListAuditEventsUseCase(auditStore).execute(
      { tenantId: TENANT, companyId: COMPANY, branchId: BRANCH },
      snapshot(OTHER_TENANT),
      request,
      new Date("2026-10-08T12:00:00.000Z"),
    );

    expect(result.kind).toBe("UNAUTHORIZED");
    expect(auditStore.list).not.toHaveBeenCalled();
  });
});
