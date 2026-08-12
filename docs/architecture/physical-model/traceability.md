# TECH-002A: matriz de trazabilidad del modelo físico

## Estado

Inventario normativo inicial de `TECH-002`.

Este documento no autoriza todavía la creación de migraciones. Su propósito es demostrar qué caso de uso, decisión o invariante exige cada agregado que podrá entrar al modelo físico objetivo.

## Regla de admisión

Una tabla solo puede incorporarse cuando cumple simultáneamente:

1. tiene un módulo propietario definido;
2. materializa un caso de uso, decisión o invariante vigente;
3. tiene identidad, alcance tenant y ciclo de vida inequívocos;
4. sus relaciones no permiten escritura directa entre módulos;
5. sus restricciones pueden expresarse o verificarse en PostgreSQL y SQLite según corresponda;
6. tiene una frontera transaccional y una política de auditoría conocidas;
7. no materializa una capacidad diferida como si estuviera implementada.

Una mención conceptual sin contrato suficiente se registra como brecha y no se convierte silenciosamente en una tabla.

## Clasificación

| Estado | Significado |
|---|---|
| `COVERED` | El contrato funcional y conceptual permite iniciar diseño físico detallado. |
| `CLOSE_IN_TECH_002` | Existe respaldo funcional, pero falta cerrar una decisión física o alinear el agregado conceptual antes de definir la tabla. |
| `DEFERRED` | No pertenece a la primera migración porque falta caso de uso dedicado o está fuera del núcleo inicial. |

## Fundación, identidad y autorización

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-ONB-001` | Tenants, Companies, Branches, Identity, Authorization | `Tenant`, `Company`, `Branch`, `User`, `TenantMembership`, `UserRoleAssignment`, configuración inicial, estado de onboarding | `COVERED` | `OnboardingOperation` conserva identidad, estado y resultado idempotente; `foundation-schema.md` define el bootstrap atómico. |
| `UC-AUTH-001` | Identity, Authorization, Devices, Licensing | `User`, credencial, factor MFA, `Session`, refresh token, `SecurityEvent`, contexto de dispositivo/licencia | `COVERED` | Credencial, MFA y refresh token tienen entidades y ciclos separados; el snapshot offline no replica secretos. |
| `SEC-001`/`SEC-002` | Authorization | `Role`, `Permission`, relación rol-permiso, `UserRoleAssignment`, políticas ABAC versionadas | `COVERED` | Grants y versiones ABAC son explícitos, con vigencia e integridad relacional, sin reglas autoritativas en JSON opaco. |
| `SEC-004` | Identity, Devices, Licensing, Support | referencias a secretos, claves de dispositivo, claves de firma y accesos JIT | `COVERED` | Solo se almacenan referencias, material público y metadatos autorizados; nunca secretos planos. |

## Dispositivos y licencias

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-DEV-001` | Devices | `Device`, evidencia de hardware, estado operativo, perfil de gestión | `COVERED` | Historial y estado efectivo no deben mezclarse ni borrarse por revocación. |
| `UC-DEV-002` | Devices, Licensing | `DeviceKey`, instalación, solicitud/respuesta de activación, relación verificable con licencia | `COVERED` | `Installation` tiene identidad propia y `device-licensing-schema.md` fija FKs y autoridad local/central sin duplicarla dentro de Device. |
| `UC-LIC-001` | Licensing | `License`, `FeatureEntitlement`, `LicenseActivation`, `LicenseRevocation`, `GraceAuthorization`, claves confiables | `COVERED` | Estado contractual, vigencia, gracia, revocación y decisión efectiva permanecen separados. |
| `UC-LIC-002` | Licensing | ciclo de vida de licencia y evidencias de transición | `COVERED` | Los artefactos firmados y su historial no se sobrescriben; el secreto de firma queda fuera de tablas de negocio. |

