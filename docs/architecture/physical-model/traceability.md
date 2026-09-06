# TECH-002A: matriz de trazabilidad del modelo físico

## Estado

Inventario normativo de `TECH-002`. R1, R2-A y R2-B están cerrados documentalmente; R3 está ejecutado con `PASS`, R4 tiene `PASS` documental, R5 cerró documentalmente los seis blockers de la primera revisión transversal y la revisión transversal final #2 obtuvo `PASS`.

Este inventario por sí solo no autoriza migraciones. Su propósito es demostrar qué caso de uso, decisión o invariante exige cada agregado que podrá entrar al modelo físico objetivo; la autorización limitada de 001 queda registrada en la sección de revisión transversal final #2.

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
| `UC-SYNC-001` | módulos propietarios + Sync | `SyncOperation`, `OutboxEntry`, `InboxEntry`, `SyncCheckpoint` | `COVERED` | `sync-base-schema.md` cierra identidad, columnas, cardinalidades, candidate keys/FKs tenant-aware, deduplicación, checkpoint por stream/dirección, split PostgreSQL/SQLite y fronteras atómicas. |
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

## R2-B — contratos comerciales y extensibilidad

R2-B cierra las relaciones físicas base mediante:

- `sales-schema.md`: Sale, SaleItem, snapshots, medición validada, relaciones y atomicidad local;
- `payments-schema.md`: PaymentGroup, Payment, Allocation, Attempt y Refund, junto al contrato financiero ya cerrado;
- `pricing-schema.md`: PriceList, ProductPrice y versiones/policies sin `PriceChange`;
- `tax-schema.md`: TaxClassification, TaxRule/Version y TaxSnapshot separado de Electronic Invoicing;
- `inventory-schema.md`: ledger, saldo, reservas, lotes, vencimientos, ajustes y merma, junto a recepción ya cerrada.

### Autoridad y sincronización comercial

| Operación/dato | Origen local permitido | Autoridad de aceptación | Transporte |
|---|---|---|---|
| Sale ordinaria y efectos locales autorizados | sí, con licencia/device/permiso/policy | local hasta aceptación central | una SyncOperation + Outbox; Inbox solo central |
| InventoryMovement, reserva, ajuste o merma permitidos | sí, bajo policy explícita | local hasta validación/reconciliación central | hecho append-only; saldo es proyección, no payload duplicado |
| efectivo y reporte manual de transferencia/QR | sí | efectivo local; confirmación manual según actor/policy | intento, evidencia sanitizada y outbox |
| pago remoto/QR dinámico y estado de proveedor | intención sí; éxito no | proveedor externo mediante adapter verificado | webhook/polling idempotente; resultado incierto se conserva |
| ProductPrice, PricingPolicy y TaxRule publicados | no | central | snapshot/version completa central→local y checkpoint |
| aceptación fiscal, license override y administración global | no | autoridad externa/central correspondiente | resultado explícito; offline nunca finge éxito |

No toda entidad es bidireccional. SQLite no contiene Inbox; Outbox referencia SyncOperation 1:1 y no duplica payload. Cada módulo conserva ownership de su intención y Sync solo coordina entrega, deduplicación, conflicto, checkpoint y dead letter.

### Capability model

La cadena vigente es `License → FeatureEntitlement(feature_code, enabled, limits/policy_version) → decisión efectiva de capability → autorización/policy del dominio`. Capability no sustituye Permission, licencia, configuración de dominio ni compatibilidad de hardware. El cliente local puede restringir por evidencia ausente, pero nunca ampliar un entitlement firmado.

No existe todavía un catálogo normativo publicado para los códigos propuestos: ninguno de los dieciséis nombres recibidos puede confirmarse hoy como `feature_code` normativo existente. Sí existen el agregado físico `FeatureEntitlement` y varios contratos funcionales subyacentes, pero eso no crea automáticamente una capability comercial. R2-B no crea, renombra, siembra ni declara comercializable ningún código. Su clasificación de revisión es:

| Candidato solicitado | Frontera principal | Estado R2-B |
|---|---|---|
| `inventory_batches`, `expiration_control`, `weighted_products`, `serial_tracking`, `waste_management`, `reservations` | capability de dominio, además de policy/configuración y soporte del modelo | candidato; lotes, expiración, peso, merma y reservas encajan; seriales siguen diferidos |
| `barcode_sales`, `scale_integration` | capability de hardware/integración + support matrix/device trust | candidato; no demuestra adapter ni hardware soportado |
| `product_variants`, `purchase_orders`, `suppliers`, `electronic_invoicing`, `customer_credit` | feature comercial/módulo | candidato; variantes y Supplier tienen contrato, Electronic Invoicing tiene contrato neutral; PurchaseOrder y crédito siguen diferidos |
| `multi_branch`, `advanced_reporting`, `offline_sales` | feature comercial/plataforma con límites/policies | candidato; multi-branch y offline encajan; reporting avanzado sigue diferido |

Antes de persistir cualquiera como `feature_code`, una decisión posterior debe aprobar código canónico, significado, unidad/límite, dependencias, defaults, degradación, modalidad/licencia, policy version, pruebas y compatibilidad. Ausencia de catálogo falla cerrada; no se usa texto libre, JSON o nombre del tipo de negocio como autorización.

### Multi-negocio sin forks ni entidades gigantes

| Tipo de comercio | Composición del core y capacidades optativas, sin columnas específicas |
|---|---|
| tienda/minimercado | catálogo, códigos, presentaciones, inventario, venta, caja y pagos comunes |
| comercio por peso con perecederos | unidades de masa, medición validada por puerto, lotes/vencimiento y merma por policy |
| droguería | lotes/vencimiento y controles futuros más estrictos como módulo/policy; no se asume regulación no documentada |
| ferretería/almacén | variantes, presentaciones, longitud/área/volumen y seriales solo cuando exista contrato aprobado |
| floristería | lotes opcionales, perecibilidad y merma; color/tallos no son columnas universales |
| otros | composición de módulos, entitlements, policies, value objects y extensiones tipadas aprobadas |

Product, Sale, SaleItem, StockBalance, Customer y Payment no reciben campos de una vertical. JSON queda limitado por `physical-conventions.md`: no sustituye FK, estado, scope, dinero, relación o regla autoritativa.

### Hardware y providers

Barcode scanner, scale, printer, cash drawer, payment terminal y customer display permanecen detrás de puertos/adapters. El dominio recibe identificador, medición o resultado validado; no SDK, marca o modelo. Payments usa método, configuración versionada, provider code/references y evidencia sanitizada; ninguna tabla o estado depende de Bold, Wompi, Mercado Pago u otro proveedor. La matriz de soporte futura determina compatibilidad real.

### Seguridad aplicable antes de implementación

| Control de referencia | Gate existente | Contrato habilitante; estado real |
|---|---|---|
| Rate limiting por IP/identidad/tenant/endpoint/riesgo | `SEC-G08` | frontera HTTP/webhook; valores pendientes; no limita operación local interna por dependencia HTTP |
| `.env` solo para configuración local/no sensible | `SEC-G07` | ningún secreto operativo se documenta o persiste allí; inyección pendiente |
| Secrets management | `SEC-G07` | entidades solo guardan referencias opacas; mecanismo pendiente |
| IP/network limiting | `SEC-G08` / `SEC-G09` | allowlist/egress/superficie según contexto; topología pendiente |
| Input sanitization | `SEC-G08` | parsing, schema validation, business validation, normalización, autorización y output encoding separados |
| Server-side validation | `SEC-G08` | no confía en tenant, permisos, total/impuesto, pago o fiscal acceptance del cliente |
| RLS | `SEC-G01` | tenant_id, candidate keys/FKs compuestas y PoC `PHY-G14`; implementación aún no evaluada |
| Encryption | `SEC-G07` | datos/transportes/backups/secretos según riesgo; selección e implementación pendientes |
| Expiración/revocación de sesión | `SEC-G02` | sesión/device/licencia se revalidan conectado/offline según autoridad |
| CORS estricto | `SEC-G08` | solo HTTP/web; allowlist por ambiente y nunca `*` con credenciales; IPC tiene contrato distinto |

Rate limiting no sustituye autorización. CORS no protege IPC ni es control de acceso. Renderer, POS Local Service input, PWA, sync, webhook y hardware adapter son fronteras no confiables. MFA, reauthentication, RBAC, ABAC, device trust, licencias firmadas, idempotencia, replay protection, auditoría append-only, secret/key management, validation, scanning/SBOM, backup/restore, updates firmados y release fail-closed se preservan como controles planificados, no implementados.

### Fronteras transaccionales R2-B

| Dominio | Unidad atómica |
|---|---|
| Sales | Sale + items + snapshots + audit + SyncOperation/Outbox; efectos locales indispensables coordinados por puertos |
| Inventory | movimiento/reserva + proyección afectada + audit + SyncOperation/Outbox |
| Payments | transición + evidencia + allocation/efecto local aplicable + audit + SyncOperation/Outbox |
| Pricing | versión publicada + vigencia/solapamiento + audit + evento/outbox de distribución |
| Tax | versión publicada + vigencia/solapamiento + audit + evento/outbox de distribución |

Ninguna incluye llamada remota a proveedor, fiscalización, impresión o backend como transacción distribuida. `LoggerPort`, `MetricsPort` y `AuditPort` quedan como puntos futuros en Sales, Payments, Sync, fiscalización, Inventory y seguridad sin modificar lógica de dominio.

### Evaluación de R2-B

R2-B: `PASS` documental. Sales, Payments, Pricing, Tax e Inventory tienen contratos base; Sync comercial, tenant isolation, dinero exacto, local-first, seguridad implementable, extensibilidad multi-negocio y fronteras transaccionales están alineados. No apareció contradicción normativa material.

En el corte R2-B, este PASS no cambió `TECH-002` de `IN_PROGRESS`, no aprobó Foundation/Device-Licensing/Catalog para migración, no evaluó `SEC-G01..SEC-G10`, no ejecutó R3/R4 y no autorizó DDL ni la primera migración.

## R3 — validación física PostgreSQL 16 + SQLite/WAL

R3 se ejecutó el 2026-08-14 sobre el subconjunto Foundation + Sales + Payments + Inventory + Pricing/Tax mínimo + Sync/Audit en `poc/physical-model/`. El PoC es aislado, reproducible y desechable: no es DDL de producto, migración Kysely, repository ni elección del mecanismo transaccional definitivo.

- PostgreSQL `16.14`: `97/97` verificaciones, incluidos RLS/FORCE, roles separados, FKs tenant-aware, tipos exactos, atomicidad, idempotencia, append-only, concurrencia real paralela y dump/restore.
- SQLite `3.50.4` con WAL y dos conexiones: `83/83` verificaciones, incluidos decimal canónico `TEXT` + `Decimal`, single-writer, rollback/reinicio, Outbox/Checkpoint y backup/reapertura.
- Matriz de equivalencia: UUID v7, dinero `(19,6)`, tasa/factor `(19,10)`, cantidad, timestamp UTC, booleano, checks/estados, versionado, checksum, FK/UNIQUE y semántica transaccional resultaron `PASS` en sus representaciones por dialecto.
- Evidencia durable: `poc/physical-model/results/evidence.txt` y `poc/physical-model/results/summary.md`; ejecución íntegra: `python poc/physical-model/scripts/run.py`.

