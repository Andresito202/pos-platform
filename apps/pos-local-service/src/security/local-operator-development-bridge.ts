import { createHash, randomUUID } from "node:crypto";
import { CanonicalPermission, type AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import type { LocalOperator } from "./local-operator-password.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { ServiceConfig } from "../config.js";

/**
 * EXPLICITLY LOCAL authority. This is NOT an SSA, SAS, signature, enrollment,
 * commercial permission grant, or replacement for Central.
 *
 * Only the Local Service creates this projection after password verification
 * and associates it with a server-assigned connection ID. The existing
 * use-case RBAC engine consumes its grants; the renderer cannot assert them.
 * Nothing from this projection is persisted as a SignedAuthorizationSnapshot.
 */
const CASHIER = [
  CanonicalPermission.CASH_SHIFT_OPEN,
  CanonicalPermission.CASH_SHIFT_CLOSE,
  CanonicalPermission.SALES_SALE_CREATE,
  CanonicalPermission.SALES_RECEIPT_READ,
  CanonicalPermission.PAYMENTS_PAYMENT_REGISTER,
  CanonicalPermission.PAYMENTS_PAYMENT_READ,
  CanonicalPermission.PAYMENTS_TRANSFER_REPORT,
  CanonicalPermission.CATALOG_PRODUCT_READ,
  CanonicalPermission.CUSTOMERS_CUSTOMER_READ,
] as const;

const SUPERVISOR = [
  // Supervision is not a cashier superset: no shift, sale or collection grants.
  CanonicalPermission.SALES_RECEIPT_READ,
  CanonicalPermission.PAYMENTS_PAYMENT_READ,
  CanonicalPermission.CATALOG_PRODUCT_READ,
  CanonicalPermission.CUSTOMERS_CUSTOMER_READ,
  CanonicalPermission.INVENTORY_STOCK_READ,
  CanonicalPermission.INVENTORY_STOCK_RECEIVE,
  CanonicalPermission.INVENTORY_STOCK_ADJUST,
  CanonicalPermission.CATALOG_PRODUCT_REGISTER,
  CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER,
  CanonicalPermission.PAYMENTS_PAYMENT_CANCEL,
  CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM,
] as const;

const ADMINISTRATOR = [
  ...SUPERVISOR,
  CanonicalPermission.AUDIT_EVENT_READ,
] as const;

// No local permission to provision commercial BUSINESS licences, issue fiscal
// documents against FACTUS, or control hardware without physical certification.
export const LOCAL_OPERATOR_PERMISSIONS: Readonly<Record<LocalOperator["role"], readonly string[]>> = Object.freeze({
  CAJERO: CASHIER,
  SUPERVISOR,
  ADMINISTRADOR: ADMINISTRATOR,
  // Owner decision 2026-11-13: business operation in the server-bound company.
  // This does not grant GLOBAL authority or company switching.
  SUPERADMINISTRADOR: [...CASHIER, ...ADMINISTRATOR],
});

function stableUserId(installationId: string, username: LocalOperator["username"]): string {
  const hash = createHash("sha256").update(`camacho-local-operator-v1:${installationId}:${username}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export type LocalAuthorizedSession = {
  readonly username: LocalOperator["username"];
  readonly role: LocalOperator["role"];
  readonly sessionId: string;
  readonly expiresAt: string;
};

/**
 * This is a use-case RBAC projection, NOT a cryptographically signed
 * authorization artifact. signature is deliberately empty and may NEVER be
 * written to the signed-snapshot store or used in commercial native login.
 */
export function localOperatorAuthorization(
  session: LocalAuthorizedSession,
  config: Pick<ServiceConfig, "tenant_id" | "company_id" | "branch_id" | "installation_id" | "device_id">,
  at: Date = new Date(),
): { readonly userId: string; readonly snapshot: StoredAuthorizationSnapshot } {
  if (at.getTime() >= Date.parse(session.expiresAt)) throw Error("LOCAL_OPERATOR_SESSION_EXPIRED");
  const userId = stableUserId(config.installation_id, session.username);
  const issuedAt = new Date(at.getTime() - 1000).toISOString();
  const codes = [...new Set(LOCAL_OPERATOR_PERMISSIONS[session.role])];
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: randomUUID(),
    user_id: userId,
    installation_id: config.installation_id,
    device_id: config.device_id,
    sequence: 1,
    issued_at: issuedAt,
    expires_at: session.expiresAt,
    key_id: "LOCAL_DEVELOPMENT_INTERNAL",
    assignments: [{
      tenant_id: config.tenant_id,
      company_id: config.company_id,
      branch_id: config.branch_id,
      status: "ACTIVE",
      role_status: "ACTIVE",
      valid_from: issuedAt,
      valid_until: session.expiresAt,
      permissions: codes.map(code => ({code, status:"ACTIVE" as const})),
    }],
  };
  return { userId, snapshot: { claims, signature: "", activatedAt: issuedAt } };
}

