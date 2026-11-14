import { LocalOperatorLoginRequestSchema, LocalOperatorSessionRequestSchema, LocalOperatorLogoutRequestSchema, LocalOperatorResponseSchema } from "./ipc-local-operator.js";
import * as z from "zod";
import {NativeCommercialBeginRequestSchema,NativeCommercialCompleteRequestSchema,NativeCommercialCancelRequestSchema,NativeCommercialCommitRequestSchema,NativeCommercialLogoutRequestSchema,NativeCommercialResponseSchema} from "./ipc-native-commercial.js";
import { HardwareRequestSchema,HardwareResponseSchema } from "./hardware.js";
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
  CustomerRegisterRequestSchema,
  CustomerRegisterResponseSchema,
  CustomerGetRequestSchema,
  CustomerFindRequestSchema,
  CustomerMarketingSubscribeRequestSchema,
  CustomerMarketingUnsubscribeRequestSchema,
  CustomerMarketingGetRequestSchema,
  CustomerMarketingSubscribeResponseSchema,
  CustomerMarketingUnsubscribeResponseSchema,
  CustomerMarketingGetResponseSchema,
  CustomerReadResponseSchema,
  FiscalDocumentIssueRequestSchema,
  FiscalDocumentIssueResponseSchema,
  CatalogProductRegisterRequestSchema,
  CatalogProductRegisterResponseSchema,
  CatalogItemFindRequestSchema,
  CatalogItemGetRequestSchema,
  CatalogItemListRequestSchema,
  CatalogItemListResponseSchema,
  CatalogItemResponseSchema,
  InventoryStockReceiveRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryMovementResponseSchema,
  InventoryStockGetRequestSchema,
  InventoryStockGetResponseSchema,
  SalesReceiptGetRequestSchema,
  SalesReceiptGetResponseSchema,
  PaymentRegisterCashRequestSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferRequestSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentTransferConfirmRequestSchema,
  PaymentTransferConfirmResponseSchema,
  CashShiftCloseRequestSchema,
  CashShiftCloseResponseSchema,
  CashShiftOpenRequestSchema,
  CashShiftOpenResponseSchema,
  SaleCreateRequestSchema,
  WaitingCartSaveRequestSchema,
  WaitingCartListRequestSchema,
  WaitingCartGetRequestSchema,
  WaitingCartDiscardRequestSchema,
  SaleCreateResponseSchema,
  WaitingCartResponseSchema,
  AuthorizationCapabilitiesGetRequestSchema,
  AuthorizationCapabilitiesGetResponseSchema,
  SessionActivateRequestSchema,
  SessionActivateResponseSchema,
  SessionRecoverRequestSchema,
  SessionRecoverResponseSchema,
  AuditEventListRequestSchema,
  AuditEventListResponseSchema,
  LicenseOffersListRequestSchema,
  AdminMetricsGetRequestSchema,
  LicenseOffersListResponseSchema,
  AdminMetricsGetResponseSchema,
} from "./ipc-commercial.js";

