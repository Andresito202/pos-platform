import * as z from "zod";
import { createRequestEnvelopeSchema, createResponseEnvelopeSchema } from "./envelope.js";
import { RuntimeCompatibilitySnapshotSchema, RuntimeHandshakeOutcomeSchema } from "./handshake.js";
import {
  ContractVersionSchema,
  IdempotencyKeySchema,
  StableCodeSchema,
  VersionIdentifierSchema,
  UuidSchema,
} from "./primitives.js";
import {
  PaymentCancelRequestSchema,
  PaymentCancelResponseSchema,
  PaymentGetRequestSchema,
  PaymentGetResponseSchema,
  CreditAccountOpenRequestSchema,
  CreditAccountOpenResponseSchema,
  CreditAccountGetRequestSchema,
  CreditAccountGetResponseSchema,
  PaymentRegisterCreditRequestSchema,
  PaymentRegisterCreditResponseSchema,
  CreditPaymentRegisterRequestSchema,
  CreditPaymentRegisterResponseSchema,
  CustomerRegisterRequestSchema,
  CustomerRegisterResponseSchema,
  CustomerGetRequestSchema,
  CustomerFindRequestSchema,
  CustomerReadResponseSchema,
  FiscalDocumentIssueRequestSchema,
  FiscalDocumentIssueResponseSchema,
  CatalogProductRegisterRequestSchema,
  CatalogProductRegisterResponseSchema,
  CatalogFiscalAttributeSetRequestSchema,
  CatalogFiscalAttributeSetResponseSchema,
  CatalogPresentationAddRequestSchema,
  CatalogPresentationAddResponseSchema,
  CatalogConversionDeclareRequestSchema,
  CatalogConversionDeclareResponseSchema,
  InventoryConversionApplyRequestSchema,
  InventoryConversionApplyResponseSchema,
  CatalogItemFindRequestSchema,
  CatalogItemGetRequestSchema,
  CatalogItemResponseSchema,
  InventoryStockReceiveRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryMovementResponseSchema,
  InventoryStockGetRequestSchema,
  CatalogItemImportRequestSchema,
  InventoryLotReceiveRequestSchema,
  InventoryLotListRequestSchema,
  InventoryStockGetResponseSchema,
  SalesReceiptGetRequestSchema,
  SalesReceiptGetResponseSchema,
  PaymentRegisterCashRequestSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferRequestSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentRegisterQrRequestSchema,
  PaymentRegisterQrResponseSchema,
  PaymentTransferConfirmRequestSchema,
  PaymentTransferConfirmResponseSchema,
  CashShiftCloseRequestSchema,
  CashShiftCloseResponseSchema,
  CashShiftOpenRequestSchema,
  CashShiftOpenResponseSchema,
  SaleCreateRequestSchema,
  SaleCreateResponseSchema,
  SessionActivateRequestSchema,
  SessionActivateResponseSchema,
  SessionRecoverRequestSchema,
  SessionRecoverResponseSchema,
} from "./ipc-commercial.js";

export const IpcMessageTypeSchema = z.enum([
  "runtime.handshake",
  "runtime.status.get",
  "operation.result.get",
  "operation.confirm",
  // Operaciones comerciales V1 — `DEC-014` §3.1. Sus esquemas viven en
  // `ipc-commercial.ts`; aquí se incorporan al transporte.
  "session.activate",
  "session.recover",
  "cash.shift.open",
  "cash.shift.close",
  "sale.create",
  "payment.register.cash",
  "payment.register.transfer",
  "payment.register.qr",
  "payment.transfer.confirm",
  "payment.cancel",
  "payment.get",
  "payment.register.credit",
  "credit.account.open",
  "credit.account.get",
  "credit.payment.register",
  "customer.register",
  "customer.get",
  "customer.find",
  "fiscal.document.issue",
  "catalog.product.register",
  "catalog.fiscal.attribute.set",
  "catalog.presentation.add",
  "catalog.conversion.declare",
  "catalog.item.find",
  "catalog.item.get",
  "catalog.item.import",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.conversion.apply",
  "inventory.stock.get",
  "inventory.lot.receive",
  "inventory.lot.list",
  "sales.receipt.get",
]);

const EmptyPayloadSchema = z.strictObject({});

export const RuntimeHandshakeRequestSchema = createRequestEnvelopeSchema(
  RuntimeCompatibilitySnapshotSchema,
).safeExtend({ message_type: z.literal("runtime.handshake") });

export const RuntimeHandshakeResponseSchema = createResponseEnvelopeSchema(RuntimeHandshakeOutcomeSchema);

export const RuntimeStatusRequestSchema = createRequestEnvelopeSchema(
  EmptyPayloadSchema,
).safeExtend({ message_type: z.literal("runtime.status.get") });

export const RuntimeStatusResultSchema = z.strictObject({
  service_version: ContractVersionSchema,
  protocol_version: ContractVersionSchema,
  service_state: StableCodeSchema,
  schema_version: VersionIdentifierSchema,
});