R3: `PASS`. No apareció contradicción material con R1/R2-A/R2-B. La normalización previa del typmod `numeric` de PostgreSQL confirma que el adaptador debe validar la forma decimal canónica antes del cast; es una aclaración de enforcement del contrato existente, no una decisión nueva. La evidencia es parcial para `SEC-G01`, `SEC-G05`, `SEC-G06`, `SEC-G08` y `SEC-G09`; ningún security gate cambia de `PLANNED / NOT_EVALUATED`.

## R4 — manifiesto exacto de primera migración

R4: `PASS` documental. `docs/migration/first-target-migration-manifest.md` fija `001_central_foundation` y `001_local_migration_control`, sus objetos, columnas, constraints, índices, orden, roles, RLS/grants, seeds, histories, convivencia legacy, rollback, backup/recovery y verification plan.

El corte PostgreSQL contiene Foundation central, identidad/autorización, onboarding, Audit y SyncOperation/Outbox de origen central. SQLite contiene únicamente control de versión y pragmas: no crea autoridad local antes de Device/License/Activation verificables. DeviceKey, Licensing, artefactos firmados, Inbox/Checkpoint local/central receptor y todos los dominios comerciales quedan fuera.

El PoC criptográfico pendiente no bloquea 001 porque no se persiste ningún objeto dependiente de firma/canonicalización. Sí bloquea el corte posterior de Device/Licensing/offline. Foundation queda `APPROVED_FOR_MIGRATION_DESIGN` solo para el scope 001; Device/Licensing y Catalog permanecen `IN_REVIEW`. No cambian security gates, `TECH-002` ni el `NO-GO` de la primera migración.

## R5 — cierre normativo de blockers B01–B06

R5: `PASS` documental. La revisión transversal posterior a R4 produjo seis blockers y R5 los cerró sin escribir DDL ni ampliar el conjunto de objetos 001:

| Blocker | Estado | Decisión normativa |
|---|---|---|
| B01 | `CLOSED` | PHASE 0 crea/verifica roles y bootstrap permanente `platform`/UUIDv7/ledger antes de admitir `STARTED`; attempt, body y smoke tienen fronteras separadas. |
| B02 | `CLOSED` | `target_migration_executions` es la única history; Kysely solo ejecuta queries y no crea metadata de migraciones. |
| B03 | `CLOSED` | `APPLIED` exige body committed, catálogo exacto y smoke PASS; committed no verificado permanece `STARTED`; FAILED nunca representa schema committed; down fresh conserva evidencia y produce `ROLLED_BACK`. |
| B04 | `CLOSED` | Onboarding referencia `(tenant_id,user_id,id,membership_type)` con discriminador generado `OWNER` y checks de copresencia del resultado estructural. |
| B05 | `CLOSED` | Session sigue global con contexto opcional, pero usa RLS/FORCE: `pos_app` solo tenant actual, Identity service global explícito, worker sin grant y admin read-only. |
| B06 | `CLOSED` | AuditEvent usa `resource_reference_kind=INSTANCE|SYSTEM|BATCH`; la combinación determina de forma verificable si `resource_id` es obligatorio o nulo, sin sentinel. |

R5 solo aporta schema/migration readiness documental. Las policies Session, constraints nuevas, runner, reconciliation y combinaciones AuditEvent deben probarse sobre el DDL real. `SEC-G01`, `SEC-G02` y `SEC-G06`, al igual que los demás gates, permanecen `PLANNED / NOT_EVALUATED`. `TECH-002` continúa `IN_PROGRESS` y la primera migración continúa `NO-GO` hasta una nueva revisión transversal final independiente.

## Revisión transversal final #2

Resultado: `PASS`. La revisión independiente revalidó R1–R5 y confirmó B01–B06 `CLOSED`, autoridad única del ledger, lifecycle y recovery fail-closed, orden ejecutable, FK OWNER compuesta, Session con RLS/FORCE y grants allowlist, semántica única de `AuditEvent.resource_id`, scope exacto PostgreSQL/SQLite, aislamiento tenant-aware, separación del legado y ausencia de dependencias hacia Device/Licensing o dominios comerciales. No se encontró blocker categoría A ni contradicción material.

Registro histórico de cierre: `TECH-002 = DONE` y `FIRST MIGRATION = GO_AUTHORIZED` autorizaron implementar `001_central_foundation` y `001_local_migration_control`. La materialización posterior ocurrió en `255d813`; no vuelve editable el manifiesto ni los bytes de migration 001. No significa Fase 1 terminada, producción autorizada, local-first terminado ni Device/Licensing terminado. `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.

## Resultado del inventario

`PHY-G01` a `PHY-G14` están cerrados en el alcance documental registrado por cada gate. Ese cierre no convierte automáticamente los bloques físicos Foundation, Device/Licensing o Catalog en aprobados para migración: sus condiciones internas pendientes siguen explícitas.

R1 de `TECH-002` cerró la alineación documental de Foundation status, AuditEvent, Outbox, DeviceKey, límites, escalas monetarias y reclasificación de PriceChange. R2-A, R2-B, R3, R4 y R5 se registran a continuación; la revisión transversal final #2 cerró el diseño y autorizó 001. `255d813` materializó posteriormente ese corte con evidencia `54/54` PostgreSQL, `12/12` SQLite y `66/66` combinada. Repositories de aplicación y gates continúan pendientes. Migration 001 es inmutable, `TECH-002` queda `DONE` y `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.

R2-A cierra documentalmente relaciones Foundation↔Devices/Licensing↔Sync: candidate keys/FKs tenant-aware, orden sin ciclos irresolubles, Operation/Outbox/Inbox/Checkpoint, Conflict/Review/DeadLetter, delete policies, split PostgreSQL/SQLite y fronteras transaccionales. R3 validó patrones físicos y R4 difiere sin FK libre la cadena Device/Licensing. Foundation queda aprobada para diseño de 001; Device/Licensing permanece `IN_REVIEW`. La revisión transversal final #2 autoriza únicamente el corte 001.

R2-B cierra documentalmente Sales, Payments, Pricing, Tax e Inventory, su Sync comercial y la extensibilidad por capabilities sin catálogo inventado, forks ni acoplamiento a vertical, hardware o provider. R4 excluye esos dominios de 001 por ausencia de dependencia física directa; Catalog y Device/Licensing conservan sus condiciones `IN_REVIEW`. `TECH-002` queda `DONE`, `SEC-G01` a `SEC-G10` siguen `PLANNED / NOT_EVALUATED` y la autorización de primera migración no incluye esos dominios.

## Delta posterior: contrato general de External Integrations

La reconciliación posterior a `255d813` cierra documentalmente `external-integrations-schema.md` sin modificar TECH-002 ni migration 001. Define `ProviderRegistry`, `ProviderAdapterVersion`, declaraciones de capability/configuración de plataforma, `ExternalIntegration`, `IntegrationCredentialBinding`, `IntegrationCapability`, `ResourceOwnershipPolicy`, discovery, `ExternalReferenceMapping`, `IntegrationDispatch`, `ExternalWebhookReceipt`, `ProviderRateLimitPolicy` y `ProviderVerificationEvidence`.

`FiscalConnection` queda reconciliado como perfil fiscal que referencia `ExternalIntegration`; `ElectronicDocument` permanece canónico. `SyncOperation` conserva local↔central y `IntegrationDispatch` cubre central↔provider. `FiscalSubmissionAttempt` es el único owner de attempts fiscales y referencia su dispatch `FISCAL`; `IntegrationDispatchAttempt` queda restringido mediante FK discriminada a dispatches `NON_FISCAL`. `SyncOperation.authority_policy` y `ResourceOwnershipPolicy` conservan catálogos independientes para sus dos fronteras. Los contratos Siigo/Factus/Alegra y HKA/Odoo futuro se registran en `../provider-integration-matrix.md`; ninguno está implementado o verificado.

Resultado del delta: `PASS` documental del contrato general. La decisión posterior de gobernanza divide su materialización, sin cambiar ownership ni nombres canónicos:

```text
001 CENTRAL FOUNDATION (materializada e inmutable)
  -> 002 EXTERNAL INTEGRATIONS FOUNDATION (`NON_FISCAL` únicamente)
  -> 003 FISCAL / ELECTRONIC INVOICING FOUNDATION (habilita `FISCAL` con su owner)
  -> runtime provider adapters
  -> real provider verification
```

Migration 002 no crea tablas fiscales y prohíbe físicamente dispatches `FISCAL`. Migration 003 materializará posteriormente el bounded context fiscal y habilitará `FISCAL` solo en la misma frontera transaccional que crea `FiscalSubmissionAttempt` y la FK discriminada. Ambas migrations pertenecen a Phase 1; ninguna implementa adapters ni verifica providers. Migration 001 permanece inmutable y `SEC-G01` a `SEC-G10` no cambian de `PLANNED / NOT_EVALUATED`.

INT-002 materializa esa decisión únicamente como diseño en [`second-target-migration-manifest.md`](../../migration/second-target-migration-manifest.md): 16 tablas `CENTRAL_ONLY` bajo `integrations`, cero SQLite, cero seed y cero SQL; `integration_dispatches_dispatch_class_002_ck` permite solo `NON_FISCAL` y `IntegrationDispatchAttempt` conserva FK discriminada hacia ese mismo valor. El manifest consume Company/Branch, roles, RLS, UUID v7, Audit y ledger de 001 sin alterar ningún objeto 001. Su cierre documental no autoriza aún implementar migration 002; requiere revisión/autorización de materialización separada.

La primera revisión independiente produjo `MANIFEST-002-REVIEW = PASS_WITH_REMEDIATION` y cerró M-01..M-07. La segunda revisión independiente produjo `MANIFEST-002-REVIEW-2 = PASS_WITH_REMEDIATION`: MED-01 detectó que el UNIQUE de ownership abierto no impedía todos los solapamientos PUBLISHED y MED-02 que el índice de capability abierta no garantizaba unicidad temporal. La remediación final los reconcilia con scopes exactos, intervalos semiabiertos y exclusion constraints PostgreSQL basadas en `btree_gist`; los índices lookup conservan únicamente sus query paths. El gate Declaration→IntegrationCapability continúa transaccional y fail-closed, sin FK artificial. Todo sigue siendo `RECONCILIATION`/`EXTENSION`: 16 tablas, cero SQL/SQLite/seeds, migration 001 inmutable y `SEC-G01..10` `PLANNED / NOT_EVALUATED`. `MANIFEST-002-REVIEW-3 = PASS` con cero findings y autoriza SQL 002 únicamente como siguiente tarea separada.

