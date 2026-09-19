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
| Clientes y crédito | `DEFERRED` | `DEC-005` está **ratificada** desde 2026-09-19: el crédito cubre la venta y la obligación vive en un agregado separado. `CUST-001` está materializado en su parte de alta y consulta —tabla, almacén, dos casos de uso y tres operaciones de canal—; `CUST-002` permanece `PLANNED` y es lo único que sigue difiriendo el crédito físico. |
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
