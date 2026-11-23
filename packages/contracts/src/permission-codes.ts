/**
 * Canonical permission codes already materialized and enforced by the POS
 * runtime. This catalog contains only codes proven by executable backend
 * authorization checks; it does not invent the remaining conceptual entries
 * from the product permission matrix.
 *
 * Central authorization remains the issuer of grants. This file is a shared
 * vocabulary/contract, not a client-side authorization source.
 */
export const PermissionCode = {
  LICENSE_PLAN_MANAGE: "LICENSE_PLAN_MANAGE",
  HARDWARE_READ: "HARDWARE_READ",
  HARDWARE_CONFIGURE: "HARDWARE_CONFIGURE",
  HARDWARE_PRINT: "HARDWARE_PRINT",
  HARDWARE_DRAWER_OPEN: "HARDWARE_DRAWER_OPEN",
  SALES_SALE_CREATE: "SALES_SALE_CREATE",
  /** Cancel READY_FOR_PAYMENT / unpaid PAYMENT_IN_PROGRESS and release SALE holds. */
  SALES_SALE_CANCEL: "SALES_SALE_CANCEL",
  SALES_RECEIPT_READ: "SALES_RECEIPT_READ",
  INVENTORY_STOCK_READ: "INVENTORY_STOCK_READ",
  INVENTORY_STOCK_RECEIVE: "INVENTORY_STOCK_RECEIVE",
  INVENTORY_STOCK_ADJUST: "INVENTORY_STOCK_ADJUST",
  CATALOG_PRODUCT_READ: "CATALOG_PRODUCT_READ",
  CATALOG_PRODUCT_REGISTER: "CATALOG_PRODUCT_REGISTER",
  /** UC-CAT-002 — update/deactivate commercial product fields (not stock, not price). */
  CATALOG_PRODUCT_UPDATE: "CATALOG_PRODUCT_UPDATE",
  /** Publish a new active presentation price (supersedes prior ACTIVE price). */
  CATALOG_PRICE_PUBLISH: "CATALOG_PRICE_PUBLISH",
  /** Attach/replace/retire verified catalog media references (not arbitrary URLs). */
  CATALOG_MEDIA_MANAGE: "CATALOG_MEDIA_MANAGE",
  CUSTOMERS_CUSTOMER_READ: "CUSTOMERS_CUSTOMER_READ",
  CUSTOMERS_CUSTOMER_REGISTER: "CUSTOMERS_CUSTOMER_REGISTER",
  PAYMENTS_PAYMENT_READ: "PAYMENTS_PAYMENT_READ",
  PAYMENTS_PAYMENT_REGISTER: "PAYMENTS_PAYMENT_REGISTER",
  PAYMENTS_PAYMENT_CANCEL: "PAYMENTS_PAYMENT_CANCEL",
  PAYMENTS_TRANSFER_REPORT: "PAYMENTS_TRANSFER_REPORT",
  PAYMENTS_TRANSFER_CONFIRM: "PAYMENTS_TRANSFER_CONFIRM",
  /** Sensitive merchant recipient configuration; only explicitly provisioned GENERAL_ADMIN. */
  PAYMENTS_PROVIDER_CONFIGURE: "PAYMENTS_PROVIDER_CONFIGURE",
  /** Central BUSINESS administration of cash register master data. */
  CASH_REGISTER_MANAGE: "CASH_REGISTER_MANAGE",
  CASH_SHIFT_OPEN: "CASH_SHIFT_OPEN",
  CASH_SHIFT_CLOSE: "CASH_SHIFT_CLOSE",
  FISCAL_DOCUMENT_ISSUE: "FISCAL_DOCUMENT_ISSUE",
  AUDIT_EVENT_READ: "AUDIT_EVENT_READ",
  /** Pastelería: create/approve/retire versioned recipes and sector policies. */
  BAKERY_RECIPE_MANAGE: "BAKERY_RECIPE_MANAGE",
  /** Pastelería: plan/confirm production (posts via shared inventory transform). */
  BAKERY_PRODUCTION_EXECUTE: "BAKERY_PRODUCTION_EXECUTE",
  /** Pastelería: consult production orders, costs and genealogy. */
  BAKERY_PRODUCTION_READ: "BAKERY_PRODUCTION_READ",
  /**
   * Pastelería: authorize recipe deviations (omit/substitute/quantity variance).
   * Explicit grant only — not implied by Supervisor role or BAKERY_PRODUCTION_EXECUTE.
   */
  BAKERY_PRODUCTION_DEVIATE: "BAKERY_PRODUCTION_DEVIATE",
} as const;

export type CanonicalPermissionCode = (typeof PermissionCode)[keyof typeof PermissionCode];

export const CANONICAL_PERMISSION_CODES = Object.freeze(
  Object.values(PermissionCode),
) as readonly CanonicalPermissionCode[];