## Catálogo, unidades y códigos

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-CAT-001`/`UC-CAT-002` | Catalog | `Product`, `Brand`, `Category` | `COVERED` | Brand y Category tienen identidad, company scope y ciclo de vida; no se inventa jerarquía sin caso de uso. |
| `UC-CAT-003` | Catalog | `ProductIdentifier` | `COVERED` | Todo código operativo resuelve a `ProductPresentation`; unicidad activa por empresa, tipo y valor normalizado. |
| `UC-CAT-004` | Catalog | `ProductVariant` | `COVERED` | Los atributos canónicos no pueden ocultar identidad de presentación, unidad o inventario. |
| `UC-CAT-005` | Catalog | `ProductPresentation`, `UnitOfMeasure` | `COVERED` | `catalog-schema.md` fija catálogo global de unidades, dimensión, precisión y Presentation sin duplicar el factor de UnitConversion. |
| `UC-CAT-006` | Catalog | `UnitConversion` | `COVERED` | Conversión versionada, decimal exacta y positiva; origen/destino del mismo producto y variante aplicable. |

## Pricing, promociones, impuestos y redondeo

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-PRICE-001` | Pricing | `PriceList`, `ProductPrice`, versiones/vigencias, eventos y auditoría | `COVERED` | R1 determina que `PriceChange` no es agregado ni tabla: versiones inmutables, eventos, AuditEvent y snapshot de Sale conservan historia. Un workflow futuro requiere `PriceChangeRequest` y caso de uso propios. |
| `UC-PRICE-002`/`DEC-003` | Pricing | snapshot de resolución y referencias de política en `SaleItem`/`Sale` | `COVERED` | La resolución final siempre apunta a presentación y congela entradas, versión y resultado. |
| `UC-PROMO-001`/`UC-PROMO-002` | Pricing | `Promotion`, `PromotionVersion`, `PromotionConsumption` | `COVERED` | Versiones publicadas inmutables; consumo idempotente y asociado a venta. |
| `UC-TAX-001`/`UC-TAX-002` | Tax | `TaxRule`, `TaxRuleVersion`, snapshots tributarios de operación | `COVERED` | Tax es autoridad de regla, clasificación, tasa, vigencia, cálculo y resultado; Pricing consume el resultado y Electronic Invoicing el snapshot, sin poseerlos ni recalcularlos. |
| `UC-ROUND-001`/`DEC-006` | Pricing | `RoundingPolicy`, snapshot y ajuste comercial de venta | `COVERED` | Una sola aplicación por documento produce `payable_amount`; nunca depende del medio de pago. |

## Inventario y recepción

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-INVENTORY-001` | Inventory, Suppliers, Purchasing | `Supplier`, `GoodsReceipt`, `GoodsReceiptLine`, `GoodsReceiptLotAllocation`, `Lot`, `InventoryMovement`, `StockBalance`, `InventoryCostRecord` | `COVERED` | Recepción independiente, una ubicación por recepción, múltiples asignaciones por línea, un movimiento por asignación, costo de recepción congelado y transacción local atómica. |
| `UC-INVENTORY-002` | Inventory | `InventoryLocation`, `InventoryMovement`, `StockBalance`, `Lot`, `InventoryReservation`, `InventoryTransfer`, `InventoryTransferLine` | `COVERED` | Presentación y lote opcional son la identidad operacional; movimiento append-only es fuente y saldo es proyección. |

## Caja

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-CASH-001` | Cash Register | `CashRegister`, `CashShift`, movimiento de apertura | `COVERED` | Un turno abierto compatible por tenant/sucursal/caja/terminal y actor autorizado. |
| `UC-CASH-002` | Cash Register | `CashShift`, `CashCount`, denominaciones y revisión de diferencia | `COVERED` | El cierre referencia un único CashCount `CLOSING`; corte, esperado, contado, diferencia, política y autorización comparten transacción con el cierre. |
| `UC-CASH-003` | Cash Register | `CashMovement`, `CashCount`, `CashCountDenomination`, `CashDifferenceReview`, acciones y compensaciones | `COVERED` | CashCount es agregado propio append-only; ExpectedCash deriva de movimientos `POSTED`; correcciones forman cadena lineal y no crean ajustes automáticos. |

## Ventas y pagos

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-SALES-001`/`UC-SALES-002` | Sales | `Sale`, `SaleItem`, suspensión, cancelación, devolución comercial y snapshots | `COVERED` | `SaleReturn` y líneas están alineados en modelo conceptual y `sale-return-schema.md`; estados persistentes, proyecciones, efectos separados y elegibilidad acumulada no reescriben Sale. |
| `UC-PAY-001` | Payments | `PaymentGroup`, `Payment`, `PaymentAllocation`, `PaymentAttempt` | `COVERED` | Cada medio es un `Payment`; no existe tabla `PaymentComponent`. |
| `UC-PAY-002` | Payments | múltiples `Payment` dentro del mismo `PaymentGroup` | `COVERED` | Fallo parcial no mezcla estados ni duplica cobertura. |
| `UC-PAY-003` | Payments | intento y evidencia de transferencia manual/QR | `COVERED` | Confirmación manual exige actor, referencia, idempotencia y auditoría. |
| `UC-PAY-004` | Payments, Sales, Cash Register | `Refund`, ítems, Reversal y efectos compensatorios | `COVERED` | Reversal y su relación con Payment/Attempt, provider authority, idempotencia, evidencia y separación de Refund/SaleReturn están alineados en `payment-financial-operations-schema.md`. |
| `UC-PAY-005` | Payments | Settlement, Reconciliation, items, incidencias y evidencia externa | `COVERED` | Modelo conceptual y contrato físico alinean estados de `PAY-007`, snapshot de alcance, componentes financieros, cálculo versionado, permisos, replay y cierre/reapertura. |
| `UC-PAY-006` | Payments | `PaymentAttempt` pendiente/desconocido, reintento y revisión | `COVERED` | Timeout no equivale a fallo; referencia externa y operación conservan identidad durante reconciliación. |

## Sincronización y configuración offline

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-SYNC-001` | módulos propietarios + Sync | `SyncOperation`, `OutboxEntry`, `InboxEntry`, `SyncCheckpoint` | `COVERED` | Negocio y outbox comparten transacción; inbox y efectos centrales comparten commit o rollback. |
| `UC-SYNC-002` | módulos propietarios | versiones nativas de configuración, checksums y vigencias | `COVERED` | `domain-configuration-schema.md` fija ownership, identidad/versiones, scopes, lifecycle, checksum, snapshots, offline, permisos, eventos y migración sin `Configuration` global; Sync solo distribuye. |
| `UC-SYNC-003` | Sync | `SyncConflict`, `SyncReview`, `SyncDeadLetter`, `SyncDeadLetterAction`, `DeviceClockState`, `DeviceSyncState` | `COVERED` | `sync-dead-letter-schema.md` define registro separado referencial, una identidad por operation, lifecycle sin estados paralelos, clasificación, retry, revisión, archivo, seguridad, concurrencia y retención sin copiar operación o payload. |

