import { describe, expect, it } from "vitest";
import { CANONICAL_PERMISSION_CODES } from "@pos-platform/contracts";
import { PERMISSION_SALES_SALE_CREATE } from "../src/sales/create-sale-use-case.js";
import { PERMISSION_SALES_RECEIPT_READ } from "../src/receipts/get-receipt-use-case.js";
import { PERMISSION_INVENTORY_STOCK_READ } from "../src/inventory/get-stock-use-case.js";
import { PERMISSION_INVENTORY_STOCK_RECEIVE } from "../src/inventory/receive-stock-use-case.js";
import { PERMISSION_INVENTORY_STOCK_ADJUST } from "../src/inventory/adjust-stock-use-case.js";
import { PERMISSION_CATALOG_PRODUCT_READ } from "../src/catalog/find-catalog-item-use-case.js";
import { PERMISSION_CATALOG_PRODUCT_REGISTER } from "../src/catalog/register-product-use-case.js";
import { PERMISSION_CUSTOMERS_CUSTOMER_READ } from "../src/customers/get-customer-use-case.js";
import { PERMISSION_CUSTOMERS_CUSTOMER_REGISTER } from "../src/customers/register-customer-use-case.js";
import { PERMISSION_PAYMENTS_PAYMENT_READ } from "../src/payments/get-payment-use-case.js";
import { PERMISSION_PAYMENTS_PAYMENT_REGISTER } from "../src/payments/register-cash-payment-use-case.js";
import { PERMISSION_PAYMENTS_PAYMENT_CANCEL } from "../src/payments/cancel-payment-use-case.js";
import { PERMISSION_PAYMENTS_TRANSFER_REPORT } from "../src/payments/register-transfer-payment-use-case.js";
import { PERMISSION_PAYMENTS_TRANSFER_CONFIRM } from "../src/payments/confirm-transfer-payment-use-case.js";
import { PERMISSION_CASH_SHIFT_OPEN } from "../src/cash/open-cash-shift-use-case.js";
import { PERMISSION_CASH_SHIFT_CLOSE } from "../src/cash/close-cash-shift-use-case.js";
import { PERMISSION_FISCAL_DOCUMENT_ISSUE } from "../src/fiscal/issue-electronic-document-use-case.js";
import { PERMISSION_AUDIT_EVENT_READ } from "../src/audit/list-audit-events-use-case.js";

const EXECUTABLE_PERMISSION_CODES = [
  PERMISSION_SALES_SALE_CREATE,
  PERMISSION_SALES_RECEIPT_READ,
  PERMISSION_INVENTORY_STOCK_READ,
  PERMISSION_INVENTORY_STOCK_RECEIVE,
  PERMISSION_INVENTORY_STOCK_ADJUST,
  PERMISSION_CATALOG_PRODUCT_READ,
  PERMISSION_CATALOG_PRODUCT_REGISTER,
  PERMISSION_CUSTOMERS_CUSTOMER_READ,
  PERMISSION_CUSTOMERS_CUSTOMER_REGISTER,
  PERMISSION_PAYMENTS_PAYMENT_READ,
  PERMISSION_PAYMENTS_PAYMENT_REGISTER,
  PERMISSION_PAYMENTS_PAYMENT_CANCEL,
  PERMISSION_PAYMENTS_TRANSFER_REPORT,
  PERMISSION_PAYMENTS_TRANSFER_CONFIRM,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_FISCAL_DOCUMENT_ISSUE,
  PERMISSION_AUDIT_EVENT_READ,
] as const;

describe("runtime permission catalog alignment", () => {
  it("keeps every executable backend permission in the shared canonical catalog", () => {
    expect([...EXECUTABLE_PERMISSION_CODES].sort()).toEqual(
      [...CANONICAL_PERMISSION_CODES].sort(),
    );
  });

  it("contains no duplicate executable permission code", () => {
    expect(new Set(EXECUTABLE_PERMISSION_CODES).size).toBe(EXECUTABLE_PERMISSION_CODES.length);
  });
});