export const RuntimeStatusResponseSchema = createResponseEnvelopeSchema(RuntimeStatusResultSchema);

export const OperationResultQuerySchema = z.strictObject({
  operation_id: UuidSchema,
  idempotency_key: IdempotencyKeySchema,
});

export const OperationResultRequestSchema = createRequestEnvelopeSchema(
  OperationResultQuerySchema,
).safeExtend({ message_type: z.literal("operation.result.get") });

export const OperationResultStatusSchema = z.enum([
  "NOT_FOUND",
  "PENDING",
  "SUCCEEDED",
  "REJECTED",
  "UNKNOWN",
]);

export const OperationResultSchema = z.strictObject({
  operation_id: UuidSchema,
  idempotency_key: IdempotencyKeySchema,
  status: OperationResultStatusSchema,
  result_code: StableCodeSchema,
});

export const OperationResultResponseSchema = createResponseEnvelopeSchema(OperationResultSchema);

export const OperationConfirmationSchema = z.strictObject({
  operation_type: StableCodeSchema,
  payload: z.json(),
});

export const OperationConfirmRequestSchema = createRequestEnvelopeSchema(
  OperationConfirmationSchema,
).safeExtend({ message_type: z.literal("operation.confirm") });

export const OperationConfirmResultSchema = z.strictObject({
  operation_id: UuidSchema,
  status: OperationResultStatusSchema,
  result_code: StableCodeSchema,
});

export const OperationConfirmResponseSchema = createResponseEnvelopeSchema(OperationConfirmResultSchema);

export type IpcMessageType = z.infer<typeof IpcMessageTypeSchema>;
export type OperationResultQuery = z.infer<typeof OperationResultQuerySchema>;
export type OperationConfirmation = z.infer<typeof OperationConfirmationSchema>;


export const IpcRequestSchema = z.union([
  RuntimeHandshakeRequestSchema,
  RuntimeStatusRequestSchema,
  OperationResultRequestSchema,
  OperationConfirmRequestSchema,
  SessionActivateRequestSchema,
  SessionRecoverRequestSchema,
  CashShiftOpenRequestSchema,
  CashShiftCloseRequestSchema,
  SaleCreateRequestSchema,
  PaymentRegisterCashRequestSchema,
  PaymentRegisterTransferRequestSchema,
  PaymentRegisterQrRequestSchema,
  PaymentTransferConfirmRequestSchema,
  PaymentCancelRequestSchema,
  PaymentGetRequestSchema,
  PaymentRegisterCreditRequestSchema,
  CreditAccountOpenRequestSchema,
  CreditAccountGetRequestSchema,
  CreditPaymentRegisterRequestSchema,
  CustomerRegisterRequestSchema,
  CustomerGetRequestSchema,
  CustomerFindRequestSchema,
  FiscalDocumentIssueRequestSchema,
  CatalogProductRegisterRequestSchema,
  CatalogFiscalAttributeSetRequestSchema,
  CatalogPresentationAddRequestSchema,
  CatalogConversionDeclareRequestSchema,
  InventoryConversionApplyRequestSchema,
  CatalogItemFindRequestSchema,
  CatalogItemGetRequestSchema,
  InventoryStockReceiveRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryStockGetRequestSchema,
  CatalogItemImportRequestSchema,
  InventoryLotReceiveRequestSchema,
  InventoryLotListRequestSchema,
  SalesReceiptGetRequestSchema,
]);

export const IpcResponseSchema = z.union([
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  OperationResultResponseSchema,
  OperationConfirmResponseSchema,
  SessionActivateResponseSchema,
  SessionRecoverResponseSchema,
  CashShiftOpenResponseSchema,
  CashShiftCloseResponseSchema,
  SaleCreateResponseSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentRegisterQrResponseSchema,
  PaymentTransferConfirmResponseSchema,
  PaymentCancelResponseSchema,
  PaymentGetResponseSchema,
  PaymentRegisterCreditResponseSchema,
  CreditAccountOpenResponseSchema,
  CreditAccountGetResponseSchema,
  CreditPaymentRegisterResponseSchema,
  CustomerRegisterResponseSchema,
  CustomerReadResponseSchema,
  FiscalDocumentIssueResponseSchema,
  CatalogProductRegisterResponseSchema,
  CatalogFiscalAttributeSetResponseSchema,
  CatalogPresentationAddResponseSchema,
  CatalogConversionDeclareResponseSchema,
  InventoryConversionApplyResponseSchema,
  CatalogItemResponseSchema,
  InventoryMovementResponseSchema,
  InventoryStockGetResponseSchema,
  SalesReceiptGetResponseSchema,
]);

export type IpcRequest = z.infer<typeof IpcRequestSchema>;
export type IpcResponse = z.infer<typeof IpcResponseSchema>;
