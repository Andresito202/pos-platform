import type * as z from "zod";
import {
  AuthorizationCapabilitiesGetResponseSchema,
  CashShiftCloseResponseSchema,
  CashShiftOpenResponseSchema,
  CatalogItemResponseSchema,
  AdminMetricsGetResponseSchema,
  CatalogItemListResponseSchema,
  CatalogProductRegisterResponseSchema,
  CustomerReadResponseSchema,
  CustomerRegisterResponseSchema,
  FiscalDocumentIssueResponseSchema,
  FiscalNumberingSyncResponseSchema,
  InventoryMovementResponseSchema,
  InventoryStockGetResponseSchema,
  InventoryBatchListResponseSchema,
  InventoryBatchStatusResponseSchema,
  InventoryConversionRuleApproveResponseSchema,
  InventoryConversionExecuteResponseSchema,
  InventoryReservationCreateResponseSchema,
  InventoryReservationReleaseResponseSchema,
  WaitingCartResponseSchema,
  SalesReceiptGetResponseSchema,
  OperationConfirmResponseSchema,
  OperationResultResponseSchema,
  PaymentCancelResponseSchema,
  PaymentGetResponseSchema,
  PaymentRegisterCashResponseSchema,
  PaymentRegisterTransferResponseSchema,
  PaymentTransferConfirmResponseSchema,
  PaymentFactusPayCollectResponseSchema,
  PaymentFactusPayVerifyResponseSchema,
  PaymentFactusPayResumeResponseSchema,
  RuntimeHandshakeResponseSchema,
  RuntimeStatusResponseSchema,
  SaleCreateResponseSchema,
  SessionActivateResponseSchema,
  SessionRecoverResponseSchema,
  type IpcMessageType,
  CatalogPresentationRegisterResponseSchema,
  CatalogFoodPolicyUpsertResponseSchema,
  InventoryTransformExecuteResponseSchema,
  PharmacyEstablishmentUpsertResponseSchema,
  PharmacyProfileUpsertResponseSchema,
  PharmacyPrescriptionRegisterResponseSchema,
  PharmacyTechnicalReceiptRegisterResponseSchema,
  PharmacySanitaryAlertRegisterResponseSchema,
  BakeryRecipeDraftCreateResponseSchema,
  BakeryRecipeApproveResponseSchema,
  BakeryProductionOrderCreateResponseSchema,
  BakeryProductionOrderPlanResponseSchema,
  BakeryProductionReleaseResponseSchema,
  BakeryProductionDeviationAuthorizeResponseSchema,
  BakeryProductionConfirmResponseSchema,
  BakeryProductionTraceGetResponseSchema,
  LocalOperatorResponseSchema,
  HardwareResponseSchema,
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
  "authorization.capabilities.get": AuthorizationCapabilitiesGetResponseSchema,
  "session.activate": SessionActivateResponseSchema,
  "session.recover": SessionRecoverResponseSchema,
  "local.operator.login": LocalOperatorResponseSchema,
  "local.operator.session": LocalOperatorResponseSchema,
  "local.operator.logout": LocalOperatorResponseSchema,
  "hardware.command": HardwareResponseSchema,
  "cash.shift.open": CashShiftOpenResponseSchema,
  "cash.shift.close": CashShiftCloseResponseSchema,
  "sale.create": SaleCreateResponseSchema,
  "payment.register.cash": PaymentRegisterCashResponseSchema,
  "payment.register.transfer": PaymentRegisterTransferResponseSchema,
  "payment.transfer.confirm": PaymentTransferConfirmResponseSchema,
  "payment.factus_pay.collect": PaymentFactusPayCollectResponseSchema,
  "payment.factus_pay.verify": PaymentFactusPayVerifyResponseSchema,
  "payment.factus_pay.resume": PaymentFactusPayResumeResponseSchema,
  "payment.cancel": PaymentCancelResponseSchema,
  "payment.get": PaymentGetResponseSchema,
  "customer.register": CustomerRegisterResponseSchema,
  "customer.get": CustomerReadResponseSchema,
  "customer.find": CustomerReadResponseSchema,
  "fiscal.document.issue": FiscalDocumentIssueResponseSchema,
  "fiscal.numbering.sync": FiscalNumberingSyncResponseSchema,
  "catalog.product.register": CatalogProductRegisterResponseSchema,
  "catalog.presentation.register": CatalogPresentationRegisterResponseSchema,
  "catalog.food_policy.upsert": CatalogFoodPolicyUpsertResponseSchema,
  "pharmacy.establishment.upsert": PharmacyEstablishmentUpsertResponseSchema,
  "pharmacy.profile.upsert": PharmacyProfileUpsertResponseSchema,
  "pharmacy.prescription.register": PharmacyPrescriptionRegisterResponseSchema,
  "pharmacy.technical_receipt.register": PharmacyTechnicalReceiptRegisterResponseSchema,
  "pharmacy.sanitary_alert.register": PharmacySanitaryAlertRegisterResponseSchema,
  "bakery.recipe.draft.create": BakeryRecipeDraftCreateResponseSchema,
  "bakery.recipe.approve": BakeryRecipeApproveResponseSchema,
  "bakery.production.order.create": BakeryProductionOrderCreateResponseSchema,
  "bakery.production.order.plan": BakeryProductionOrderPlanResponseSchema,
  "bakery.production.release": BakeryProductionReleaseResponseSchema,
  "bakery.production.deviation.authorize": BakeryProductionDeviationAuthorizeResponseSchema,
  "bakery.production.confirm": BakeryProductionConfirmResponseSchema,
  "bakery.production.trace.get": BakeryProductionTraceGetResponseSchema,
  "catalog.item.find": CatalogItemResponseSchema,
  "catalog.item.get": CatalogItemResponseSchema,
  "catalog.item.list": CatalogItemListResponseSchema,
  "admin.metrics.get": AdminMetricsGetResponseSchema,
  "inventory.stock.receive": InventoryMovementResponseSchema,
  "inventory.stock.adjust": InventoryMovementResponseSchema,
  "inventory.stock.get": InventoryStockGetResponseSchema,
  "inventory.batch.list": InventoryBatchListResponseSchema,
  "inventory.batch.status": InventoryBatchStatusResponseSchema,
  "inventory.conversion.rule.approve": InventoryConversionRuleApproveResponseSchema,
  "inventory.conversion.execute": InventoryConversionExecuteResponseSchema,
  "inventory.reservation.create": InventoryReservationCreateResponseSchema,
  "inventory.reservation.release": InventoryReservationReleaseResponseSchema,
  "inventory.transform.execute": InventoryTransformExecuteResponseSchema,
  "cart.waiting.save": WaitingCartResponseSchema,
  "cart.waiting.list": WaitingCartResponseSchema,
  "cart.waiting.get": WaitingCartResponseSchema,
  "cart.waiting.discard": WaitingCartResponseSchema,
  "sales.receipt.get": SalesReceiptGetResponseSchema,
};

export function responseSchemaFor(messageType: IpcMessageType): z.ZodType {
  return IPC_RESPONSE_SCHEMA_BY_MESSAGE_TYPE[messageType];
}