## Facturación electrónica

| Fuente | Módulo propietario | Agregados exigidos | Cobertura | Observación física obligatoria |
|---|---|---|---|---|
| `UC-EINV-001` | Electronic Invoicing | `FiscalConnection`, `ElectronicDocument`, `FiscalSubmissionAttempt`, `FiscalArtifact`, `FiscalIncident`, `FiscalReconciliation` y correctivos | `COVERED` | `electronic-invoicing-schema.md` cierra agregados neutrales, snapshots separados, estados, incertidumbre, idempotencia, evidencia, tenancy, seguridad, local-first, migración y pruebas sin permitir que un proveedor defina columnas del dominio. |

## Capacidades excluidas de la primera migración

| Área conceptual | Estado | Motivo |
|---|---|---|
| Clientes y crédito | `DEFERRED` | `CUST-001` y `CUST-002` permanecen `PLANNED`; `DEC-005` está diferida. |
| Pedidos, domicilios y domiciliarios | `DEFERRED` | El primer núcleo los declara fuera de alcance y no existen casos de uso cerrados. |
| Reporting analítico y Superset | `DEFERRED` | Reporting no es fuente de verdad; primero deben existir proyecciones operativas verificables. |
| Notifications | `DEFERRED` | No existe caso de uso dedicado ni contrato de entrega. |
| Support operativo | `DEFERRED` | `SEC-004` define acceso y diagnóstico, pero no un ciclo funcional completo de tickets. |
| Hardware certificado | `DEFERRED` | `DEV-003` está `PLANNED` y todos los modelos permanecen `UNTESTED`; los contratos no justifican tablas por modelo físico. |
| PurchaseOrder, SupplierDocument, AccountsPayable y SupplierPayment | `DEFERRED` | `PUR-001`/`PUR-002` permanecen planificados; no son requisito de GoodsReceipt ni se materializan en la primera migración. SupplierPayment no reutiliza Payment de cobros. |

Estas exclusiones no eliminan conceptos ni impiden evolución. Evitan crear tablas especulativas sin semántica suficiente.

## Brechas que TECH-002 debe cerrar antes del esquema