El pre-flight físico posterior `MAT-002-PREFLIGHT` bloqueó materialización antes de SQL por cinco findings MEDIUM: scope referencial de RateLimitPolicy, grants/guards no enumerados, límites JSON, lifecycle de `btree_gist` y evolución determinista del runner; además reconcilió tres índices. `MAT-002-PREFLIGHT-REMEDIATION-1` los resuelve documentalmente como `RECONCILIATION/EXTENSION`: FK Tenant e Integration+Provider, matriz TABLE×ROLE×OPERATION×COLUMN SET, contratos JSON limitados/versionados, extensión compartida no destructiva, descriptors/validator ownership/ledger dependency/advisory lock global, mapping review parcial, scheduling retry owned por Dispatch y webhook dead-letter index. No cambia ownership, 16 tablas, bloqueo FISCAL, migration 001, providers ni SEC-G. SQL 002 permanece `NO-GO` hasta repetir el pre-flight independiente sobre el commit de remediación.

`MAT-002-PREFLIGHT-2 = PASS` autorizó la materialización posterior. `MAT-002-MATERIALIZATION = PASS` creó `002_external_integrations_foundation`, evolucionó el runner a descriptors y lock global, validó ownership 001/002 separado, recovery/down y `btree_gist`, y ejecutó pruebas PostgreSQL con roles reales. Migration 001 conserva sus bytes aprobados, SQL 003 sigue ausente, SQLite no recibe scope 002, no existen seeds/adapters/provider calls y `SEC-G01..SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.

## Delta `INT-006 / FISCAL-003-MANIFEST`

`FISCAL-003-MANIFEST = PASS` define documentalmente `003_fiscal_electronic_invoicing_foundation` con nueve tablas `fiscal`, dependencia dirigida 003→002, FKs tenant/company/integration-aware, nueve RLS/FORCE, grants por columnas, guards, descriptor, recovery/down y plan de pruebas. `FiscalSubmissionAttempt` permanece como único owner técnico fiscal; `IntegrationDispatchAttempt` sigue `NON_FISCAL`. La habilitación de `FISCAL` ocurre únicamente después de instalar/validar documento, owner y FK discriminada, como último cambio estructural atómico.

`FISCAL-003-MANIFEST-REVIEW = PASS_WITH_REMEDIATION` identificó seis gaps físicos. `FISCAL-003-MANIFEST-REMEDIATION-1` los cierra documentalmente: owner/cursor y protocolo de numeración por modalidad; connection corporativa y scope `COMPANY|BRANCH` íntegro; RLS worker sin DRAFT; grants literales deny-by-default; `DEBIT_NOTES` aditiva; y downgrade transaccional con orden de locks y guard inverso. También retira dos índices especulativos y acota/sanitiza valores raw. No crea SQL/SQLite, no cambia ownership/número de tablas, no altera 001/002 y requiere `FISCAL-003-MANIFEST-REVIEW-2` antes de materialización.

`FISCAL-003-MANIFEST-REVIEW-2 = PASS_WITH_REMEDIATION` detectó tres gaps residuales. `FISCAL-003-MANIFEST-REMEDIATION-2` fija `pos_app` como creador de documentos remotos y mantiene al worker sin INSERT; define shapes iniciales exhaustivas para versión/documento/attempt/reconciliation/incident con enforcement físico; y extiende un único lock order a publicación, selección, precedencia branch, attempts, webhook/reconciliation e incidentes. No amplía grants, tablas u ownership; SQL/SQLite 003 siguen ausentes y el siguiente gate es `FISCAL-003-MANIFEST-REVIEW-3`.

`FISCAL-003-MANIFEST-REMEDIATION-3` resuelve MED-01 como `RECONCILIATION`: migration 002 históricamente permitía capability/dispatch `DEBIT_NOTES` dentro de `NON_FISCAL`, mientras migration 003 reclasifica `DEBIT_NOTES` como capability fiscal. `MAT-003-PREFLIGHT-CONTRACT-REMEDIATION-1` precisa que el preflight solo inspecciona relaciones exactas de 002: capability, dispatch, attempt por FK, mapping por scope+entidad interna, ownership por `ownership_policy_id` e integridad de scope. Declaraciones y configuraciones globales de provider no prueban uso histórico tenant/company y quedan fuera; tampoco se admiten heurísticas por nombres, `resource_type`, `configuration_type` o JSON. Una fila incompatible bloquea y reporta solo count, IDs y scope; no hay conversión automática ni invención de documento, attempt, identidad legal o evidencia. Solo zero-row permite habilitar el constraint final 003.

`FISCAL-003-MANIFEST-REVIEW-4 = FAIL` detectó B-01/L-01. `FISCAL-003-MANIFEST-REMEDIATION-4 = PASS` incorporó el preflight al único orden topológico exacto antes de toda mutación y corrigió la instrucción operativa; `FISCAL-003-MANIFEST-REVIEW-5 = FAIL` confirmó esas áreas y detectó M-01 por referencias vigentes desfasadas. `FISCAL-003-MANIFEST-REMEDIATION-5 = PASS` reconcilió M-01. En ese corte, la siguiente tarea exacta era `FISCAL-003-MANIFEST-REVIEW-6`, `MAT-003-PREFLIGHT = NO-GO`, SQL 003 permanecía ausente, migration 003 no estaba materializada y `POSTGRESQL_VALIDATION = NOT_EXECUTED / ENVIRONMENT_UNAVAILABLE`.

La evidencia posterior cerró `FISCAL-003-MANIFEST-REVIEW-6 = PASS` y la suite PostgreSQL 16.14 pasó `96/96`. La materialización candidata posterior falló revisión independiente y su primera remediación quedó bloqueada por la ambigüedad de configuración global. `MAT-003-PREFLIGHT-CONTRACT-REMEDIATION-1 = PASS` resuelve esa ambigüedad documental; H-01/M-04 y la implementación de la matriz corregida siguen pendientes.

La clasificación es `NEW + EXTENSION + RECONCILIATION`, sin replacement/deprecation. En ese corte histórico, SQL 003 y SQLite 003 seguían ausentes, migration 003 no estaba materializada, providers no cambiaban de estado y `SEC-G01..SEC-G10` permanecían `PLANNED / NOT_EVALUATED`; la secuencia vigente posterior queda consolidada en el cierre siguiente.

## Cierre de trazabilidad de canonical-role readiness y preflight para MAT-003

La cadena efectiva al cierre queda explícita:

```text
001 materializada, probada e inmutable
  -> 002 materializada, probada e inmutable
  -> contrato MAT-003-PREFLIGHT aprobado
  -> tooling MAT-003-PREFLIGHT materializado y revisado
  -> diseño/revisión de canonical-role readiness aprobados
  -> diseño/revisión del lifecycle de evidencia de reversión aprobados
  -> tooling de role readiness materializado y revisado
  -> LOCAL_CANONICAL_INTEGRATION preparado
  -> validación TARGET fresca 145/145
  -> canonical application preflight READY
  -> canonical role-readiness APPLY PASS
  -> revisión independiente de la aplicación canónica PASS
  -> canonical role-readiness APPLIED / REVIEWED
  -> configuración y ejecución canónica de MAT-003-PREFLIGHT PASS
  -> revisión independiente de la ejecución canónica PASS
  -> MAT-003-PREFLIGHT EXECUTED / PASS / REVIEWED
  -> SQL 003 / descriptor 003 ABSENT; migration 003 NOT_MATERIALIZED
