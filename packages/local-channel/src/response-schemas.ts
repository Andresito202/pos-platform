import type * as z from "zod";
import {
  CashShiftCloseResponseSchema,
  CashShiftOpenResponseSchema,
  CatalogItemResponseSchema,
  CatalogProductRegisterResponseSchema,
  CustomerReadResponseSchema,
  CustomerRegisterResponseSchema,
  FiscalDocumentIssueResponseSchema,
  InventoryMovementResponseSchema,
  InventoryStockGetResponseSchema,
  SalesReceiptGetResponseSchema,
  OperationConfirmResponseSchema,
  OperationResultResponseSchema,
  PaymentCancelResponseSchema,
  PaymentGetResponseSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentRegisterQrResponseSchema,
  PaymentTransferConfirmResponseSchema,
  PaymentRegisterCreditResponseSchema,
  CreditAccountOpenResponseSchema,
  CreditAccountGetResponseSchema,
  CreditPaymentRegisterResponseSchema,
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  SaleCreateResponseSchema,
  SessionActivateResponseSchema,
  SessionRecoverResponseSchema,
  type IpcMessageType,
} from "@pos-platform/contracts";

/**
 * Qué esquema de respuesta corresponde a cada operación del canal.
 *
 * Antes no existía: el cliente decidía con dos ternarios y mandaba **todo lo
 * que no fuera `runtime.status.get` ni `operation.confirm`** a
 * `OperationResultResponseSchema`, un `strictObject` de cuatro campos. Las 19
 * operaciones comerciales caían ahí, así que **ninguna respuesta comercial se
 * podía parsear**: un `SaleCreateResult` no tiene `operation_id` ni
 * `idempotency_key`, y el `strictObject` lo rechaza.
 *
 * No se declara ningún contrato nuevo: la tabla **referencia** los esquemas que
 * `@pos-platform/contracts` ya exporta. Y el tipo es
 * `Record<IpcMessageType, …>`, de modo que **añadir una operación al contrato
 * sin darle su respuesta rompe la compilación** — que es exactamente lo que no
 * ocurrió cuando se añadieron las 19.
 *
 * Tres operaciones comparten esquema de respuesta porque el contrato ya las
 * unificó: `customer.get`/`customer.find` en `CustomerReadResponseSchema`,
 * `catalog.item.find`/`catalog.item.get` en `CatalogItemResponseSchema`, y
 * `inventory.stock.receive`/`inventory.stock.adjust` en
 * `InventoryMovementResponseSchema`.
 */
export const IPC_RESPONSE_SCHEMA_BY_MESSAGE_TYPE: Record<IpcMessageType, z.ZodType> = {
  "runtime.handshake": RuntimeHandshakeResponseSchema,
  "runtime.status.get": RuntimeStatusResponseSchema,
  "operation.result.get": OperationResultResponseSchema,
  "operation.confirm": OperationConfirmResponseSchema,
  "session.activate": SessionActivateResponseSchema,
  "session.recover": SessionRecoverResponseSchema,
  "cash.shift.open": CashShiftOpenResponseSchema,
  "cash.shift.close": CashShiftCloseResponseSchema,
  "sale.create": SaleCreateResponseSchema,
  "payment.register.cash": PaymentRegisterCashResponseSchema,
  "payment.register.transfer": PaymentRegisterTransferResponseSchema,
  "payment.register.qr": PaymentRegisterQrResponseSchema,
  "payment.transfer.confirm": PaymentTransferConfirmResponseSchema,
  "payment.cancel": PaymentCancelResponseSchema,
  "payment.get": PaymentGetResponseSchema,
  "payment.register.credit": PaymentRegisterCreditResponseSchema,
  "credit.account.open": CreditAccountOpenResponseSchema,
  "credit.account.get": CreditAccountGetResponseSchema,
  "credit.payment.register": CreditPaymentRegisterResponseSchema,
  "customer.register": CustomerRegisterResponseSchema,
  "customer.get": CustomerReadResponseSchema,
  "customer.find": CustomerReadResponseSchema,
  "fiscal.document.issue": FiscalDocumentIssueResponseSchema,
  "catalog.product.register": CatalogProductRegisterResponseSchema,
  "catalog.item.find": CatalogItemResponseSchema,
  "catalog.item.get": CatalogItemResponseSchema,
  "inventory.stock.receive": InventoryMovementResponseSchema,
  "inventory.stock.adjust": InventoryMovementResponseSchema,
  "inventory.stock.get": InventoryStockGetResponseSchema,
  "sales.receipt.get": SalesReceiptGetResponseSchema,
};

export function responseSchemaFor(messageType: IpcMessageType): z.ZodType {
  return IPC_RESPONSE_SCHEMA_BY_MESSAGE_TYPE[messageType];
}
