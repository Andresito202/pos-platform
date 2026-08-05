# Catálogo de eventos del dominio

## Objetivo

Definir eventos relevantes para desacoplar módulos, habilitar sincronización, auditoría, tiempo real y procesos secundarios.

## Convenciones

Cada evento deberá incluir:

- event_id;
- event_type;
- occurred_at;
- tenant_id;
- company_id;
- branch_id cuando aplique;
- actor_id;
- device_id cuando aplique;
- correlation_id;
- causation_id;
- payload_version.

## Identidad y seguridad

### UserRegistered

Emitido cuando se crea un usuario.

### UserActivated

### UserDeactivated

### UserRoleAssigned

### UserRoleRevoked

### SessionCreated

### SessionRevoked

### MfaEnabled

### SensitiveChangeRequested

### SensitiveChangeConfirmed

### SecurityAlertRaised

## Empresas y sucursales

### CompanyCreated

### CompanyUpdated

### BranchCreated

### BranchUpdated

### BranchDeactivated

### PaymentAccountChanged

Este evento requiere tratamiento de alta criticidad.

## Dispositivos y licencias

### DeviceRegistered

### DeviceRevoked

### LicenseActivated

### LicenseEnteredGracePeriod

### LicenseRestricted

### LicenseSuspended

### LicenseReactivated

### FeatureEnabled

### FeatureDisabled

## Catálogo y precios

### ProductCreated

### ProductUpdated

### ProductDeactivated

### ProductVariantCreated

### ProductVariantUpdated

### ProductVariantDeactivated

### ProductPresentationCreated

### ProductPresentationUpdated

### ProductPresentationDeactivated

### ProductIdentifierAssigned

### ProductIdentifierDeactivated

### ProductPresentationConversionDefined

### PriceScheduled

### PriceActivated

### PriceChanged

### PriceExpired

## Inventario

### InventoryReceived

### InventoryAdjusted

### InventoryReserved

### InventoryReservationReleased

### InventoryDeducted

### InventoryTransferred

### InventoryReturned

### InventoryLossRecorded

### LotCreated

### LotExpired

### StockBelowMinimum

## Compras

### PurchaseCreated

### PurchaseReceived

### PurchasePartiallyReceived

### PurchaseCancelled

### SupplierReturnCreated

## Caja

### CashShiftOpened

### CashMovementRecorded

### CashWithdrawalRecorded

### CashShiftClosingRequested

### CashShiftClosed

### CashDifferenceDetected

### CashDrawerOpenedManually

## Ventas

### SaleStarted

### SaleSuspended

### SaleResumed

### SaleCompleted

### SaleCancelled

### SaleRefunded

### SaleItemReturned

### ReceiptRequested

### ReceiptPrinted

### ReceiptPrintFailed

### ReceiptReprinted

## Pagos

### PaymentInitiated

### PaymentReported

### PaymentConfirmed

### PaymentRejected

### PaymentRefunded

### PaymentReconciliationRequired

## Domicilios

### OrderCreated

### OrderAccepted

### OrderPreparationStarted

### OrderReady

### CourierAssigned

### OrderPickedUp

### DeliveryTrackingStarted

### CourierArrived

### DeliveryPaymentPending

### DeliveryPaymentConfirmed

### DeliveryOtpValidated

### OrderDelivered

### DeliveryFailed

### DeliveryCancelled

### CourierShiftOpened

### CourierShiftClosed

### CourierSettlementCompleted

## Sincronización

### SyncOperationQueued

### SyncOperationSent

### SyncOperationApplied

### SyncOperationRejected

### SyncConflictDetected

### SyncConflictResolved

### DeviceOfflineDetected

### DeviceReconnected

## Soporte y observabilidad

### SupportTicketCreated

### SupportAccessGranted

### SupportAccessRevoked

### HardwareFailureDetected

### BackupCompleted

### BackupFailed

### RestoreCompleted

### ApplicationUpdateAvailable

### ApplicationUpdateInstalled

### ApplicationUpdateFailed

## Reglas

1. Los eventos no sustituyen las transacciones del dominio.
2. Los eventos críticos deben persistirse mediante outbox.
3. Los consumidores deben ser idempotentes.
4. La publicación fallida no debe perder el evento.
5. Reporting y notificaciones reaccionan a eventos, pero no gobiernan la transacción original.
6. Un evento publicado no debe modificarse.
7. Los cambios de esquema requieren versionar el payload.
