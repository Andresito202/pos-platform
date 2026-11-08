import { CanonicalPermission, type AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import type { LocalOperator } from "./local-operator-password.js";
import type { BoundSessionIdentity } from "../session/session-binding-registry.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { ServiceConfig } from "../config.js";

const ROLE_USER_IDS: Record<LocalOperator["role"], string> = {
  CAJERO: "00000000-0000-4000-8000-000000000001",
  SUPERVISOR: "00000000-0000-4000-8000-000000000002",
  ADMINISTRADOR: "00000000-0000-4000-8000-000000000003",
  SUPERADMINISTRADOR: "00000000-0000-4000-8000-000000000004",
};

const CAJERO_PERMISSIONS: readonly string[] = [
  CanonicalPermission.CASH_SHIFT_OPEN,
  CanonicalPermission.CASH_SHIFT_CLOSE,
  CanonicalPermission.SALES_SALE_CREATE,
  CanonicalPermission.SALES_RECEIPT_READ,
  CanonicalPermission.PAYMENTS_PAYMENT_REGISTER,
  CanonicalPermission.PAYMENTS_PAYMENT_READ,
  CanonicalPermission.PAYMENTS_TRANSFER_REPORT,
  CanonicalPermission.CATALOG_PRODUCT_READ,
  CanonicalPermission.CUSTOMERS_CUSTOMER_READ,
  CanonicalPermission.HARDWARE_READ,
  CanonicalPermission.HARDWARE_PRINT,
];

const SUPERVISOR_PERMISSIONS: readonly string[] = [
  ...CAJERO_PERMISSIONS,
  CanonicalPermission.INVENTORY_STOCK_READ,
  CanonicalPermission.INVENTORY_STOCK_RECEIVE,
  CanonicalPermission.INVENTORY_STOCK_ADJUST,
  CanonicalPermission.CATALOG_PRODUCT_REGISTER,
  CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER,
  CanonicalPermission.PAYMENTS_PAYMENT_CANCEL,
  CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM,
  CanonicalPermission.HARDWARE_DRAWER_OPEN,
];

const ADMIN_PERMISSIONS: readonly string[] = [
  ...SUPERVISOR_PERMISSIONS,
  CanonicalPermission.FISCAL_DOCUMENT_ISSUE,
  CanonicalPermission.AUDIT_EVENT_READ,
  CanonicalPermission.HARDWARE_CONFIGURE,
  CanonicalPermission.LICENSE_PLAN_MANAGE,
];

const ROLE_PERMISSIONS: Record<LocalOperator["role"], readonly string[]> = {
  CAJERO: CAJERO_PERMISSIONS,
  SUPERVISOR: SUPERVISOR_PERMISSIONS,
  ADMINISTRADOR: ADMIN_PERMISSIONS,
  SUPERADMINISTRADOR: ADMIN_PERMISSIONS,
};

export function developmentIdentityFor(operator: LocalOperator, expiresAt: string): BoundSessionIdentity {
  return {
    userId: ROLE_USER_IDS[operator.role],
    ssaSessionId: `dev-local-${operator.username}`,
    tenantMembershipId: "dev-local-membership",
    offlineValidUntil: expiresAt,
  };
}

export function developmentSnapshotFor(
  operator: LocalOperator,
  config: Pick<ServiceConfig, "tenant_id" | "company_id" | "branch_id" | "installation_id" | "device_id">,
  now: Date = new Date(),
): StoredAuthorizationSnapshot {
  const issued = now.toISOString();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  const permissions = ROLE_PERMISSIONS[operator.role].map((code) => ({ code, status: "ACTIVE" as const }));
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "00000000-0000-4000-8000-00000000dev1",
    user_id: ROLE_USER_IDS[operator.role],
    installation_id: config.installation_id,
    device_id: config.device_id,
    sequence: 1,
    issued_at: issued,
    expires_at: expires,
    assignments: [{
      tenant_id: config.tenant_id,
      company_id: config.company_id,
      branch_id: config.branch_id,
      status: "ACTIVE",
      valid_from: issued,
      valid_until: null,
      role_status: "ACTIVE",
      permissions,
    }],
    key_id: "DEV-LOCAL-OPERATOR",
  };
  return { claims, signature: "DEV-LOCAL-OPERATOR-NO-SIGNATURE", activatedAt: issued };
}

export function isDevelopmentLocalUser(userId: string): boolean {
  return Object.values(ROLE_USER_IDS).includes(userId);
}