export const IpcMessageTypeSchema = z.enum([
  "commercial.native.begin","commercial.native.complete","commercial.native.cancel","commercial.native.commit",
  "commercial.native.logout",
  "local.operator.login","local.operator.session","local.operator.logout",
  "hardware.command",
  "runtime.handshake",
  "runtime.status.get",
  "operation.result.get",
  "operation.confirm",
  // Operaciones comerciales V1 — `DEC-014` §3.1. Sus esquemas viven en
  // `ipc-commercial.ts`; aquí se incorporan al transporte.
  "authorization.capabilities.get",
  "session.activate",
  "session.recover",
  "cash.shift.open",
  "cash.shift.close",
  "sale.create",
  "cart.waiting.save",
  "cart.waiting.list",
  "cart.waiting.get",
  "cart.waiting.discard",
  "payment.register.cash",
  "payment.register.transfer",
  "payment.transfer.confirm",
  "payment.cancel",
  "payment.get",
  "customer.register",
  "customer.get",
  "customer.find",
  "customer.marketing.subscribe",
  "customer.marketing.unsubscribe",
  "customer.marketing.get",
  "fiscal.document.issue",
  "catalog.product.register",
  "catalog.item.find",
  "catalog.item.get",
  "catalog.item.list",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.stock.get",
  "sales.receipt.get",
  "audit.event.list",
  "admin.metrics.get",
  "license.offers.list",
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
  NativeCommercialBeginRequestSchema,NativeCommercialCompleteRequestSchema,NativeCommercialCancelRequestSchema,NativeCommercialCommitRequestSchema,
  NativeCommercialLogoutRequestSchema,
  LocalOperatorLoginRequestSchema,LocalOperatorSessionRequestSchema,LocalOperatorLogoutRequestSchema,
  HardwareRequestSchema,
  RuntimeHandshakeRequestSchema,
  RuntimeStatusRequestSchema,
  OperationResultRequestSchema,
  OperationConfirmRequestSchema,
  AuthorizationCapabilitiesGetRequestSchema,
  SessionActivateRequestSchema,
  SessionRecoverRequestSchema,
  CashShiftOpenRequestSchema,
  CashShiftCloseRequestSchema,
  SaleCreateRequestSchema,
  WaitingCartSaveRequestSchema,
  WaitingCartListRequestSchema,
  WaitingCartGetRequestSchema,
  WaitingCartDiscardRequestSchema,
  PaymentRegisterCashRequestSchema,
  PaymentRegisterTransferRequestSchema,
  PaymentTransferConfirmRequestSchema,
  PaymentCancelRequestSchema,
  PaymentGetRequestSchema,
  CustomerRegisterRequestSchema,
  CustomerGetRequestSchema,
  CustomerFindRequestSchema,
  CustomerMarketingSubscribeRequestSchema,
  CustomerMarketingUnsubscribeRequestSchema,
  CustomerMarketingGetRequestSchema,
  FiscalDocumentIssueRequestSchema,
  CatalogProductRegisterRequestSchema,
  CatalogItemFindRequestSchema,
  CatalogItemGetRequestSchema,
  CatalogItemListRequestSchema,
  InventoryStockReceiveRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryStockGetRequestSchema,
  SalesReceiptGetRequestSchema,
  AuditEventListRequestSchema,
  LicenseOffersListRequestSchema,
  AdminMetricsGetRequestSchema,
]);

export const IpcResponseSchema = z.union([
  NativeCommercialResponseSchema,
  LocalOperatorResponseSchema,
  HardwareResponseSchema,
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  OperationResultResponseSchema,
  OperationConfirmResponseSchema,
  AuthorizationCapabilitiesGetResponseSchema,
  SessionActivateResponseSchema,
  SessionRecoverResponseSchema,
  CashShiftOpenResponseSchema,
  CashShiftCloseResponseSchema,
  SaleCreateResponseSchema,
  WaitingCartResponseSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentTransferConfirmResponseSchema,
  PaymentCancelResponseSchema,
  PaymentGetResponseSchema,
  CustomerRegisterResponseSchema,
  CustomerMarketingSubscribeResponseSchema,
  CustomerMarketingUnsubscribeResponseSchema,
  CustomerMarketingGetResponseSchema,
  CustomerReadResponseSchema,
  FiscalDocumentIssueResponseSchema,
  CatalogProductRegisterResponseSchema,
  CatalogItemResponseSchema,
  CatalogItemListResponseSchema,
  InventoryMovementResponseSchema,
  InventoryStockGetResponseSchema,
  SalesReceiptGetResponseSchema,
  AuditEventListResponseSchema,
  LicenseOffersListResponseSchema,
  AdminMetricsGetResponseSchema,
]);

export type IpcRequest = z.infer<typeof IpcRequestSchema>;
export type IpcResponse = z.infer<typeof IpcResponseSchema>;