```

`Tooling materializado` no equivale a `ejecución canónica`: ambos estados están registrados de forma separada. El tooling está `MATERIALIZED / REVIEWED`; canonical-role readiness está `APPLIED / REVIEWED`; y el preflight sobre `local-canonical-integration` está `EXECUTED / PASS / REVIEWED`. La ejecución y su revisión observaron los cinco blockers y el trust invariant en `PASS/count=0`, sin evidencia diagnóstica ni mutaciones durables. Esto no completa integración fiscal, no implementa ni verifica SIIGO/FACTUS/ALEGRA, no crea SQL 003 y no promueve `SEC-G01..SEC-G10`.

La revisión conserva como LOW conocido/no bloqueante que el orden de evidencia diagnóstica del preflight no incluye `related_id` como último desempate. No afectó esta ejecución de alcance vacío ni altera el conteo, la clasificación o el comportamiento fail-closed. Los findings del preflight revisado son `CRITICAL=0`, `HIGH=0`, `MEDIUM=0`, `LOW=1 KNOWN / NON_BLOCKING`; la aplicación/revisión operacional de canonical-role readiness cerró por separado con findings en cero.

## Delta B25 — Catalog Readiness / Design Gate

`CATALOG-B25-READINESS = PASS_WITH_DEFERRED_DECISIONS`. Bloque de auditoría pura (read-only), sin código, DDL, migration ni adapter — HEAD no cambia (`503aeb1`). Objetivo: determinar si Catalog está listo para pasar a un bloque formal de diseño/decisiones antes de tocar persistencia.

Hallazgos verificados directamente contra el repositorio:

- `catalog-schema.md` (`TECH-002D`) permanece `IN_REVIEW`, no `APPROVED_FOR_MIGRATION_DESIGN`: dos condiciones propias siguen `pendiente` en su propio gate — constraints de equivalencia/ciclos bajo PostgreSQL y SQLite (R3 validó patrones comunes, no el grafo completo) y auditoría columna por columna contra `UC-CAT-001..006`. `module-boundaries.json` no registra ningún proyecto `catalog`/`database-catalog`; no existe scaffolding de adapter ni migration para Catalog en `tools/target-migrations`.
- `DEC-004` (Product/ProductVariant/ProductPresentation) está `DONE` y responde sin ambigüedad las preguntas de cardinalidad, SKU, identificadores, stock y pricing — pero `packages/domain` solo materializa `Product` (`catalog/product.ts`): `ProductVariant` y `ProductPresentation` son `DOCUMENTED / MISSING IMPLEMENTATION`, no exportados en `domain/src/index.ts`.
- Dependencia objetiva confirmada, ya autodocumentada en el propio código (no descubierta ni resuelta aquí): `InventoryMovement.presentationId` (`domain/src/inventory/inventory-movement.ts:30,46-55`) es un `string` sin validar porque "this repository has no ProductPresentation aggregate" — Inventory ya depende físicamente de una entidad de Catalog que todavía no existe como agregado de dominio. No se modificó Cash ni Inventory para esta auditoría.
- `Product` no tiene `version` ni ciclo de desactivación (`status` fijo en `'ACTIVE'`); `ProductRepository`/`CatalogAuthorizationPort` no tienen implementación SQLite ni PostgreSQL (comentario propio: "No SQLite/PostgreSQL adapter implements this... DDL gate is NO-GO").

`DDL: NOT READY`. `MIGRATION: NOT READY`. No se registra ningún blocker crítico nuevo: las brechas encontradas ya estaban documentadas por el propio código/docs, no son contradicciones nuevas. El siguiente bloque correcto es un diseño formal de persistencia física para `ProductVariant`/`ProductPresentation` (extensión de `catalog-schema.md` hacia `APPROVED_FOR_MIGRATION_DESIGN`) antes de cualquier DDL/migration/adapter — Inventory no puede materializar su propio DDL antes de eso sin fabricar la dependencia.

## Delta B26 — Catalog Model Closure / Human Decisions Gate

`CATALOG-B26-CLOSURE = PASS_WITH_DEFERRED_DECISIONS`. Continuación de B25, también read-only — HEAD no cambia (`503aeb1`), sin código, DDL, migration, adapter ni cambios en Cash/Inventory. Objetivo: cerrar el modelo lógico de Catalog columna por columna y clasificar cada punto abierto como `CLOSED`/`HUMAN DECISION REQUIRED`/`ARCHITECTURAL DECISION`/`IMPLEMENTATION GAP`/`CONTRADICTION`.

Hallazgos nuevos respecto a B25, verificados directamente:

- `permission-matrix.md` §"Productos y precios" solo define `Crear/Editar/Desactivar producto`. UC-CAT-003/004/005 declaran permisos propios (`catalog.identifier.manage`, `catalog.variant.create`, `catalog.presentation.create`) y UC-CAT-006 usa `inventory.presentation.convert` — ninguno tiene fila en la matriz. Autorización de Variant/Presentation/Identifier/Conversion: `HUMAN DECISION REQUIRED`, no se puede copiar `roleMayCreateProduct`.
- `version` como optimistic-concurrency: semántica exacta ya resuelta por precedente arquitectónico real (`CashShift`: crea en `1`, incrementa en cada mutación aceptada, `expectedVersion` guard) y confirmada compatible con UC-CAT-002 ("verifica versión actual... incrementa la versión") — `ARCHITECTURAL DECISION`, no requiere decisión humana nueva.
- `variant_policy`: valores y semántica conceptual cerrados en `DEC-004`, pero su mutabilidad post-creación (¿puede cambiar de `REQUIRED_VARIANTS` a `NO_VARIANTS` con Variants ya creadas?, ¿quién autoriza?) no está definida en ningún documento — solo aparece listada bajo "Cambios de alto impacto" de UC-CAT-002 sin regla. `HUMAN DECISION REQUIRED`.
- Clave canónica de Variant: "normalizar los atributos" nunca se especifica operacionalmente (mayúsculas/Unicode/espacios/orden ya cubierto conceptualmente, pero el algoritmo determinista no existe en ningún documento). `HUMAN DECISION REQUIRED`.
- `default_sales/purchase/inventory_presentation_id`: exigidas conceptualmente por `DEC-004` ("debe existir como relación explícita") pero **ausentes de la tabla física real** `catalog.product_presentations` en `catalog-schema.md` — gap documento-a-documento, no solo código-a-documento. `IMPLEMENTATION GAP` a nivel de físico, más una `HUMAN DECISION REQUIRED` sobre quién las establece.
- `Product.stock_controlled` (booleano, todo-o-nada) vs `Presentation.stock_mode` (`INDEPENDENT/CONVERTED_TO_BASE/DERIVED/NON_STOCK`, por presentación): ninguna fuente define su interacción (p. ej. si `stock_controlled=false` debe forzar `NON_STOCK` en todas las presentaciones). No es contradicción (nada incompatible se afirma), es infraespecificación. `HUMAN DECISION REQUIRED`.
- `business_attributes`: confirmado sin contrato publicado en ningún documento — `catalog-schema.md` ya resuelve el caso por defecto ("mientras no exista contrato publicado solo admite el objeto vacío"). `DEFERRED`, no bloqueante.

`DDL: NO-GO`. `MIGRATIONS: NO-GO`. `ADAPTERS: NO-GO`. `INVENTORY: NO-TOUCH`. Cero `BLOCKER`/`MAJOR` nuevos — todas las brechas son `HUMAN DECISION REQUIRED`/`IMPLEMENTATION GAP` ya delimitadas, no contradicciones activas entre fuentes autoritativas. El siguiente bloque recomendado es **B27 — Catalog Domain/Application Design**, condicionado a que el owner resuelva primero el registro de decisiones humanas de este delta (autorización de Variant/Presentation/Identifier/Conversion, mutabilidad de `variant_policy`, algoritmo de normalización de clave canónica, ownership de default presentations, relación `stock_controlled`↔`stock_mode`).

## Delta B27 — Catalog Domain/Application Design

`CATALOG-B27-DESIGN = PASS_WITH_DEFERRED_DECISIONS`. Materializa Domain +
Application para Catalog sin persistencia — cero DDL, migration, adapter,
o cambio en Inventory/Cash/Tax. Respeta la clasificación de B26: cada
decisión ya cerrada se implementó; ninguna `HUMAN DECISION REQUIRED` se
resolvió por inferencia — cada una quedó aislada detrás de un puerto
reemplazable o simplemente sin operación que la ejercite todavía.

Materializado en `packages/domain/src/catalog/` (Product extendido con
`version`/`status`/`variantPolicy`/`update()`/`deactivate()`;
`ProductVariant`, `VariantAttributes`, `ProductPresentation`,
`ProductIdentifier`, `UnitConversion`, `ConversionFactor` nuevos) y
`packages/application/src/` (`UpdateProductUseCase`,
`DeactivateProductUseCase`, `CreateVariantUseCase`,
`CreatePresentationUseCase`, `AssignIdentifierUseCase`,
`DefineConversionUseCase`, con sus repository ports y dos policy ports —
`VariantCanonicalKeyPolicy`/`IdentifierNormalizationPolicy` — sin
implementación real, mismo tratamiento que `CatalogAuthorizationPort` no
tiene actor real todavía). Los códigos de error cross-entity reutilizan
textualmente el registro de DEC-004 (`CATALOG_VARIANT_NOT_ALLOWED`,
`CATALOG_VARIANT_PRODUCT_MISMATCH`, `CATALOG_SKU_DUPLICATE`, etc.) en vez
de inventar nombres paralelos.

Decisiones B26 tratadas explícitamente: HD-05 (mutabilidad de
`variant_policy`) — no se ofrece ningún mutator, el campo se fija solo en
creación. HD-06 (clave canónica) — aislada detrás de
`VariantCanonicalKeyPolicy`, sin implementación de producción; los tests
usan un fake declarado como tal. HD-07 (default presentations) — NO
implementadas, ni siquiera como columna; permanecen fuera del agregado.
HD-08 (`stock_controlled`↔`stock_mode`) — no se fuerza ninguna relación
entre ambos; `ProductPresentation.inventoryEnabled` se deriva solo de
`stockMode`, nunca de `Product.stockControlled`. HD-09 (política de
borrador) — `Product.create()` sigue produciendo siempre `ACTIVE`; `DRAFT`
existe en el tipo por fidelidad de schema pero ningún código lo produce.
HD-01/02/03 (autorización de Variant/Presentation/Identifier) — los
métodos `roleMayCreateVariant`/`roleMayCreatePresentation`/
`roleMayAssignIdentifier` fallan cerrado incondicionalmente para los 6
roles existentes, verificado explícitamente en tests.

Hallazgos nuevos de B27, registrados sin resolver por intuición:

- La ejecución de UC-CAT-006 (`inventory.presentation.convert`) es
  enteramente de Inventory — UC-CAT-006 nunca describe una definición de
  conversión propia de Catalog; catalog-schema.md sí la describe (bundleada
  con `UC-CAT-005`). B27 la modela como `DefineConversionUseCase`,
  operación separada y propia autorización (`canDefineConversion`, que
  falla cerrado igual que HD-01..03) — no bundleada dentro de
  `CreatePresentationUseCase`, porque el pipeline de 10 pasos que B27 fija
  para esa clase nunca incluye ese paso.
- Normalización de identificadores (UC-CAT-003: "el sistema normaliza el
  valor según el tipo", sin algoritmo por tipo) es la misma clase de vacío
  que HD-06 — aislada detrás de `IdentifierNormalizationPolicy`, sin
  implementación real.
- `CONTRADICTION` (MINOR): `catalog.product_identifiers.presentation_id`
  (catalog-schema.md) no lleva anotación `NULL` — es obligatorio — mientras
  `DEC-004` permite conceptualmente identificadores informativos en Product/
  Variant sin resolver a Presentation. B27 sigue catalog-schema.md (y la
  instrucción explícita del propio bloque: "Identifier -> Presentation, NOT
  Identifier -> Product"), sin alterar ninguno de los dos documentos.
- `MINOR`: `ProductVariant` conceptual de `DEC-004` incluye
  `internal_reference`/`display_name`; la tabla física real de
  catalog-schema.md los omite. B27 modela solo lo que catalog-schema.md
  cierra (`canonical_attributes`/`attributes_checksum`), sin inventar los
  dos campos ausentes.
- `IMPLEMENTATION GAP` (no bloqueante para B28): campos de presentación por
  peso (`minimum/maximum/tare_quantity`, `scale_format`), `valid_from`/
  `valid_until` de Identifier, y detección de ciclos/solapamiento de
  `UnitConversion` (invariante de grafo, requiere adapter real para
  probarse) — ninguno modelado en B27, ninguno inventado.

`DDL: NO-GO`. `MIGRATIONS: NO-GO`. `ADAPTERS: NO-GO`. `INVENTORY:
NO-TOUCH`. `CASH: NO-TOUCH`. `TAX: NO-TOUCH`. Regresión completa limpia:
Domain 189/189 (104 previos + 85 nuevos), Application 177/177 (102
previos + 75 nuevos), database-sqlite 35/35, database-postgres 13/13,
target-migrations 249/249 (los tres últimos sin cambios, confirmando cero
impacto fuera de Catalog), `pnpm -w typecheck` limpio en 8 proyectos,
`architecture-check` PASS sin caché — sin imports Domain/Application →
infraestructura verificados explícitamente. El siguiente bloque
recomendado es **B28 — Catalog Physical Model** (traducción lógica →
física, todavía sin DDL), condicionado a que las HD registradas en B26
(ahora confirmadas, no cerradas por B27) sigan bloqueando cualquier
columna/invariante física que dependa de ellas.

## Delta B28-PAYNOTIF — Payment Confirmation + POS Notification Contract

`PAYMENT-B28-PAYNOTIF = PASS_WITH_DEFERRED_DECISIONS`. Bloque de
construcción controlada, Domain + Application únicamente — cero DDL,
migration, adapter, o cambio en Inventory/Cash/Tax/Catalog. Objetivo:
dejar preparado (no implementado) el flujo QR/Llave → confirmación
externa autoritativa → `PaymentConfirmed` → notificación visual/sonora
del POS, provider-agnostic, sin inventar Bre-B/Nequi/Daviplata/Dale!.

Auditoría previa (Fase 1) encontró una precisión importante, registrada
antes de implementar: `UC-PAY-001 §2` (Transferencia o QR estático) enruta
la confirmación de `STATIC_QR` por el flujo MANUAL de `UC-PAY-003`
(cajero/administrador con `payments.transfer.confirm`), no por una fuente
externa automatizada — solo `UC-PAY-001 §3` (Tarjeta o proveedor externo)
describe confirmación automática vía webhook/callback autenticado. El
flujo pedido por este bloque ("fuente externa confiable confirma") es
genéricamente el patrón §3, no una extensión de §2. B28-PAYNOTIF NO
modifica ni contradice UC-PAY-001/UC-PAY-003: construye la confirmación
automatizada de forma agnóstica al `payment_method` exacto, dejando
explícito que la asignación de un futuro proveedor Bre-B a `DYNAMIC_QR`/
`DIGITAL_WALLET` (las categorías ya cerradas más cercanas) es una decisión
humana pendiente, no resuelta aquí — 0 CONFLICTS BLOCKER/MAJOR.

Materializado en `packages/domain/src/payment/` (`Payment`, `PaymentAttempt`
— campos y `PaymentAttemptStatus`/`PaymentStatus` transcritos del
`PAY-007`/`payments-schema.md` reales, narrowed a lo que este flujo
alcanza; `MerchantCollectionIdentifier` para QR_STATIC/KEY, explícitamente
nunca prueba de pago; eventos `PaymentInitiated`/`PaymentConfirmed`, ya
catalogados en `event-catalog.md`, reutilizados verbatim;
`PaymentConfirmedNotificationRequested`, nombre nuevo permitido
explícitamente por el bloque, derivado de `PaymentConfirmed` sin mezclar
máquinas de estado — `Payment.status` nunca depende de si la notificación
se generó, entregó o deduplicó) y `packages/application/src/`
(`InitiatePaymentUseCase`, `ConfirmPaymentUseCase`, con
`PaymentConfirmationAuthenticityPort`/`PosNotificationPort` sin
implementación real — mismo tratamiento que los ports de Catalog sin
política de producción).

Orden del pipeline de `ConfirmPaymentUseCase` no es inventado: transcribe
literalmente la frase de `payments-schema.md` — "verifican autenticidad,
replay, provider reference, amount, currency, tenant/configuración y
transición antes de producir el estado autoritativo."

Deduplicación de notificación (Fase 2-F) resuelta como mecanismo
DISTINTO de la idempotencia del pago: `notificationId` determinístico
(`payment-confirmed:<paymentId>`), verificado con una prueba dedicada que
entrega la MISMA notificación 5 veces de forma concurrente y confirma
exactamente 1 `DELIVERED` + 4 `ALREADY_DELIVERED`, sin pasar por una
segunda confirmación de pago.

Realtime (Fase 2-G): el canal IPC local (`apps/pos-local-service/src/
channel/*`) fue auditado, no tocado — confirmado que es request/response
mismo-proceso (`runtime.handshake`, `operation.confirm`,
`operation.result.get`, sin tipo de mensaje server-initiated) y por tanto
no resuelve por sí solo la llegada de un evento remoto. `PosNotificationPort`
queda como abstracción de transporte, sin adapter.

`DDL: NO-GO`. `MIGRATIONS: NO-GO`. `ADAPTERS: NO-GO`. `INVENTORY/CASH/TAX/
CATALOG: NO-TOUCH`. `BRE-B: NOT IMPLEMENTED — REQUIRES REAL PROVIDER
DOCUMENTATION`. Regresión completa limpia: Domain 218/218 (189 previos +
29 nuevos), Application 203/203 (177 previos + 26 nuevos), database-sqlite
35/35, database-postgres 13/13, target-migrations 249/249, pos-local-service
45/45+2 skipped (los últimos cuatro sin cambios, cero impacto fuera de
Payment), `pnpm -w typecheck` limpio en 8 proyectos, `architecture-check`
PASS sin caché, sin imports Domain/Application → infraestructura ni
referencias a proveedores concretos (verificado por grep). El siguiente
bloque correcto para continuar ESTE hilo es un futuro diseño del webhook
receiver/adapter real (fuera de alcance mientras `SEC-G04/05` y el
esquema de firma sigan sin evaluar) — Catalog's own **B28 — Physical
Model** (arriba) permanece un hilo independiente, sin relación con este
delta.

## Delta B29 — Catalog Persistence (SQLite + PostgreSQL)

`CATALOG-B29-PERSISTENCE = PASS_WITH_DEFERRED_DECISIONS`. Cierra la
persistencia del modelo Domain/Application aprobado por B26/B27 sobre
ambos motores — SQLite (MIGRATION_009) y PostgreSQL
(`005_catalog_foundation`) — con evidencia real de ejecución, no por
inspección. Ninguna decisión `HUMAN DECISION REQUIRED` de B26 se resolvió;
el modelo lógico no se modificó para facilitar persistencia; Cash/
Inventory/Sales/Tax/Payments no se tocaron salvo dos correcciones a
guardrails compartidos, documentadas abajo.

**SQLite** (`packages/database-sqlite/`): `MIGRATION_009` agrega 6 tablas
(`catalog_products`, `catalog_product_mutation_log`,
`catalog_product_variants`, `catalog_product_presentations`,
`catalog_product_identifiers`, `catalog_unit_conversions`), campo por
campo idéntico a los agregados reales de B27 (no al superset aspiracional
de `catalog-schema.md`). Repositorios nuevos: `SqliteProductRepository`,
`SqliteProductVariantRepository`, `SqliteProductPresentationRepository`,
`SqliteProductIdentifierRepository`, `SqliteUnitConversionRepository`,
usando `better-sqlite3` crudo, mismo patrón de
`isUniqueConstraintViolation` que Cash. `packages/database-sqlite/tests/
catalog-repository.test.ts`: 13/13 tests reales (temp-dir SQLite, sin
mocks) — CREATE/FIND, UNIQUENESS, IDEMPOTENCY con snapshot histórico
correcto tras un update posterior, OPTIMISTIC CONCURRENCY (lost-update),
REAL CONCURRENCY (`Promise.all`, exactamente un ganador), DEACTIVATE,
ROLLBACK (CHECK forzado, cero fila parcial en la tabla de negocio NI en el
log), reapertura de archivo, FK real product→presentation→identifier,
cadena Variant+Presentation+Identifier end-to-end, conversión con rechazo
de par duplicado, aislamiento tenant/company.

**PostgreSQL** (`tools/target-migrations/sql/postgres/
005_catalog_foundation.{up,down}.sql`): mismas 6 tablas en `CREATE SCHEMA
catalog`, `uuid` PK con `CHECK (platform.is_uuid_v7(id))`,
`numeric(19,6)`/`numeric(19,10)` para cantidades/factor,
`ENABLE`+`FORCE ROW LEVEL SECURITY` en las 6 tablas con política
`tenant_id = platform.current_tenant_id()`. Descriptor
(`POSTGRES_005_DESCRIPTOR`) depende únicamente de 001 (no de 004/Cash —
Catalog es `CompanyScope`, no branch-scoped). `packages/database-postgres/
src/postgres-{product,product-variant,product-presentation,
product-identifier,unit-conversion}-repository.ts`: mismo mapping
domain↔fila que SQLite, usando `PostgresDatabase.withTenantTransaction`
directamente por método (sin constructor per-tenant — a diferencia de
Cash, cada método de los ports de Catalog ya recibe `scope`). Error
mapping: `error.code === '23505' && error.constraint === '<nombre>'` →
`IdempotencyKeyConflictError`/`CatalogDuplicateConflictError`/
`ProductConflictError` (puerto nuevo,
`packages/application/src/ports/catalog-conflict-errors.ts`), reemplazando
el string-matching que SQLite necesita. `packages/database-postgres/
tests/catalog-repository.test.ts`: 13/13 tests reales contra el
contenedor PostgreSQL 16.14 vivo (`target-migrations-postgres-1`) —
mismo catálogo de casos que SQLite más dos pruebas específicas de
PostgreSQL: aislamiento por RLS real (no solo `WHERE` a nivel de
aplicación — una transacción con `app.tenant_id` de OTRO tenant ve cero
filas, incluso consultando por id exacto) y verificación de que la
sesión sin contexto de tenant correcto no filtra datos.
`tools/target-migrations/tests/postgres-005-migration.test.ts`: 35
aserciones sobre el ciclo de vida completo de la migración (apply/no-op/
checksum/crash-recovery/concurrencia/down/reapply), igual rigor que
`postgres-004-migration.test.ts` de Cash.

**Fallas reales encontradas y corregidas durante la ejecución** (ninguna
asumida, todas reproducidas contra el contenedor real antes de corregir):

1. `PROHIBITED_TABLE_NAMES` (`tools/target-migrations/src/contract.ts`)
   bloqueaba `products`/`product_variants` por nombre de tabla desnudo
   (sin importar schema) — guardrail deliberado contra materialización
   prematura de dominios comerciales, ahora obsoleto para estos dos
   nombres puntuales dado el cierre B26→B27→B28. Se retiraron SOLO esas
   dos entradas, con comentario explicando el motivo; las ~18 restantes
   (Sales, Payments, Inventory, Devices/Licenses, Tax, Documentos
   Electrónicos, etc.) siguen protegidas sin cambio.
2. Varios `CHECK` sin `CONSTRAINT <nombre>` explícito en
   `005_catalog_foundation.up.sql` generaban nombres autogenerados por
   PostgreSQL que el parser de introspección (regex sobre
   `CONSTRAINT\s+(...)`) no podía predecir → "constraint set diverges".
   Se nombraron los 12 CHECK que faltaban, siguiendo la convención ya
   usada en `004_cash_foundation.up.sql` (cero CHECK sin nombre).
3. Bug real en `postgres-product-repository.ts`: `insertLog` generaba el
   id de `catalog.product_mutation_log` (fila de infraestructura propia
   del adapter, NO un id de agregado de dominio) con `randomUUID()`
   (UUIDv4) — violaba `catalog_product_mutation_log_id_v7_ck`. Corregido
   con un generador de UUIDv7 real (RFC 9562: 48 bits de timestamp +
   cola aleatoria con nibbles de versión/variante correctos), encontrado
   y corregido recién al escribir los tests del adapter contra el
   contenedor real — no detectable por typecheck.

**Paridad SQLite↔PostgreSQL** (misma cobertura de test real en ambos
motores, sin excepción): Create Product, Update Product (optimistic
concurrency + replay), Deactivate Product, Create Variant, Create
Presentation, Assign Identifier, Define Conversion, Uniqueness
(internal_code/canonical_key/sku/identifier natural/conversion pair), FK
referencial (presentation→product, identifier→presentation), Real
concurrency (`Promise.all`), Rollback sin fila parcial, Idempotency con
snapshot histórico fiel, Tenant/company scope isolation. Única asimetría
intencional: SQLite prueba además "reapertura de archivo" (irrelevante en
PostgreSQL) y PostgreSQL prueba además aislamiento por RLS real
(mecanismo que SQLite no tiene). Ninguna divergencia de comportamiento de
negocio entre motores.

**Invariantes cross-tabla y dónde se aplican** (auditoría explícita,
FASE 7 de B29): unicidad de `internal_code` → constraint DB (índice
parcial en ambos motores, ya que es nullable). Optimistic concurrency de
`Product` (update/deactivate) → aplicación (`expectedVersion` en el
command) + constraint DB (`UPDATE ... WHERE version = priorVersion`,
`rowCount 0` → `ProductConflictError`). Idempotencia de las 3 mutaciones
de Product → tabla dedicada `catalog_product_mutation_log`/
`catalog.product_mutation_log` (snapshot JSON, no la fila actual).
Idempotencia de Variant/Presentation/Identifier/Conversion (create-only)
→ columna `idempotency_key` + UNIQUE directo en su propia tabla.
Referential integrity Variant→Product, Presentation→Product/Variant,
Identifier→Product/Variant/Presentation, Conversion→Product/Variant/
Presentation(x2) → FK compuesto `(tenant_id, company_id, id)` real en
ambos motores (SQLite con `PRAGMA foreign_keys`, PostgreSQL nativo).
Unicidad de par de conversión → constraint DB
(`catalog_unit_conversions_pair_uq` / `UNIQUE(...)` SQLite). Aislamiento
tenant/company → aplicación (todo repository filtra por `scope` en cada
query) + RLS real en PostgreSQL (defensa en profundidad; SQLite no tiene
un mecanismo equivalente, documentado como asimetría de motor, no de
dominio).

`DDL: GO (Catalog únicamente)`. `MIGRATIONS: GO (SQLite MIGRATION_009,
PostgreSQL 005_catalog_foundation)`. `ADAPTERS: GO (10 repositorios,
SQLite + PostgreSQL)`. `INVENTORY/SALES/PAYMENTS-REAL/BRE-B/FRONTEND:
NO-TOUCH`. `CASH: NO-TOUCH` (ninguna dependencia de Cash forzó tocarlo;
el descriptor 005 depende solo de 001). Regresión completa limpia: Domain
218/218, Application 203/203 (sin cambios respecto a B27/B28 — B29 no
tocó domain/application salvo el nuevo puerto
`catalog-conflict-errors.ts` y el try/catch de idempotencia-conflicto en
los 7 use cases de Catalog), database-sqlite 48/48 (35 Cash + 13 Catalog
nuevos), database-postgres 26/26 (13 Cash + 13 Catalog nuevos — un fallo
de timing preexistente y no relacionado en el test de concurrencia real
de Cash reprodujo de forma intermitente al correr el archivo completo,
mismo test pasa 100% aislado y en dos corridas completas consecutivas;
no es una regresión de B29, Cash no fue tocado), target-migrations
284/284 (249 previos + 35 nuevos), pos-local-service 45/45+2 skipped,
contracts 60/60, observability 4/4 (sin cambios, cero impacto fuera de
Catalog), `pnpm -w typecheck` limpio en 8 proyectos, `architecture-check`
PASS sin caché — sin bypass de repository desde domain/application, sin
ORM/framework nuevo. Decisiones B26 diferidas explícitamente sin
resolver: HD-01/02/03 (autorización real de Variant/Presentation/
Identifier — siguen fail-closed), HD-06 (clave canónica —
`VariantCanonicalKeyPolicy` sin implementación de producción), HD-07
(default presentations), IdentifierNormalizationPolicy sin
implementación real. Catalog queda operativo (persistencia demostrada
con evidencia real en ambos motores); Inventory permanece explícitamente
`NO-GO` — este bloque no lo autoriza.

## Delta B30 — Inventory Readiness / Design Gate

`INVENTORY-B30-READINESS = PASS_WITH_DEFERRED_DECISIONS`. Bloque de
auditoría pura (read-only), sin código, DDL, migration ni adapter — HEAD
no cambia. Mismo posture que B25: determinar si Inventory está listo
para un bloque formal de model closure/HD gate, no persistencia todavía.

**Dependencia crítica que B25 dejó abierta queda resuelta**: B25
(`traceability.md:361`) flageó que `InventoryMovement.presentationId`
era un `string` sin validar porque "this repository has no
ProductPresentation aggregate" — Inventory ya dependía físicamente de
una entidad de Catalog que no existía como agregado de dominio. B27/B29
materializaron `ProductPresentation` completo (domain + application +
persistencia real en ambos motores); `InventoryMovement` ya puede
referenciar un agregado real, aunque el código de Inventory sigue sin
validar la referencia contra un repository (documentado como gap
explícito en el propio comentario de `inventory-movement.ts:46-55`, sin
cambios en este bloque).

**Estado real del código existente** (packages/domain/src/inventory/,
packages/application/src/{ports,use-cases,authorization}, con tests
reales ya incluidos en la regresión 218/218 Domain y 203/203
Application reportada en B29 — nada de esto es nuevo de B30):

- `InventoryMovement` (domain): agregado append-only real, seis tipos
  cerrados (`POSITIVE_ADJUSTMENT`, `NEGATIVE_ADJUSTMENT`, `WASTE`,
  `TRANSFER_OUT`, `TRANSFER_IN`, `RESERVATION_CONSUMPTION`), solo
  `positiveAdjustment`/`negativeAdjustment` tienen factory y caso de
  uso; los otros cuatro son miembros reales sin lógica de negocio
  todavía, documentado explícitamente como tal (mismo posture que
  `CashMovementType`'s 14 tipos no tocados).
- `calculateOnHandQuantity` (domain): fold puro sobre movimientos
  postados — replica el patrón `calculateExpectedCash` de Cash. Calcula
  solo `on_hand`, no `reserved`/`available` (`StockBalance` completo no
  está modelado — `InventoryReservation` no existe en código).
- `RegisterInventoryAdjustmentUseCase` (application): único caso de uso
  real — autorización → replay de idempotencia → validación de cantidad
  → validación de `reasonCode` no vacío → persistir → recalcular
  on-hand. `expectedVersion` deliberadamente no usado (hecho
  append-only, sin fila versionada que proteger).
- `InventoryMovementRepository`/`InventoryAuthorizationPort`: ports sin
  ningún adapter SQLite/PostgreSQL — mismo comentario explícito que
  Catalog tenía antes de B29 ("DDL gate is NO-GO").
- `roleMayAdjustInventory`: única política de autorización — dos roles
  sin condición (`OWNER`, `GENERAL_ADMIN`); `BRANCH_MANAGER`/
  `INVENTORY_OPERATOR` ("Condicional") y `SUPERVISOR` ("Autorizar", rol
  de aprobación en un workflow de dos fases no modelado) fallan cerrado,
  documentado igual que las HD de Catalog.

**Alcance físico documentado pero SIN código todavía** — brecha real,
no descubrimiento de contradicción, entre `inventory-schema.md`
(`TECH-002 R2-B`, `CLOSED` documentalmente) + `inventory-receiving-schema.md`
(`TECH-002E`/`PHY-G06`, `CLOSED` documentalmente) y el código actual:

- `StockBalance` como proyección persistida con `expected_version`
  (hoy solo existe como fold puro en memoria, sin fila ni versión).
- `InventoryReservation` (estados `ACTIVE`/`PARTIALLY_CONSUMED`/
  `CONSUMED`/`RELEASED`/`EXPIRED`/`CANCELLED`) — sin agregado de
  dominio.
- `Lot` (identidad, `deduplication_key` versionada, FEFO/FIFO,
  `parent_lot_id`) — sin agregado de dominio; `InventoryMovement.lotId`
  se acepta hoy como `string | null` sin resolver contra ningún Lot.
- `GoodsReceipt`/`GoodsReceiptLine`/`GoodsReceiptLotAllocation`/
  `InventoryCostRecord` (schema `purchasing.*`, ownership real de
  Purchasing/PUR-001 — no de Inventory, aunque el documento físico los
  describe juntos) — sin ningún agregado de dominio; `PUR-001`/`PUR-002`
  siguen `PLANNED` en el backlog.
- `InventoryLocation`/`Supplier` (masters `CENTRAL_MASTER_REPLICATED`)
  — sin agregado de dominio; nada los referencia todavía salvo como
  `string` IDs sin validar.
- `TRANSFER_OUT`/`TRANSFER_IN`/`RESERVATION_CONSUMPTION`/`WASTE`: los
  cuatro tipos de movimiento restantes no tienen caso de uso propio.

**Hallazgo nuevo de autorización** (no era visible sin leer
`permission-matrix.md` línea a línea junto al código): la matriz define
filas de permiso **distintas** para Ajuste, Merma, Traslado y Recepción
— no una sola política de "ajuste de inventario" cubre las cuatro.
`roleMayAdjustInventory` cubre correctamente solo Ajuste positivo/
negativo. Concretamente:
  - **Merma** (`Registrar merma`): Sí/Sí/Sí/Sí/Sí/Condicional (OWNER,
    GENERAL_ADMIN, BRANCH_MANAGER, SUPERVISOR, INVENTORY_OPERATOR
    todos sin condición; solo CASHIER es "Condicional") — fila
    **cerrada, sin ambigüedad** salvo el único "Condicional" de
    CASHIER; implementable en B31/B32 sin nueva decisión humana para
    los primeros cinco roles.
  - **Traslado** (`Trasladar inventario`): Sí/Sí/Condicional/Autorizar/
    Sí/No — mismo patrón de HD que Ajuste para `BRANCH_MANAGER`
    ("Condicional") y `SUPERVISOR` ("Autorizar"), pero
    `INVENTORY_OPERATOR` aquí es Sí sin condición (a diferencia de
    Ajuste, donde es "Condicional") — confirma que NO es la misma
    política reutilizada con otro nombre.
  - **Recepción** (`Registrar GoodsReceipt confirmado`, sección
    "Recepción y proveedores"): Sí/Sí/Sí/Sí/Sí/No para OWNER/
    GENERAL_ADMIN/BRANCH_MANAGER/PURCHASING_OPERATOR/SUPERVISOR/CASHIER
    — fila **completamente cerrada**, sin ningún "Condicional".
  - Ninguna de las tres tiene código todavía (`roleMayAdjustInventory`
    es la única función existente); implementar Traslado/Merma/
    Recepción como la misma función que Ajuste sería fabricar una
    autorización que la matriz no otorga.

**Discrepancia de nombre** (MINOR, no bloqueante): el evento de dominio
existente se llama `InventoryAdjustmentRecorded`
(`inventory-adjustment-recorded-event.ts`), pero
`docs/domain/event-catalog.md:151` cataloga el evento equivalente como
`InventoryAdjusted`. B25 no tocó esto (era Catalog); queda registrado
aquí para que B31 decida si renombrar o si son eventos deliberadamente
distintos (el catálogo no lo aclara).

**Ownership confirmado sin ambigüedad** (`data-ownership.md:41,48`,
`module-map.md:112`): "Inventory es la única autoridad para existencias
y reservas"; "Purchasing confirma la recepción física, pero Inventory
es la única autoridad que crea movimientos y deriva saldos; una
recepción nunca modifica StockBalance por fuera del contrato de
Inventory." — GoodsReceipt/Supplier pertenecen a Purchasing (PUR-001/
PUR-002), no a Inventory, aunque estén documentados en el mismo archivo
físico. Un futuro B-block de Inventory persistence no debe fabricar
tablas `purchasing.*` bajo pretexto de recepción — esa es otra épica.

`DDL: NOT READY`. `MIGRATIONS: NOT READY`. `ADAPTERS: NOT READY`. No se
registra ningún blocker nuevo — todas las brechas encontradas ya estaban
documentadas por el propio código o eran derivables de contrastar
`permission-matrix.md` con el código, no contradicciones nuevas. El
siguiente bloque correcto es **B31 — Inventory Model Closure / Human
Decisions Gate**, mismo patrón que B26: clasificar cada pregunta
abierta (StockBalance/Reservation/Lot como agregados, las 4 filas de
autorización distintas, el nombre de evento) como CLOSED / HUMAN
DECISION REQUIRED / IMPLEMENTATION GAP, sin resolver ninguna por
inferencia. GoodsReceipt/Purchasing quedan fuera de ese bloque — son
PUR-001/PUR-002, épica separada.

## Delta B31 — Inventory Model Closure / Human Decisions Gate

`INVENTORY-B31-CLOSURE = PASS_WITH_DEFERRED_DECISIONS`. Continuación de
B30, también read-only — sin código, DDL, migration ni adapter.
Objetivo: cerrar el modelo lógico de Inventory operación por operación y
clasificar cada punto abierto como `CLOSED`/`HUMAN DECISION REQUIRED`/
`ARCHITECTURAL DECISION`/`IMPLEMENTATION GAP`/`CONTRADICTION`, tomando
como entrada `docs/use-cases/inventory/UC-INVENTORY-002-manage-stock-lifecycle.md`
(leído completo por primera vez en este hilo — B30 no lo había citado)
y la sección Inventory de `docs/architecture/conceptual-data-model.md`
(líneas 1419-1794).

### Boundary (CLOSED, sin ambigüedad)

`conceptual-data-model.md` separa Inventory de "Recepción y compras
futuras" con encabezados `##` distintos, no solo por afirmación en
`data-ownership.md`: `Supplier`, `PurchaseOrder` (diferido `PUR-001`),
`GoodsReceipt`/`GoodsReceiptLine`/`GoodsReceiptLotAllocation`,
`InventoryCostRecord` y `SupplierReturn` (diferido `PUR-001`) viven bajo
ese segundo encabezado — confirma que `InventoryCostRecord`, pese al
prefijo `Inventory`, es responsabilidad conceptual de Purchasing/
recepción (costo, no existencia física), no de Inventory. Inventory
posee: `InventoryPolicy`/`InventoryPolicyVersion`, `InventoryLocation`,
`StockBalance`, `InventoryMovement`, `Lot`, `InventoryReservation`,
`InventoryTransfer`/`InventoryTransferLine`.

### Aggregates

- **InventoryMovement**: `CLOSED`, ya codificado y probado. Fuente de
  verdad; append-only por construcción (sin update/delete). `lotId`
  aceptado sin resolver contra un agregado `Lot` real — gap ya
  documentado desde B25, sigue abierto (ver HD-INV-01).
- **StockBalance**: `CLOSED` semánticamente — clave exacta `(tenant,
  company, branch, location, presentation, lot opcional)`,
  `available_quantity = on_hand_quantity - reserved_quantity`
  (`inventory-receiving-schema.md:135`), `expected_version` en la misma
  transacción del hecho. `IMPLEMENTATION GAP`: hoy solo existe
  `calculateOnHandQuantity`, un fold puro sobre `on_hand`, sin fila
  persistida ni `reserved`/`available`.
- **InventoryReservation**: `CLOSED` semánticamente (atributos, reglas
  de reducción de disponibilidad sin tocar existencia física,
  `idempotency_key`, versión) — **excepto los estados**, ver
  `CONTRADICTION` abajo. `IMPLEMENTATION GAP`: sin agregado de dominio.
- **Lot**: `CLOSED` semánticamente para los atributos/estados que
  `inventory-receiving-schema.md` cierra (`ACTIVE`/`BLOCKED`/
  `DEPLETED`/`EXPIRED`, `deduplication_key` versionada, FEFO/FIFO
  gobernado por policy, no hardcoded). `IMPLEMENTATION GAP`: sin
  agregado; depende además de `InventoryPolicyVersion`, tampoco
  codificado.
- **InventoryTransfer` / `InventoryTransferLine`**: `CLOSED` — hallazgo
  nuevo de este bloque. `conceptual-data-model.md:1556-1641` especifica
  un agregado propio completo (7 estados, atributos, 12 reglas,
  cardinalidades con `InventoryTransferLine`), no solo la lista de
  estados que B30 había visto en `UC-INVENTORY-002`. Resuelve
  explícitamente la pregunta de B31 FASE 4 ("¿debe existir una
  operación/aggregate de transferencia?"): **sí**, un traslado nunca se
  modela como dos `InventoryMovement` sueltos — el agregado conserva
  identidad/estado/trazabilidad y los movimientos IN/OUT referencian
  `reference_type = INVENTORY_TRANSFER, reference_id = InventoryTransfer.id`.
  `IMPLEMENTATION GAP`, no `HUMAN DECISION`.

### Operaciones

- **Ajuste**: implementación parcial ya existente coincide exactamente
  con `UC-INVENTORY-002` §"Ajustes de inventario" (motivo obligatorio,
  sin reescribir historial, `expected_version` correctamente omitido
  por ser hecho append-only). Único punto abierto ya documentado en el
  propio código: aprobación separada por monto/producto/riesgo —
  `DEFERRED`, sin umbral definido en ningún documento.
- **Merma**: sin caso de uso todavía. Motivos cerrados (`DAMAGED`,
  `EXPIRED`, `SPOILAGE`, `LOSS`, `BREAKAGE`, `QUALITY_REJECTION`,
  `OTHER_AUTHORIZED`) y autorización casi cerrada (ver Autorización).
  `IMPLEMENTATION GAP`, listo para B32.
- **Traslado**: sin caso de uso ni agregado todavía; el agregado ya
  quedó `CLOSED` arriba. `IMPLEMENTATION GAP`, listo para B32 salvo la
  autorización de `BRANCH_MANAGER`/`SUPERVISOR` (HD).
- **Recepción**: confirmado fuera de Inventory (pertenece a Purchasing/
  `PUR-001`/`PUR-002`). El contrato que Inventory debe exponer queda
  `CLOSED` por `inventory-receiving-schema.md`/`conceptual-data-model.md`:
  cada `GoodsReceiptLotAllocation` confirmada origina **exactamente un**
  `InventoryMovement` de entrada a través del propio puerto de registro
  de Inventory — Purchasing nunca inserta en `catalog`/`inventory` por
  fuera de ese contrato ni escribe `StockBalance` directamente. No se
  crea ningún tipo `GoodsReceipt*` en este bloque.
- **Reserva/Liberación/Consumo**: sin agregado ni caso de uso.
  `permission-matrix.md` no tiene fila propia para estas tres — no es
  una omisión: `UC-INVENTORY-002` define el actor principal como
  "usuario **o proceso autorizado**" con "módulo de ventas" como actor
  secundario, es decir, la autorización se hereda de la operación que
  la origina (confirmación de Sale u otro proceso autorizado), no de un
  permiso directo de usuario. `ARCHITECTURAL DECISION` (cerrada por
  evidencia textual), no `HUMAN DECISION`.

### Autorización — matriz real por operación (no una sola política)

| Operación | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | INVENTORY_OPERATOR | CASHIER |
|---|---|---|---|---|---|---|
| Ajuste (±) | Sí | Sí | Condicional | Autorizar | Condicional | No |
| Merma | Sí | Sí | Sí | Sí | Sí | Condicional |
| Traslado | Sí | Sí | Condicional | Autorizar | Sí | No |
| Recepción (Purchasing) | Sí | Sí | Sí | Sí | Sí | No |

Confirma el hallazgo de B30: son cuatro filas distintas, no una. Merma y
Recepción están **completamente cerradas** para sus roles "Sí"
(implementables sin decisión nueva); Ajuste y Traslado comparten el
mismo patrón sin definir para `BRANCH_MANAGER`("Condicional")/
`SUPERVISOR`("Autorizar") — mismo tratamiento de fail-closed que Catalog
usó para sus HD de autorización.

### Invariantes — hallazgo MAJOR nuevo

`UC-INVENTORY-002` regla 15/§"Salidas de inventario" regla 5: "No se
debe producir stock negativo salvo política explícita y autorizada."
Sin `InventoryPolicy` codificada, el default es denegar. **La
implementación actual de `RegisterInventoryAdjustmentUseCase` no valida
esto**: un `NEGATIVE_ADJUSTMENT` se persiste sin comprobar el on-hand
resultante contra `calculateOnHandQuantity`. No es una decisión humana
— la regla ya está cerrada por el documento — es un **gap de
implementación real, no cosmético**, a cerrar en B32 antes de dar por
completa la operación de Ajuste.

### CONTRADICTION — estados de InventoryReservation

`UC-INVENTORY-002:109-114` lista seis estados: `ACTIVE`,
`PARTIALLY_CONSUMED`, `CONSUMED`, `RELEASED`, `EXPIRED`, `CANCELLED`.
`conceptual-data-model.md:1539-1543` lista cinco, **omitiendo
`CANCELLED`**. Ninguna de las dos fuentes es más autoritativa por
convención de este proyecto — se registra como `CONTRADICTION` real
entre dos documentos normativos, no se elige una interpretación
arbitraria (regla general del propio backlog). Bloquea únicamente la
definición exacta del enum de estados de `InventoryReservation`, no el
resto del modelo.

### Human Decision Register (HD-INV)

| ID | Pregunta | Bloqueante |
|---|---|---|
| HD-INV-01 | ¿Qué combinación de `Product.lotControlled` + un campo de Presentation todavía inexistente + `InventoryPolicy` determina si un movimiento exige `lotId`? `inventory-schema.md` describe las tres fuentes combinadas sin definir la fórmula. | No bloquea Ajuste/Merma/Traslado base (aceptan `lotId` opcional); bloquea la validación estricta de lote obligatorio. |
| HD-INV-02 | Significado operacional de "Condicional" (`BRANCH_MANAGER`/`INVENTORY_OPERATOR`) y "Autorizar" (`SUPERVISOR`, workflow de dos fases sin agregado documentado) para Ajuste. | No bloquea — ya falla cerrado correctamente en `roleMayAdjustInventory`. |
| HD-INV-03 | Mismo patrón que HD-INV-02 pero para Traslado (`BRANCH_MANAGER` Condicional, `SUPERVISOR` Autorizar). | No bloquea la definición del agregado `InventoryTransfer`; bloquea únicamente habilitar esos dos roles para ejecutarlo. |
| HD-INV-04 | Significado de "Condicional" para `CASHIER` en Merma. | No bloquea — default seguro es fail-closed (CASHIER nunca autorizado hasta definir la condición). |
| HD-INV-05 | `ProductPresentation.stockMode = CONVERTED_TO_BASE`/`DERIVED`: ¿Inventory rastrea existencia directamente en esa `presentationId`, o la enruta a través de `UnitConversion` hacia otra presentación "base" rastreada? Catalog (B26 HD-08) deliberadamente no forzó ninguna relación `stock_controlled`↔`stock_mode` y dejó la pregunta abierta hacia quien consuma `stockMode` — ahora le corresponde a Inventory responderla. | Bloquea la validación de presentación contra `stockMode` en B32 para esos dos modos; no bloquea `INDEPENDENT` (rastreo directo) ni `NON_STOCK` (rechazo directo, ambos sin ambigüedad). |
| HD-INV-06 | Resolución de la `CONTRADICTION` de estados de `InventoryReservation` (`CANCELLED` presente en `UC-INVENTORY-002`, ausente en `conceptual-data-model.md`). | Bloquea definir el enum exacto de `InventoryReservationStatus` en B32. |

### Alcance de este bloque

`DDL: NO-GO`. `MIGRATIONS: NO-GO`. `ADAPTERS: NO-GO`. `SALES/PAYMENTS-REAL/
PURCHASING: NO-TOUCH`. Cero código modificado — solo lectura y este
delta. Un `MAJOR` real encontrado (stock negativo sin validar en
Ajuste, no una decisión sino una brecha de implementación ya exigida
por documento) y seis `HD-INV` registradas, ninguna resuelta por
inferencia. El siguiente bloque correcto es **B32 — Inventory Domain/
Application Design** (mismo patrón que B27): completar `InventoryMovement`
(guard de stock negativo, validación de presentación contra Catalog
real), materializar `StockBalance`/`InventoryReservation`/`Lot`/
`InventoryTransfer` como agregados de dominio con sus casos de uso
(Merma, Traslado, Reserva/Consumo/Liberación), y las políticas de
autorización por operación — todo sin persistencia, condicionado a que
el owner resuelva primero HD-INV-05 (stockMode↔tracking) y HD-INV-06
(estados de Reservation) antes de cerrar esos dos agregados
específicos; el resto de HD-INV no bloquea avanzar con fail-closed.

## Delta B32 — Inventory Domain/Application Design

`INVENTORY-B32-DESIGN = PASS_WITH_DEFERRED_DECISIONS`. Materializa
Domain + Application para Inventory sin persistencia — cero DDL,
migration, adapter, o cambio en Cash/Catalog/Payment/Sales/Purchasing.
Respeta la clasificación de B31: HD-INV-05 (stockMode CONVERTED_TO_BASE/
DERIVED) y HD-INV-06 (contradicción de estados de Reservation) quedan
aisladas sin resolverse por inferencia; HD-INV-01/02/03/04 (no
bloqueantes) fallan cerrado como ya recomendaba B31.

**Domain** (`packages/domain/src/inventory/`): `StockBalance` (nuevo,
`stock-balance.ts`) — valor puro computado por fold, NO un agregado
persistido con `expected_version` propio; deliberadamente no se
pre-compromete con la decisión de si B33 lo cachea como fila
versionada o lo sigue recalculando, misma postura que
`calculateExpectedCash` de Cash. `InventoryReservation` (nuevo) —
agregado mutable real con `expected_version`, ciclo `create`/`consume`/
`release`/`expire`; implementa únicamente los **cinco** estados en los
que `UC-INVENTORY-002` y `conceptual-data-model.md` coinciden
(`ACTIVE`/`PARTIALLY_CONSUMED`/`CONSUMED`/`RELEASED`/`EXPIRED`) — sin
`cancel()`, para no resolver HD-INV-06 por la vía de los hechos.
`InventoryTransfer` + `InventoryTransferLine` (nuevos) — agregado
propio con sus 7 estados (`REQUESTED`/`APPROVED`/`IN_TRANSIT`/
`RECEIVED`/`PARTIALLY_RECEIVED`/`CANCELLED`/`REJECTED`, sin
contradicción entre fuentes), confirmando la clasificación `CLOSED` de
B31: un traslado nunca se modela como dos `InventoryMovement` sueltos.
`Lot` (nuevo, mínimo) — solo `restore()`, sin `create()`: la creación de
lotes pertenece a `GoodsReceipt`/Purchasing (`PUR-001`), fuera de
alcance; Inventory lo modela como forma de referencia de solo lectura.
`InventoryMovement` extendido con `referenceType`/`referenceId`
opcionales (B32: `inventory-schema.md` los exige en toda fila, B27
original los había omitido por completo — gap real, cerrado ahora que
`RESERVATION_CONSUMPTION`/`TRANSFER_OUT`/`TRANSFER_IN` necesitan
enlazar de vuelta a la reserva/traslado que los originó). Renombrado
`InventoryAdjustmentRecorded` → `InventoryAdjusted` (MINOR de B30/B31,
cerrado: `event-catalog.md:151` es el nombre catalogado). Cinco eventos
nuevos, todos con nombre tomado literalmente de `event-catalog.md`, no
inventados: `InventoryLossRecorded` (merma), `InventoryReserved`,
`InventoryReservationReleased`, `InventoryDeducted` (consumo),
`InventoryTransferred` (recepción completa o parcial). Autorización:
`roleMayRegisterWaste`/`roleMayTransferInventory` (filas reales de
`permission-matrix.md`, distintas entre sí y de `roleMayAdjustInventory`
— confirma el hallazgo de B30/B31) y
`roleMayReserveInventory`/`roleMayConsumeInventoryReservation`/
`roleMayReleaseInventoryReservation` (fallan cerrado incondicionalmente
para los 7 roles — B31 `ARCHITECTURAL DECISION`: sin fila en la
matriz y sin actor `SYSTEM` legítimamente construible todavía).

**Application** (`packages/application/src/`): `validateInventoryPresentation`
(nuevo, `inventory/`) — cierra el gap que B25 encontró y B31 confirmó
seguía abierto: ningún caso de uso de Inventory validaba
`presentationId` contra el `ProductPresentationRepository` real de
Catalog. Rechaza presentación inexistente/inactiva, `NON_STOCK`
(`inventoryEnabled=false`, inequívoco) y — deliberadamente —
`CONVERTED_TO_BASE`/`DERIVED` (HD-INV-05 no resuelto: silenciosamente
soportar cualquiera de esos dos modos habría resuelto la decisión por
inferencia). Solo `INDEPENDENT` es soportado hoy. `RegisterInventoryAdjustmentUseCase`
modificado — MAJOR fix de B31: agrega el guard de stock no-negativo que
nunca existió (`UC-INVENTORY-002` ya lo exigía; con `NEGATIVE_ADJUSTMENT`
now rejected as `INSUFFICIENT_STOCK` cuando dejaría el on-hand negativo)
y la validación de presentación — reutiliza el mismo fold ya calculado,
sin llamada adicional al repository. `RegisterInventoryWasteUseCase`
(nuevo) — mismo patrón que Ajuste, motivos cerrados por tipo
(`DAMAGED`/`EXPIRED`/`SPOILAGE`/`LOSS`/`BREAKAGE`/`QUALITY_REJECTION`/
`OTHER_AUTHORIZED`), autorización propia. `ReserveInventoryUseCase`/
`ConsumeInventoryReservationUseCase`/`ReleaseInventoryReservationUseCase`
(nuevos) — `Reserve` calcula disponibilidad vía `StockBalance.compute`
sobre movimientos + reservas ya existentes (sin tercera fuente
persistida); `Consume` produce un `InventoryMovement` real
(`RESERVATION_CONSUMPTION`, referenciando la reserva) Y transiciona la
reserva, documentando explícitamente que ambas escrituras comparten una
transacción según `UC-INVENTORY-002` pero secuenciándolas sin adapter
real (B33 concern); `Release` no toca `InventoryMovement` — la
capacidad vuelve a estar disponible solo porque `StockBalance.compute`
deja de contarla. `RequestInventoryTransferUseCase`/
`DispatchInventoryTransferUseCase`/`ReceiveInventoryTransferUseCase`/
`CancelInventoryTransferUseCase` (nuevos) — ciclo completo
Request→Dispatch→Receive con `TRANSFER_OUT`/`TRANSFER_IN` reales por
línea; **Approve/Reject existen en el dominio pero no tienen caso de
uso propio** (alcance recortado explícitamente: los tres roles hoy
autorizados para Traslado son "Sí" incondicional, sin política que
exija el flujo de dos fases que HD-INV-03 deja indefinido para
`BRANCH_MANAGER`/`SUPERVISOR`); `Cancel` solo pre-dispatch, post-dispatch
queda fuera de alcance (requiere compensación explícita, no modelado).
`Receive` es una llamada terminal única — no soporta una segunda
recepción completando una línea `PARTIALLY_RECEIVED` de una llamada
previa (recorte de alcance documentado, no una decisión).

**Hallazgo real durante la implementación** (encontrado por test, no
supuesto): el primer diseño de `StockBalance.compute` filtraba reservas
por `status IN ('ACTIVE','PARTIALLY_CONSUMED')` para sumar lo
reservado — un bug real que habría dejado que una reserva `EXPIRED`
"liberara" capacidad silenciosamente, contradiciendo la propia regla 4
de `UC-INVENTORY-002` ("una reserva expirada debe liberarse mediante
transición explícita"). Corregido sumando `outstandingQuantity()` sobre
TODAS las reservas sin filtro de estado — la aritmética misma
(`quantity - consumed - released`) ya da cero para `RELEASED`/
`CONSUMED` y mantiene el valor correcto para `EXPIRED`. Detectado por
`stock-balance.test.ts`, no por inspección.

`DDL: NO-GO`. `MIGRATIONS: NO-GO`. `ADAPTERS: NO-GO`. `CASH/CATALOG/
PAYMENT/SALES/PURCHASING: NO-TOUCH`. Regresión completa limpia: Domain
299/299 (218 previos + 81 nuevos), Application 243/243 (203 previos +
40 nuevos), database-sqlite 48/48, database-postgres 26/26,
target-migrations 284/284, pos-local-service 45/45+2 skipped, contracts
60/60, observability 4/4 (los últimos siete sin cambios, cero impacto
fuera de Inventory), `pnpm -w typecheck` limpio en 8 proyectos,
`architecture-check` PASS sin caché. Decisiones humanas explícitamente
no resueltas: HD-INV-05 (stockMode↔tracking, bloquea
`CONVERTED_TO_BASE`/`DERIVED`), HD-INV-06 (estados de Reservation,
bloquea `cancel()`); HD-INV-01..04 siguen fail-closed sin resolver. El
siguiente bloque correcto es **B33 — Inventory Persistence (SQLite +
PostgreSQL)**, mismo patrón que cerró Catalog (B29): materializar los
puertos ya definidos aquí (`InventoryReservationRepository`,
`InventoryTransferRepository`, extensión de `InventoryMovementRepository`
si aplica) sobre ambos motores con evidencia real de transacciones,
rollback, concurrencia e idempotencia — sin resolver HD-INV-05/06 en el
camino.
