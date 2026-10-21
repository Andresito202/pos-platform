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
  HARDWARE_READ: "HARDWARE_READ",
  HARDWARE_CONFIGURE: "HARDWARE_CONFIGURE",
  HARDWARE_PRINT: "HARDWARE_PRINT",
  HARDWARE_DRAWER_OPEN: "HARDWARE_DRAWER_OPEN",
  SALES_SALE_CREATE: "SALES_SALE_CREATE",
  SALES_RECEIPT_READ: "SALES_RECEIPT_READ",
  INVENTORY_STOCK_READ: "INVENTORY_STOCK_READ",
  INVENTORY_STOCK_RECEIVE: "INVENTORY_STOCK_RECEIVE",
  INVENTORY_STOCK_ADJUST: "INVENTORY_STOCK_ADJUST",
  CATALOG_PRODUCT_READ: "CATALOG_PRODUCT_READ",
  CATALOG_PRODUCT_REGISTER: "CATALOG_PRODUCT_REGISTER",
  CUSTOMERS_CUSTOMER_READ: "CUSTOMERS_CUSTOMER_READ",
  CUSTOMERS_CUSTOMER_REGISTER: "CUSTOMERS_CUSTOMER_REGISTER",
  PAYMENTS_PAYMENT_READ: "PAYMENTS_PAYMENT_READ",
  PAYMENTS_PAYMENT_REGISTER: "PAYMENTS_PAYMENT_REGISTER",
  PAYMENTS_PAYMENT_CANCEL: "PAYMENTS_PAYMENT_CANCEL",
  PAYMENTS_TRANSFER_REPORT: "PAYMENTS_TRANSFER_REPORT",
  PAYMENTS_TRANSFER_CONFIRM: "PAYMENTS_TRANSFER_CONFIRM",
  CASH_SHIFT_OPEN: "CASH_SHIFT_OPEN",
  CASH_SHIFT_CLOSE: "CASH_SHIFT_CLOSE",
  FISCAL_DOCUMENT_ISSUE: "FISCAL_DOCUMENT_ISSUE",
  AUDIT_EVENT_READ: "AUDIT_EVENT_READ",
} as const;

export type CanonicalPermissionCode = (typeof PermissionCode)[keyof typeof PermissionCode];

export const CANONICAL_PERMISSION_CODES = Object.freeze(
  Object.values(PermissionCode),
) as readonly CanonicalPermissionCode[];