| ID | Estado | Brecha | Fuente que obliga a resolverla | Condición de cierre / evidencia |
|---|---|---|---|---|
| PHY-G01 | `CLOSED` | Persistencia de onboarding e idempotencia | `UC-ONB-001` | `OnboardingOperation` alinea identidad, estados, resultado y frontera idempotente en el modelo conceptual. |
| PHY-G02 | `CLOSED` | Credenciales, MFA y refresh token rotatorio | `UC-AUTH-001`, seguridad | `UserCredential`, `MfaFactor` y `SessionRefreshToken` separan hashes, custodia, rotación, revocación, reutilización y retención sin guardar secretos utilizables. |
| PHY-G03 | `CLOSED` | Relación rol-permiso y políticas ABAC | `SEC-002` | `RolePermissionGrant` y `AuthorizationPolicyVersion` fijan versión y vigencia; las reglas permanecen explícitas en backend, no en JSON opaco autoritativo. |
| PHY-G04 | `CLOSED` | Identidad de instalación de dispositivo | `UC-DEV-002` | `Installation` queda separada de `Device`, `DeviceKey`, `LicenseActivation` y `License`, incluida reinstalación sin reutilización. |
| PHY-G05 | `CLOSED` | Brand, Category y UnitOfMeasure | `UC-CAT-001`, `UC-CAT-005`, `DEC-004` | Modelo conceptual y `catalog-schema.md` fijan atributos, scopes, precisión, ciclo y autoridad única de conversiones. |
| PHY-G06 | `CLOSED` | Recepción física independiente y proveedor | `UC-INVENTORY-001`, `UC-INVENTORY-002`, `DEC-007` | Auditoría transversal aprobada: GoodsReceipt inmutable, líneas, asignaciones de lote, un movimiento por asignación, costo separado, una ubicación, compensaciones, permisos, migración y atomicidad alineados. |
| PHY-G07 | `CLOSED` | Arqueos de caja | `UC-CASH-002`, `UC-CASH-003`, `DEC-002`, `DEC-007` | Auditoría transversal aprobada: `cash-counting-schema.md`, modelo conceptual, eventos, permisos, ownership, reglas, glosario, casos de uso y migración alinean turno, movimientos, CashCount, denominaciones, diferencias, correcciones, concurrencia y operación offline. |
| PHY-G08 | `CLOSED` | SaleReturn | `UC-SALES-002`, `UC-PAY-004`, `DEC-002`, `DEC-007`, ownership | `sale-return-schema.md` y auditoría transversal alinean agregado, líneas, estados persistentes, proyecciones, tenant, snapshots, dinero, permisos, eventos, inventario, pagos, caja, fiscal, local-first, auditoría y migración. |
| PHY-G09 | `CLOSED` | Reversal, Settlement y Reconciliation | `UC-PAY-004`, `UC-PAY-005`, `PAY-007`, `DEC-007`, `DEC-008` | `payment-financial-operations-schema.md` y auditoría transversal alinean estados, ownership, eventos, componentes exactos de Settlement, cálculo versionado, alcance de Reconciliation, permisos, provider authority, replay, idempotencia, fraude, local-first, auditoría y migración. |
| PHY-G10 | `CLOSED` | Versiones de configuración por dominio | `UC-SYNC-002`, `DEC-007`, `DEC-008`, ownership | `domain-configuration-schema.md` y auditoría transversal alinean ownership por dominio, Tax independiente, CashPolicy, InventoryPolicy, precedencia explícita, lifecycle, scopes, vigencia, checksum, snapshots, secretos, permisos, eventos, local-first y legado, sin `Configuration` global. |
| PHY-G11 | `CLOSED` | Dead letter | `UC-SYNC-003`, `UC-SYNC-001`, `DEC-007`, `DEC-008`, `SEC-G01/03/04/05/06/08/10` | `sync-dead-letter-schema.md` y auditoría transversal fijan `SyncDeadLetter` separado, ownership Sync, relación con Operation/Outbox/Inbox, clasificación, retry versionado, revisión, reactivación, archivo, idempotencia, causalidad, tenancy, seguridad, permisos, auditoría, eventos, concurrencia, legado y pruebas futuras. |
| PHY-G12 | `CLOSED` | Agregados fiscales neutrales | `UC-EINV-001` | `electronic-invoicing-schema.md` y la auditoría transversal fijan `ElectronicDocument` como nombre canónico, ownership Tax/Electronic Invoicing, conexión, attempts, artefactos, incidencias, conciliación, estados separados, correctivos, incertidumbre, idempotencia, numeración, local-first, tenant, secretos, permisos, eventos, auditoría, concurrencia, legado y pruebas futuras. |
| PHY-G13 | `CLOSED` | Representación monetaria SQLite | `DEC-003`, `ADR-005` | `physical-conventions.md` fija texto decimal canónico de escala conocida y conversión mediante coeficiente entero; prohíbe `REAL` y `number` autoritativos. |
| PHY-G14 | `CLOSED` | RLS y roles de conexión | seguridad, tenancy | El PoC reproducible en `poc/rls/` pasó sobre PostgreSQL 16.14: RLS/FORCE, owner y runtimes sin bypass, fail-closed, `WITH CHECK`, FK tenant-aware, reuse/rollback/worker, admin explícito, introspección y dump/restore. Es evidencia parcial de `SEC-G01`, no autorización de migración. |

## Resultado del inventario

`PHY-G01` a `PHY-G14` están cerrados en el alcance documental registrado por cada gate. Ese cierre no convierte automáticamente los bloques físicos Foundation, Device/Licensing o Catalog en aprobados para migración: sus condiciones internas pendientes siguen explícitas.

R1 de `TECH-002` cierra la alineación documental de Foundation status, AuditEvent, Outbox, DeviceKey, límites, escalas monetarias y reclasificación de PriceChange. Foundation y Device/Licensing permanecen `IN_REVIEW`; R2/R3/R4, implementación de repositories y security gates continúan pendientes. La primera migración permanece `NO-GO`, `TECH-002` continúa `IN_PROGRESS` y `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.
