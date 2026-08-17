# Propiedad de datos por módulo

| Módulo | Datos propietarios |
|---|---|
| Identity | Identidad global User, perfil, credenciales, sesiones, factores y recuperación |
| Tenants | Clientes contractuales, aislamiento y TenantMembership |
| Companies | Identidad legal, comercial y branding |
| Branches | Sucursales, horarios, cobertura y ubicación |
| Authorization | Roles, permisos, políticas y UserRoleAssignment |
| Devices | Equipos, instalaciones, solicitudes/respuestas de activación de dispositivo, claves, confianza, perfiles de administración y políticas nativas de dispositivo |
| Licensing | Licencias, LicenseActivation, entitlements, límites, gracia, revocaciones y artefactos contractuales firmados |
| Catalog | Productos, categorías, variantes y códigos |
| Pricing | Listas, precios, promociones, descuentos, redondeo comercial, políticas de resolución, versiones, vigencias e historial |
| Tax | TaxRule, TaxRuleVersion, clasificación, tasas, reglas, vigencia, cálculo y resultado tributario |
| Inventory | Stock, lotes, movimientos, reservas, InventoryPolicy y sus versiones |
| Purchasing | GoodsReceipt, líneas y asignaciones de lote; futuras PurchaseOrder, SupplierDocument y devoluciones cuando sus casos de uso se habiliten |
| Suppliers | Proveedores |
| Sales | Ventas, detalles, devoluciones comerciales SaleReturn y anulaciones SaleCancellation |
| Payments | Métodos, grupos, pagos, intentos, asignaciones, refunds, reversals, settlement, conciliación, chargebacks y configuración versionada de proveedor |
| Cash Register | CashRegister, CashShift, CashMovement, CashCount, denominaciones, revisiones de diferencia, cierres, CashPolicy y sus versiones |
| Customers | Clientes comerciales y crédito |
| Orders | Pedidos y estados |
| Delivery | Despacho, seguimiento y entrega |
| Couriers | Domiciliarios, turnos y recaudos |
| Reporting | Vistas de lectura y agregados |
| Notifications | Correos, SMS, push y alertas |
| Hardware | Perfiles, adaptadores y periféricos |
| External Integrations | `ProviderRegistry`, `ExternalIntegration`, credenciales referenciadas, capabilities, ownership por recurso, discovery, `ExternalReferenceMapping`, dispatch externo, rate limiting, webhook receipts y evidencia de verificación |
| Electronic Invoicing | `FiscalConnection` como perfil fiscal asociado a `ExternalIntegration`, configuración de emisión fiscal, rangos conocidos, `ElectronicDocument`, `FiscalSubmissionAttempt`, estados originales de proveedor, `FiscalArtifact`, `FiscalIncident`, `FiscalReconciliation`, contingencia, evidencia y documentos correctivos |
| Sync | SyncOperation, OutboxEntry, InboxEntry, checkpoints, conflictos, revisiones, estado de dispositivo para sincronización y SyncDeadLetter |
| Audit | Eventos sensibles e historial |
| Support | Tickets, diagnóstico y accesos temporales |

## Reglas

1. Un módulo no modifica directamente las tablas internas de otro.
2. Las operaciones cruzadas utilizan casos de uso, contratos o eventos.
3. Reporting no es fuente de verdad.
4. Audit no debe depender de la eliminación o modificación de eventos históricos.
5. Payments no permite que Delivery confirme por sí mismo un pago.
6. Inventory es la única autoridad para existencias y reservas.
7. Licensing es la única autoridad para módulos habilitados.
8. Identity autentica; Tenants demuestra pertenencia; Authorization decide permisos y alcance.
9. Sales no modifica estados de Payment y Payments no reescribe Sale.
10. Electronic Invoicing consume snapshots comerciales y fiscales; no recalcula ni sobrescribe Sale, Pricing, Tax, Payments, Cash Register o Inventory.
11. Una nota o ajuste electrónico es un documento nuevo relacionado, no una mutación destructiva del documento aceptado.
12. Credenciales y certificados se referencian desde el almacén definido por SEC-004; no son propiedad de tablas de negocio.
13. Purchasing confirma la recepción física, pero Inventory es la única autoridad que crea movimientos y deriva saldos; una recepción nunca modifica StockBalance por fuera del contrato de Inventory.
14. Payment cubre cobros de ventas, pedidos y cuentas por cobrar. Pagos a proveedores pertenecen a una capacidad financiera futura y no reutilizan ese agregado.
15. No existe un propietario global `Configuration`: cada módulo posee su identidad y versiones; Sync o `ConfigurationDistribution` solo transportan referencias y snapshots verificables.
16. Pricing consume el resultado de Tax dentro del pipeline, pero no posee ni recalcula reglas tributarias. Electronic Invoicing consume el snapshot tributario de la operación y mantiene separado su snapshot de emisión fiscal.
17. `ElectronicDocument` es el único agregado canónico del documento de Electronic Invoicing; `FiscalDocument` no constituye una entidad paralela.
18. `FiscalReconciliation` pertenece a Electronic Invoicing y no comparte entidad ni enum física con `Payments.Reconciliation`, aunque algunos nombres de estados coincidan.
19. Los secretos reales permanecen en el almacén aprobado; las configuraciones de negocio solo conservan referencias opacas.
20. Sync posee coordinación, entrega, deduplicación, conflicto y dead letter, pero no duplica ni adquiere ownership de la intención o efecto del dominio originador.
21. Una FK desde Sync hacia Tenant, Company, Branch, Session, Device, Installation, License o Activation conserva integridad referencial y scope; no transfiere ownership. Las referencias aggregate/actor tipadas sin FK fuerte siguen sujetas a validación tenant-aware del caso de uso.
22. External Integrations posee conexión, cuenta externa, credencial referenciada, capability, mapping y transporte central hacia el proveedor; no posee Sale, Payment, Product, Customer, Tax, Inventory ni el resultado legal de `ElectronicDocument`.
23. `FiscalConnection` referencia exactamente una `ExternalIntegration` con capability fiscal activa. No duplica credenciales generales, account identity, environment, health ni capabilities generales.
24. `SyncOperation` coordina local↔central; `IntegrationDispatch` coordina central↔provider. Ninguno adquiere ownership del hecho de dominio ni convierte un ACK contable en verdad de Sale o Payment.
25. Electronic Invoicing conserva ownership exclusivo de cada attempt fiscal en `FiscalSubmissionAttempt`. `IntegrationDispatch` fiscal conserva intención/orquestación y lo referencia causalmente; `IntegrationDispatchAttempt` solo pertenece a operaciones no fiscales y una FK discriminada impide doble historial.
26. `SyncOperation.authority_policy` gobierna autoridad local↔central conforme a `DEC-007`; `ResourceOwnershipPolicy` gobierna autoridad central↔provider. Son decisiones simultáneas e independientes: ninguna reemplaza ni se deriva automáticamente de la otra.
