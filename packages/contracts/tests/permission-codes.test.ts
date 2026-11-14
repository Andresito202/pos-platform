import { describe, expect, it } from "vitest";
import { CANONICAL_PERMISSION_CODES, PermissionCode } from "../src/permission-codes.js";

describe("canonical permission catalog", () => {
  it("contains exactly the permission codes already enforced by executable backend use cases", () => {
    expect(CANONICAL_PERMISSION_CODES).toEqual([
      "LICENSE_PLAN_MANAGE",
      "HARDWARE_READ",
      "HARDWARE_CONFIGURE",
      "HARDWARE_PRINT",
      "HARDWARE_DRAWER_OPEN",
      "SALES_SALE_CREATE",
      "SALES_RECEIPT_READ",
      "INVENTORY_STOCK_READ",
      "INVENTORY_STOCK_RECEIVE",
      "INVENTORY_STOCK_ADJUST",
      "CATALOG_PRODUCT_READ",
      "CATALOG_PRODUCT_REGISTER",
      "CUSTOMERS_CUSTOMER_READ",
      "CUSTOMERS_CUSTOMER_REGISTER",
      "PAYMENTS_PAYMENT_READ",
      "PAYMENTS_PAYMENT_REGISTER",
      "PAYMENTS_PAYMENT_CANCEL",
      "PAYMENTS_TRANSFER_REPORT",
      "PAYMENTS_TRANSFER_CONFIRM",
      "CASH_SHIFT_OPEN",
      "CASH_SHIFT_CLOSE",
      "FISCAL_DOCUMENT_ISSUE",
      "AUDIT_EVENT_READ",
    ]);
  });

  it("contains no duplicate code and keeps the exported object aligned", () => {
    expect(new Set(CANONICAL_PERMISSION_CODES).size).toBe(CANONICAL_PERMISSION_CODES.length);
    expect(Object.values(PermissionCode)).toEqual(CANONICAL_PERMISSION_CODES);
  });
});
