import * as z from "zod";
import { PERMISSION_CATALOG_PRODUCT_REGISTER } from "../catalog/register-product-use-case.js";
import { PERMISSION_CATALOG_PRODUCT_READ } from "../catalog/find-catalog-item-use-case.js";
import { PERMISSION_CASH_SHIFT_OPEN } from "../cash/open-cash-shift-use-case.js";
import { PERMISSION_CASH_SHIFT_CLOSE } from "../cash/close-cash-shift-use-case.js";
import { PERMISSION_SALES_SALE_CREATE } from "../sales/create-sale-use-case.js";
import { PERMISSION_FISCAL_DOCUMENT_ISSUE } from "../fiscal/issue-electronic-document-use-case.js";
import { PERMISSION_CUSTOMERS_CUSTOMER_REGISTER } from "../customers/register-customer-use-case.js";
import { PERMISSION_CUSTOMERS_CUSTOMER_READ } from "../customers/get-customer-use-case.js";
import { PERMISSION_CUSTOMERS_CREDIT_REPAYMENT_REGISTER } from "../credit/register-credit-repayment-use-case.js";
import { PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_MANAGE } from "../credit/open-credit-account-use-case.js";
import { PERMISSION_PAYMENTS_CREDIT_AUTHORIZE } from "../credit/register-credit-payment-use-case.js";
import { PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_READ } from "../credit/get-credit-account-use-case.js";
import { PERMISSION_SALES_RECEIPT_READ } from "../receipts/get-receipt-use-case.js";
import { PERMISSION_INVENTORY_STOCK_RECEIVE } from "../inventory/receive-stock-use-case.js";
import { PERMISSION_INVENTORY_STOCK_READ } from "../inventory/get-stock-use-case.js";
import { PERMISSION_INVENTORY_STOCK_ADJUST } from "../inventory/adjust-stock-use-case.js";
import { PERMISSION_PAYMENTS_PAYMENT_REGISTER } from "../payments/register-cash-payment-use-case.js";
import { PERMISSION_PAYMENTS_TRANSFER_REPORT } from "../payments/register-transfer-payment-use-case.js";
import { PERMISSION_PAYMENTS_TRANSFER_CONFIRM } from "../payments/confirm-transfer-payment-use-case.js";
import { PERMISSION_PAYMENTS_PAYMENT_CANCEL } from "../payments/cancel-payment-use-case.js";
import { PERMISSION_PAYMENTS_PAYMENT_READ } from "../payments/get-payment-use-case.js";
import { PERMISSION_CASH_DRAWER_OPEN_MANUAL } from "../hardware/cash-drawer/open-cash-drawer-use-case.js";
import {
  PERMISSION_PAYMENTS_REFUND_APPROVE,
  PERMISSION_PAYMENTS_REFUND_EXECUTE_CASH,
  PERMISSION_PAYMENTS_REFUND_REQUEST,
  PERMISSION_SALES_RETURN_APPROVE,
  PERMISSION_SALES_RETURN_EXECUTE,
  PERMISSION_SALES_RETURN_REQUEST,
} from "../returns/create-sale-return-use-case.js";

/**
 * Repartos de permisos **de ejemplo**, para revisar pantallas por rol antes
 * de que exista una política de roles ratificada.
 *
 * ## Qué NO es esto
 *
 * **No es `SEC-G03`** (Authorization RBAC/ABAC, `PLANNED / NOT_EVALUATED` en
 * `docs/product/backlog.md`). `SEC-G03` decide qué rol existe, qué permisos
 * lleva cada uno y quién los asigna; eso es política de negocio y de
 * seguridad, y no se infiere. Este catálogo es tres repartos de ejemplo sobre
 * los permisos que **ya existen y ya gobiernan cada operación** —los mismos
 * `PERMISSION_*` que cada caso de uso evalúa—, para poder ver qué pantalla
 * responde y cuál dice `UNAUTHORIZED` según el rol activo. Cuando exista la
 * decisión de `SEC-G03`, este fichero se sustituye por ella, no se amplía.
 *
 * Los permisos se **importan**, nunca se repiten como cadena suelta: si un
 * caso de uso cambia su código de permiso, este catálogo dejaría de compilar
 * en vez de quedarse callado con un permiso que ya no gobierna nada.
 */
export const DevRolePresetIdSchema = z.enum(["ADMIN", "SUPERVISOR", "CAJERO"]);
export type DevRolePresetId = z.infer<typeof DevRolePresetIdSchema>;

const CAJERO_PERMISSIONS = [
  PERMISSION_SALES_SALE_CREATE,
  PERMISSION_SALES_RECEIPT_READ,
  PERMISSION_PAYMENTS_PAYMENT_REGISTER,
  PERMISSION_PAYMENTS_PAYMENT_READ,
  PERMISSION_PAYMENTS_TRANSFER_REPORT,
  PERMISSION_CASH_SHIFT_OPEN,
  PERMISSION_CASH_SHIFT_CLOSE,
  PERMISSION_CATALOG_PRODUCT_READ,
  PERMISSION_INVENTORY_STOCK_READ,
  PERMISSION_CUSTOMERS_CUSTOMER_READ,
  PERMISSION_CUSTOMERS_CUSTOMER_REGISTER,
  PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_READ,
  PERMISSION_CUSTOMERS_CREDIT_REPAYMENT_REGISTER,
  // `permission-matrix.md`, fila «Devolver venta»: el cajero sólo solicita.
  PERMISSION_SALES_RETURN_REQUEST,
] as const;

const SUPERVISOR_PERMISSIONS = [
  ...CAJERO_PERMISSIONS,
  PERMISSION_CATALOG_PRODUCT_REGISTER,
  PERMISSION_INVENTORY_STOCK_RECEIVE,
  PERMISSION_INVENTORY_STOCK_ADJUST,
  PERMISSION_PAYMENTS_PAYMENT_CANCEL,
  PERMISSION_PAYMENTS_TRANSFER_CONFIRM,
  PERMISSION_CUSTOMERS_CREDIT_ACCOUNT_MANAGE,
  PERMISSION_PAYMENTS_CREDIT_AUTHORIZE,
  // Misma fila: el supervisor devuelve. El reembolso es de Payments y la fila
  // no lo concede (`permission-matrix.md` §Segregación, regla 5).
  PERMISSION_SALES_RETURN_APPROVE,
  PERMISSION_SALES_RETURN_EXECUTE,
] as const;

const ADMIN_PERMISSIONS = [
  ...SUPERVISOR_PERMISSIONS,
  PERMISSION_FISCAL_DOCUMENT_ISSUE,
  // Ratificado el 2026-09-26 sólo para OWNER y GENERAL_ADMIN (`D-46`): de los
  // tres repartos de ejemplo, únicamente éste lo representa.
  PERMISSION_CASH_DRAWER_OPEN_MANUAL,
  PERMISSION_PAYMENTS_REFUND_REQUEST,
  PERMISSION_PAYMENTS_REFUND_APPROVE,
  PERMISSION_PAYMENTS_REFUND_EXECUTE_CASH,
] as const;

/** Únicos por rol: repetir un código no amplía nada y sólo alargaría la lista. */
function unique(codes: readonly string[]): readonly string[] {
  return [...new Set(codes)];
}

export const DEV_ROLE_PRESETS: Readonly<Record<DevRolePresetId, readonly string[]>> = {
  CAJERO: unique(CAJERO_PERMISSIONS),
  SUPERVISOR: unique(SUPERVISOR_PERMISSIONS),
  ADMIN: unique(ADMIN_PERMISSIONS),
};
