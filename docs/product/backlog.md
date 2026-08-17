# Backlog maestro

## Propósito y autoridad

Este archivo es la fuente de verdad del trabajo del proyecto. Consolida el estado, la prioridad, las dependencias, la evidencia y las decisiones que gobiernan el paso desde la base avícola existente hacia POS Platform.

Si otro documento de avance, una conversación o una lista informal contradice este backlog, prevalece este archivo hasta que se actualice mediante el flujo oficial.

Última actualización: 2026-08-17.

## Estado general

- Rama de trabajo verificada: `architecture/physical-model`.
- Estado inicial del árbol al crear este backlog: limpio.
- Etapa actual: transición hacia la fundación técnica ejecutable y el diseño del modelo físico objetivo.
- Fase 0: `DONE`.
- Último hito completado: cierre documental de la Fase 0, incluida la consolidación de `SYNC-001`, `SYNC-002` y `SYNC-003`.
- Último baseline ejecutable completado: migration 001 materializada en `255d813`, con PostgreSQL `54/54`, SQLite `12/12`, combined `66/66`, RLS `10/10` y real-role smoke `22/22`. Migration 001 es inmutable.
- Último contrato completado: `INT-001`, contrato físico general de External Integrations y reconciliación con `FiscalConnection`. No implementa adapters ni verifica providers. `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.
- Los ciclos de pagos, caja y ventas, la canalización versionada de pricing y las decisiones críticas `P0` de Fase 0 quedaron documentados y cerrados.
- La base FastAPI, SQLAlchemy, Alembic, PostgreSQL y frontend HTML existente es una línea base para auditar y migrar; no demuestra que la arquitectura objetivo multiempresa, local-first o modular ya esté implementada. Evidencia: `backend/`, `frontend/`, `database/`, `infra/` y `docs/migration/avicola-baseline-migration.md`.
- La fundación documental del producto, arquitectura, dominio, seguridad, UX y pruebas sí existe. Su evidencia se detalla abajo.
- `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md` consolidan formalmente los estados, proyecciones, eventos y flujos operativos del dominio de pagos. `PAY-007` está `DONE`.

## Flujo de trabajo oficial

El flujo normal es:

`PLANNED -> READY -> IN_PROGRESS -> DONE`

1. Seleccionar el elemento de mayor prioridad en `READY` cuyas dependencias estén `DONE` o hayan sido resueltas explícitamente.
2. Confirmar alcance, criterios de aceptación, evidencia esperada y archivos permitidos antes de iniciarlo.
3. Cambiarlo a `IN_PROGRESS` cuando comience el trabajo. Solo debe existir un siguiente trabajo principal `IN_PROGRESS`, salvo que el backlog documente una excepción.
4. Implementar o documentar el alcance sin incorporar trabajo no relacionado.
5. Ejecutar las validaciones proporcionales al cambio y registrar rutas reales como evidencia.
6. Moverlo a `DONE` solo cuando el artefacto exista, cumpla sus criterios y tenga evidencia verificable en el repositorio.
7. Si aparece un impedimento, moverlo a `BLOCKED`, registrar causa, responsable de resolución y condición de desbloqueo. Al resolverlo vuelve a `READY` o `IN_PROGRESS`.
8. Los cambios de alcance se deciden de forma explícita: `DEFERRED` conserva la intención para otra fase y `OUT_OF_SCOPE` la excluye del producto o hito vigente.

Ningún elemento se considera terminado por existir parcialmente en la base heredada, por aparecer en una maqueta o por estar mencionado en un documento conceptual.

## Estados

| Estado | Significado |
|---|---|
| `DONE` | Cumple el alcance y los criterios definidos; existe evidencia verificable mediante rutas reales. |
| `IN_PROGRESS` | Trabajo activo y delimitado. |
| `READY` | Alcance y dependencias suficientes para comenzar de inmediato. |
| `BLOCKED` | No puede avanzar por un impedimento explícito; debe indicarse cómo se desbloquea. |
| `PLANNED` | Trabajo aceptado, aún no preparado o no habilitado por sus dependencias. |
| `DEFERRED` | Trabajo válido aplazado a una fase posterior. |
| `OUT_OF_SCOPE` | Excluido deliberadamente del alcance vigente; reincorporarlo exige una decisión. |

## Prioridades

| Prioridad | Criterio |
|---|---|
| `P0` | Bloquea la fundación, integridad, seguridad o siguiente hito; se atiende primero. |
| `P1` | Necesario para completar el núcleo comercial de la fase. |
La prioridad no reemplaza las dependencias: un `P0` bloqueado no autoriza saltarse una decisión o invariante pendiente.

## Evidencia terminada de Fase 0

Estos elementos están `DONE` únicamente como definiciones documentales. No implican implementación productiva.

| Elemento | Estado | Evidencia |
|---|---|---|
| Visión, alcance, tipos de comercio, roles y RNF | `DONE` | `docs/product/vision.md`, `docs/product/scope.md`, `docs/product/business-types.md`, `docs/product/roles.md`, `docs/product/non-functional-requirements.md` |
| Contexto, módulos, tenancy, seguridad, despliegue y propiedad de datos | `DONE` | `docs/architecture/system-context.md`, `docs/architecture/module-map.md`, `docs/architecture/tenant-model.md`, `docs/architecture/security-model.md`, `docs/architecture/deployment-modes.md`, `docs/architecture/data-ownership.md` |
| Decisiones arquitectónicas iniciales | `DONE` | `docs/adr/ADR-001-modular-monolith.md`, `docs/adr/ADR-002-monorepo.md`, `docs/adr/ADR-003-local-first.md`, `docs/adr/ADR-004-single-codebase.md` |
| Modelo conceptual, reglas, glosario, eventos y motor comercial | `DONE` | `docs/architecture/conceptual-data-model.md`, `docs/domain/business-rules.md`, `docs/domain/glossary.md`, `docs/domain/event-catalog.md`, `docs/domain/commercial-engine.md` |
| Modelo de roles y autorización de producto | `DONE` | `docs/security/permission-matrix.md`, `docs/product/roles.md` |
| Estrategia de pruebas y migración de la base | `DONE` | `docs/testing/testing-strategy.md`, `docs/migration/avicola-baseline-migration.md` |
| Principios de navegación y decisiones UX iniciales | `DONE` | `docs/design/role-based-navigation.md`, `docs/ux-research/design-decisions.md` |
| Login, caja, inventario, licencias y venta: definición inicial | `DONE` | `docs/use-cases/auth/UC-AUTH-001-login.md`, `docs/use-cases/cash/UC-CASH-001-open-register.md`, `docs/use-cases/cash/UC-CASH-002-close-register.md`, `docs/use-cases/inventory/UC-INVENTORY-001-receive-stock.md`, `docs/use-cases/licensing/UC-LIC-001-validate-license.md`, `docs/use-cases/sales/UC-SALES-001-complete-sale.md` |
| Catálogo: seis casos de uso definidos | `DONE` | `docs/use-cases/catalog/UC-CAT-001-create-product.md`, `docs/use-cases/catalog/UC-CAT-002-update-product.md`, `docs/use-cases/catalog/UC-CAT-003-assign-identifier.md`, `docs/use-cases/catalog/UC-CAT-004-create-variant.md`, `docs/use-cases/catalog/UC-CAT-005-create-presentation.md`, `docs/use-cases/catalog/UC-CAT-006-convert-presentation.md` |
| Precios, promociones, impuestos y redondeo: definición inicial | `DONE` | `docs/use-cases/pricing/UC-PRICE-001-schedule-price.md`, `docs/use-cases/pricing/UC-PRICE-002-resolve-sale-price.md`, `docs/use-cases/promotions/UC-PROMO-001-create-promotion.md`, `docs/use-cases/promotions/UC-PROMO-002-apply-promotion.md`, `docs/use-cases/tax/UC-TAX-001-resolve-tax.md`, `docs/use-cases/tax/UC-TAX-002-handle-tax-change.md`, `docs/use-cases/rounding/UC-ROUND-001-calculate-payable-total.md` |
| Ciclo de pagos y casos UC-PAY-001, 002, 003 y 006 | `DONE` | `docs/domain/payment-lifecycle.md`, `docs/use-cases/payments/UC-PAY-001-register-payment.md`, `docs/use-cases/payments/UC-PAY-002-register-mixed-payment.md`, `docs/use-cases/payments/UC-PAY-003-confirm-manual-transfer.md`, `docs/use-cases/payments/UC-PAY-006-handle-pending-payment.md` |
| Backlog maestro creado | `DONE` | `docs/product/backlog.md` |

## Backlog por épica

### Arquitectura

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| ARCH-001 | `P0` | `DONE` | Definir monolito modular, monorepo, local-first y base de código única. | `docs/adr/ADR-001-modular-monolith.md` a `docs/adr/ADR-004-single-codebase.md` |
| ARCH-002 | `P0` | `DONE` | Definir contexto, mapa modular, tenancy, despliegue y propiedad de datos. | `docs/architecture/` |
| ARCH-003 | `P0` | `PLANNED` | Convertir límites conceptuales en contratos de módulos y reglas de dependencia ejecutables. | Fase 1; depende de TECH-002. |
| ARCH-004 | `P0` | `DONE` | Definir contratos de integración entre renderer, Electron, POS local, API central, hardware y proveedores externos. | Cerrado en `docs/architecture/integration-contracts.md`; materialización pendiente en `TECH-003` y adaptadores. |
| ARCH-005 | `P0` | `DONE` | Cerrar el stack tecnológico objetivo y su política de dependencias, persistencia, pruebas y portabilidad. | `docs/adr/ADR-005-target-technology-stack.md`. |

### Seguridad

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| SEC-001 | `P0` | `DONE` | Definir modelo de seguridad, roles y matriz de permisos. | `docs/architecture/security-model.md`, `docs/product/roles.md`, `docs/security/permission-matrix.md` |
| SEC-002 | `P0` | `DONE` | Definir permisos atómicos, políticas ABAC y pruebas negativas por módulo. | Cerrado en `docs/security/permission-matrix.md` con permisos atómicos, políticas ABAC, segregación de funciones, pruebas negativas y contrato estructurado de decisión de autorización. |
| SEC-003 | `P0` | `PLANNED` | Implementar aislamiento de tenant, sesiones revocables, MFA y reautenticación. | Fase 1; depende de ONB-002 y DEV-001. |
| SEC-004 | `P0` | `DONE` | Definir gestión de secretos, claves, credenciales fiscales, firma de licencias/actualizaciones y acceso temporal de soporte. | Cerrado en `docs/security/secret-key-and-support-management.md`; selección de proveedores y PoC de protección local se validan antes del piloto. |

#### Gates verificables de seguridad de Fase 1

El contrato de los gates está definido en `docs/security/security-gates.md`, pero ninguno tiene todavía implementación ni evidencia ejecutable del stack objetivo. Por eso todos permanecen `PLANNED`; este estado no contradice los elementos documentales `SEC-001`, `SEC-002` y `SEC-004` ya cerrados.

| ID | Prioridad | Estado | Gate | Dependencias / criterio futuro |
|---|---|---|---|---|
| SEC-G01 | `P0` | `PLANNED` | Tenant Isolation | `SEC-003`, tenant model y `PHY-G14`; exige pruebas cross-tenant reales, constraints y RLS aplicable. |
| SEC-G02 | `P0` | `PLANNED` | Authentication & Session Security | `UC-AUTH-001`, Identity y Devices; exige expiración, rotación, revocación, MFA, reautenticación, bloqueo y recuperación. |
| SEC-G03 | `P0` | `PLANNED` | Authorization / RBAC / ABAC | `SEC-001`, `SEC-002`, `SEC-G01/02`; exige deny by default y pruebas backend de scopes, límites y segregación. |
| SEC-G04 | `P0` | `PLANNED` | Device Trust & License Enforcement | `DEC-008`, Devices y Licensing; exige evidencia criptográfica, activación/revocación, tiempo, gracia y reemplazo. |
| SEC-G05 | `P0` | `PLANNED` | Local-first Integrity & Replay Protection | `DEC-007`, `DEC-008`, Sync y schemas local/central; exige outbox/inbox, replay, orden, conflictos y recovery. |
| SEC-G06 | `P0` | `PLANNED` | Audit & Anti-Fraud | Audit y gates anteriores; exige append-only, atribución y reglas deterministas antifraude. |
| SEC-G07 | `P0` | `PLANNED` | Secrets & Cryptography | `SEC-004`, `DEC-008`, `DEC-009`; exige scanning, aislamiento, rotación, revocación, cifrado y redacción. |
| SEC-G08 | `P0` | `PLANNED` | API / Webhook / Input Security | `ARCH-004`, `TECH-003`, autenticación y adaptadores; exige pruebas de input, BOLA/IDOR, web y webhook. |
| SEC-G09 | `P0` | `PLANNED` | Infrastructure / Supply Chain / Backup & Recovery | `ADR-005`, `DEC-009/010`, `TECH-004/005`; exige hardening, SBOM/scanning, restore, DR, update y rollback. |
| SEC-G10 | `P0` | `PLANNED` | Security Release Gate | `SEC-G01` a `SEC-G09`; bloquea producción sin evidencia completa o con vulnerabilidad crítica no tratada. |

### Catálogo

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| CAT-001 | `P0` | `DONE` | Definir producto, actualización, identificadores, variantes, presentaciones y conversiones. | `docs/use-cases/catalog/` |
| CAT-002 | `P1` | `READY` | Alinear el modelo conceptual de variante/presentación y diseñar persistencia física. | `DEC-004` cerrada mediante `docs/adr/DEC-004-product-variant-presentation-model.md`; documentación conceptual, glosario, motor comercial y catálogo de eventos alineados. |
| CAT-003 | `P1` | `PLANNED` | Implementar catálogo multiempresa con unidades, códigos y snapshots. | Fase 1; depende de ARCH-003 y SEC-003. |
| CAT-004 | `P3` | `DEFERRED` | Especializaciones regulatorias de droguería. | Fase especializada según `docs/product/business-types.md`. |

### Precios

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| PRICE-001 | `P0` | `DONE` | Definir programación y resolución determinista de precios. | `docs/use-cases/pricing/UC-PRICE-001-schedule-price.md`, `docs/use-cases/pricing/UC-PRICE-002-resolve-sale-price.md` |
| PRICE-002 | `P0` | `DONE` | Cerrar el orden definitivo entre precio base, precio promocional, descuentos e impuestos. | Cerrado mediante `DEC-003`, `DEC-006` y `UC-PRICE-002`; resolución determinista de precio base y precio promocional alineada con `PRICING_PIPELINE_V1`, decimal exacto, snapshots versionados, operación offline controlada y pruebas de determinismo. |
| PRICE-003 | `P1` | `PLANNED` | Implementar precios versionados, vigencias, caché y snapshots offline. | Depende de CAT-003 y SYNC-002. |

### Promociones

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| PROMO-001 | `P0` | `DONE` | Definir creación, vigencia, combinación y aplicación de promociones. | `docs/use-cases/promotions/UC-PROMO-001-create-promotion.md`, `docs/use-cases/promotions/UC-PROMO-002-apply-promotion.md` |
| PROMO-002 | `P1` | `PLANNED` | Diseñar persistencia de reglas y contadores idempotentes. | Depende de PRICE-002. |
| PROMO-003 | `P1` | `PLANNED` | Implementar motor determinista, explicable y probado. | Depende de PROMO-002 y TAX-002. |

### Impuestos

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| TAX-001 | `P0` | `DONE` | Definir resolución y cambios tributarios versionados. | `docs/use-cases/tax/UC-TAX-001-resolve-tax.md`, `docs/use-cases/tax/UC-TAX-002-handle-tax-change.md` |
| TAX-002 | `P0` | `DONE` | Definir redondeo del total pagadero para COP. | `docs/use-cases/rounding/UC-ROUND-001-calculate-payable-total.md` |
| TAX-003 | `P0` | `DONE` | Resolver empate de redondeo y conciliación fiscal. | Cerrado mediante `DEC-003`, `DEC-006`, `UC-TAX-001` y `UC-ROUND-001`; quedan formalizadas precisión fiscal, normalización por impuesto, distribución determinista de residuos, persistencia de ajustes, conciliación documental, separación fiscal/comercial, `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` y `payable_amount` independiente del medio de pago. |
| TAX-004 | `P1` | `PLANNED` | Implementar documentos electrónicos mediante puertos neutrales y perfiles fiscales asociados a `ExternalIntegration`. | Contratos cerrados; adapters SIIGO/FACTUS/ALEGRA, seguridad, evidencia autorizada y validación normativa permanecen pendientes. |
| UC-EINV-001 | `P1` | `DONE` | Definir configuración, emisión, resultado incierto, conciliación, notas, contingencia y operación sin proveedor fiscal. | `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md` y `docs/architecture/electronic-invoicing.md`. |

### Integraciones externas

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| INT-001 | `P0` | `DONE` | Cerrar contrato físico general provider-agnostic, mappings, ownership, discovery, secrets, dispatch, webhook, rate limit y evidencia; reconciliar `FiscalConnection`. | `docs/architecture/physical-model/external-integrations-schema.md`, `docs/architecture/provider-integration-matrix.md`; documental, sin SQL/adapters |
| INT-002 | `P0` | `READY` | Diseñar manifest aditivo de migration 002 central exclusivamente para External Integrations foundation, con dispatch físicamente limitado a `NON_FISCAL`, orden, constraints, RLS, grants, recovery y pruebas exactas. | Depende de INT-001 y de la decisión de split 002/003; migration 001 permanece inmutable; no incluye tablas fiscales ni SQL en la fase de manifest |
| INT-003 | `P0` | `PLANNED` | Implementar foundation central de integraciones conforme al manifest aprobado, sin adapters provider todavía. | Depende de INT-002 y autorización independiente de migration 002 |
| INT-004 | `P1` | `PLANNED` | Implementar y verificar adapters SIIGO, FACTUS y ALEGRA con credenciales/ambientes autorizados. | Depende de INT-003, INT-006/migration 003, TECH-003 y gates SEC aplicables; mocks no cuentan como integración real |
| INT-005 | `P2` | `PLANNED` | Evaluar HKA y Odoo sin crear adapters ficticios. | Requiere contrato oficial vigente, caso de uso y evidencia autorizada |
| INT-006 | `P0` | `PLANNED` | Diseñar y materializar, mediante autorizaciones separadas, migration 003 Fiscal/Electronic Invoicing foundation; habilitar `IntegrationDispatch.FISCAL` únicamente junto con `FiscalSubmissionAttempt` y su FK discriminada. | Depende de migration 002 aplicada; su manifest futuro deriva de PHY-G12/INT-001 y debe resolver todas las dependencias fiscales antes de SQL |

### Pagos

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| PAY-000 | `P0` | `DONE` | Definir ciclo de vida, estados, transiciones, offline y conciliación conceptual. | `docs/domain/payment-lifecycle.md` |
| UC-PAY-001 | `P0` | `DONE` | Registrar pago individual. | `docs/use-cases/payments/UC-PAY-001-register-payment.md` |
| UC-PAY-002 | `P0` | `DONE` | Registrar pago mixto y fallo parcial. | `docs/use-cases/payments/UC-PAY-002-register-mixed-payment.md` |
| UC-PAY-003 | `P0` | `DONE` | Confirmar transferencia manual o QR estático. | `docs/use-cases/payments/UC-PAY-003-confirm-manual-transfer.md` |
| PAY-008 | `P1` | `PLANNED` | Diseñar persistencia física, restricciones de unicidad y registro de referencias externas. | Depende de PAY-007 y TECH-002. |
| PAY-009 | `P1` | `PLANNED` | Implementar pagos y pruebas de concurrencia, idempotencia, permisos y recuperación. | Fase 1; depende de PAY-008, CASH-003 y SALES-003. |

| UC-PAY-004 | `P0` | `DONE` | Definir devolución y reversión de un pago confirmado, incluidos parciales, compensaciones, caja, proveedor, idempotencia y offline. | `docs/use-cases/payments/UC-PAY-004-refund-payment.md` |
| UC-PAY-005 | `P0` | `DONE` | Definir liquidación y conciliación de pagos contra caja, extractos y proveedores. | `docs/use-cases/payments/UC-PAY-005-reconcile-payment.md` |
| PAY-007 | `P0` | `DONE` | Consolidar la máquina de estados de pagos y separar los ejes de Payment, Refund, Reversal, Settlement, Reconciliation y Chargeback. | `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`. |

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| CASH-001 | `P0` | `DONE` | Definir apertura de turno. | `docs/use-cases/cash/UC-CASH-001-open-register.md` |
| CASH-002 | `P0` | `DONE` | Definir cierre y diferencia de turno. | `docs/use-cases/cash/UC-CASH-002-close-register.md` |
| CASH-003 | `P0` | `DONE` | Completar casos de movimientos, retiros, arqueos, devoluciones, compensaciones y recaudo de domiciliarios. | `docs/use-cases/cash/UC-CASH-003-cash-operations.md`. |
| CASH-004 | `P1` | `PLANNED` | Implementar caja por terminal y turno con historial inmutable. | Fase 1; depende de CASH-003 y DEV-002. |

### Ventas

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| SALES-001 | `P0` | `DONE` | Definir confirmación atómica e idempotente de venta. | `docs/use-cases/sales/UC-SALES-001-complete-sale.md` |
| SALES-002 | `P0` | `DONE` | Definir suspensión, recuperación, anulación, devolución y reimpresión. | `docs/use-cases/sales/UC-SALES-002-manage-sale-lifecycle.md`. |
| SALES-003 | `P1` | `PLANNED` | Implementar canalización comercial versionada y snapshots completos. | Depende de CAT-003, PRICE-003, PROMO-003, TAX-003, PAY-008 e INV-003. |

### Compras

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| PUR-001 | `P1` | `PLANNED` | Definir PurchaseOrder, líneas, aprobación configurable, cumplimiento parcial, cierre/cancelación y devolución a proveedor. | GoodsReceipt independiente está definido en `UC-INVENTORY-001`; PurchaseOrder y SupplierReturn permanecen diferidos. |
| PUR-002 | `P1` | `PLANNED` | Implementar capacidades comerciales separando GoodsReceipt, SupplierDocument y futuras obligaciones/pagos a proveedor. | Depende de PUR-001 e INV-003; no reutiliza Payment de cobros ni el pipeline tributario de ventas. |

### Inventario

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| INV-001 | `P0` | `DONE` | Definir recepción de mercancía. | `docs/use-cases/inventory/UC-INVENTORY-001-receive-stock.md` |
| INV-002 | `P0` | `DONE` | Definir reservas, salidas, ajustes, mermas, traslados, lotes, vencimientos y concurrencia. | Cerrado mediante `UC-INVENTORY-002`; contrato operativo alineado con modelo conceptual, reglas de negocio, glosario y matriz de permisos, incluyendo reservas, salidas, ajustes, mermas, traslados, lotes, vencimientos, concurrencia, operación offline, conflictos y compensaciones. |
| INV-003 | `P1` | `PLANNED` | Implementar movimientos como fuente de verdad y saldos como proyección. | Depende de CAT-003 e INV-002. |

### Clientes

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| CUST-001 | `P1` | `PLANNED` | Definir alta, edición, búsqueda, direcciones, privacidad y aislamiento de clientes. | Conceptos en `docs/architecture/conceptual-data-model.md`; no existe caso de uso dedicado. |
| CUST-002 | `P1` | `PLANNED` | Definir cuenta, cupo, mora y abonos de crédito. | Depende de CUST-001 y PAY-007. |
| CUST-003 | `P2` | `PLANNED` | Implementar clientes y crédito auditable. | Fase 1; depende de CUST-002 y SEC-003. |

### Domicilios

Estado de la épica: `DEFERRED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| DEL-001 | `P3` | `DEFERRED` | Definir pedido, preparación, reserva, asignación, recaudo, PIN e incidencias. | Arquitectura contemplada en `docs/architecture/conceptual-data-model.md`; fase posterior según `docs/product/scope.md`. |
| DEL-002 | `P3` | `DEFERRED` | Aplicación del domiciliario y seguimiento GPS limitado a operaciones autorizadas. | Depende de DEL-001, SEC-003 y SYNC-003. |
| DEL-003 | `P3` | `OUT_OF_SCOPE` | Incluir domicilios en el primer núcleo de Fase 1. | Excluido del alcance inicial por `docs/product/scope.md`; la capacidad permanece prevista para una fase posterior. |

### Onboarding

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| ONB-001 | `P0` | `DONE` | Definir creación de tenant, empresa, primera sucursal, propietario y configuración inicial. | Cerrado mediante `UC-ONB-001`; contrato funcional de onboarding consolidado con `User` global, `TenantMembership`, `UserRoleAssignment`, tenant, empresa, sucursal, propietario, configuración inicial, integración con licencias, auditoría e idempotencia. |
| ONB-002 | `P0` | `PLANNED` | Diseñar bootstrap transaccional, idempotente y auditable. | Depende de ONB-001 y TECH-002. |
| ONB-003 | `P2` | `PLANNED` | Definir importación masiva y migración asistida de datos. | Depende de CAT-003, CUST-003 y PUR-002. |

### Licencias

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| LIC-001 | `P0` | `DONE` | Definir validación de licencia híbrida y local perpetua. | `docs/use-cases/licensing/UC-LIC-001-validate-license.md` |
| LIC-002 | `P0` | `DONE` | Consolidar emisión, firma, activación, renovación, gracia, suspensión y reactivación a partir de `DEC-008` y `UC-LIC-001`. | Cerrado mediante `UC-LIC-002`; ciclo de vida contractual-operativo consolidado y alineado con modelo conceptual, reglas de negocio, glosario, `UC-LIC-001` y `DEC-008`. |
| LIC-003 | `P1` | `PLANNED` | Implementar derechos por módulos, límites y dispositivos sin pérdida de datos. | Fase 1; depende de LIC-002 y DEV-002. |

### Dispositivos

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| DEV-001 | `P0` | `DONE` | Definir registro, aprobación, vínculo, operación conectada/offline, heartbeat, estado operativo, revocación, recuperación, reinstalación, reemplazo, desactivación, administración del activo y alertas de dispositivo. | Cerrado mediante `UC-DEV-001`, con alineación en modelo conceptual, reglas de negocio y glosario; compatible con `DEC-007` y `DEC-008`. |
| DEV-002 | `P0` | `DONE` | Consolidar identidad segura del POS y contrato operativo con licencias. | Cerrado mediante `UC-DEV-002`; contrato dispositivo ↔ instalación ↔ clave ↔ activación ↔ licencia consolidado, con validación conectada/offline, decisión efectiva, códigos estables, auditoría y compatibilidad con `UC-DEV-001`, `UC-LIC-001`, `UC-LIC-002`, `DEC-007` y `DEC-008`. |
| DEV-003 | `P1` | `PLANNED` | Implementar simuladores y adaptadores de lector, impresora, cajón y balanza dentro del POS Local Service. | `ARCH-004` cerrado y matriz creada en `docs/hardware/support-matrix.md`; certificación bloqueada hasta seleccionar y probar equipos físicos. |

### Sincronización

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| SYNC-001 | `P0` | `DONE` | Definir identidad global, outbox, idempotencia, orden y contrato de sincronización. | Cerrado mediante `UC-SYNC-001`, alineado con `ADR-003`, `DEC-007` y el modelo conceptual; incluye identidad global, atomicidad negocio+outbox, inbox persistente, idempotencia, checksum, control de versión, causalidad, autoridad por dominio, checkpoint, recuperación, aislamiento multi-tenant y reloj no autoritativo. |
| SYNC-002 | `P0` | `DONE` | Definir versiones de configuración y disponibilidad offline por módulo. | Cerrado mediante `UC-SYNC-002`; se formalizó versionado por dominio, referencias nativas de versión, checksum, schema version, vigencia, estados `CURRENT`/`STALE`/`EXPIRED`/`INCOMPATIBLE`/`REVOKED`, disponibilidad offline derivada y contextual, actualización atómica, reconexión y conservación de snapshots históricos. |
| SYNC-003 | `P0` | `DONE` | Definir conflictos, reintentos, recuperación, reloj incorrecto y observabilidad. | Cerrado mediante `UC-SYNC-003`; se consolidaron conflictos explícitos, retries idempotentes, backoff exponencial con jitter, checkpoints, recuperación tras reinicio, reloj no autoritativo, revisión manual, dead letter y observabilidad alineada con `DEC-007` y el modelo conceptual. |
| SYNC-004 | `P1` | `PLANNED` | Implementar y probar venta offline sin duplicación ni pérdida. | Fase 1; depende de SALES-003, PAY-009 y SYNC-003. |

### Reportes

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| REP-001 | `P1` | `PLANNED` | Definir reportes operativos, financieros, inventario, caja y auditoría por rol. | Alcance conceptual en `docs/product/scope.md` y `docs/security/permission-matrix.md`. |
| REP-002 | `P2` | `PLANNED` | Diseñar proyecciones y procesamiento asíncrono sin convertir Reporting en fuente de verdad. | Depende de ARCH-003 y catálogo de eventos. |
| REP-003 | `P2` | `PLANNED` | Implementar exportación autorizada, privacidad y métricas de rendimiento. | Depende de REP-002 y SEC-003. |

### UX

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| UX-001 | `P1` | `DONE` | Definir navegación inicial por rol y decisiones de interacción. | `docs/design/role-based-navigation.md`, `docs/ux-research/design-decisions.md` |
| UX-002 | `P1` | `PLANNED` | Definir flujos y estados de POS para venta, pago pendiente, error, offline y hardware. | Depende de PAY-007, SALES-002 y DEV-003. |
| UX-003 | `P1` | `PLANNED` | Crear sistema de diseño accesible y matriz de resoluciones/touch. | Debe cumplir RNF UX y WCAG 2.2 AA definidos en `docs/product/non-functional-requirements.md`. |
| UX-004 | `P2` | `PLANNED` | Validar por rol y tipos de comercio prioritarios con pruebas de usabilidad. | Depende de UX-002 y UX-003. |

### Diseño técnico

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| TECH-001 | `P0` | `DONE` | Definir modelo conceptual y propiedad de datos. | `docs/architecture/conceptual-data-model.md`, `docs/architecture/data-ownership.md` |
| TECH-002 | `P0` | `DONE` | Diseñar modelo físico nuevo, migraciones objetivo separadas ejecutadas con Kysely sin metadata paralela, restricciones, índices y fronteras de transacción. | R1/R2-A/R2-B/R3/R4/R5 y revisión final `PASS`; migration 001 fue materializada en `255d813` y es inmutable. Device-Licensing/Catalog siguen `IN_REVIEW`. |
| TECH-003 | `P0` | `PLANNED` | Materializar schemas Zod, contratos API/IPC, errores, idempotency keys, versionado y correlación. | Contrato base cerrado en `ARCH-004`; depende del primer diseño físico de `TECH-002`. |
| TECH-004 | `P0` | `PLANNED` | Crear pipeline CI con pnpm/Nx, lint, tipos, pruebas, seguridad, licencias y validación de migraciones. | Requisitos en `ADR-005` y `docs/testing/testing-strategy.md`; no hay pipeline objetivo implementado. |
| TECH-005 | `P1` | `PLANNED` | Implementar observabilidad, backups, restauración, actualización y rollback por modalidad. | Política cerrada en `DEC-009`, `DEC-010` y `SEC-004`; valores SLA y hardware comercial requieren benchmark. |
| TECH-006 | `P1` | `PLANNED` | Establecer datos de prueba, fixtures multi-tenant y pruebas de concurrencia/recuperación. | Depende de TECH-002 y TECH-004. |

## Orden inmediato de trabajo

1. Reiniciar `INT-002` y diseñar únicamente el manifest aditivo de migration 002 External Integrations, central y `NON_FISCAL`, sin modificar migration 001 ni escribir SQL.
2. Después de materializar 002 bajo autorización separada, diseñar migration 003 Fiscal/Electronic Invoicing y habilitar `FISCAL` solo junto con el owner `FiscalSubmissionAttempt`.
3. Implementar adapters/runtime y obtener evidencia real únicamente después de 003 y de los gates técnicos aplicables.
4. Iniciar `TECH-003` de forma coordinada con el primer corte físico que consuma contratos API/IPC.
5. Mantener `DEC-005` como decisión `P1` diferida hasta abordar crédito offline; no bloquea el contrato de integraciones.

El trabajo producido durante `TECH-002` conserva validez documental. `PHY-G12` cerró agregados fiscales neutrales sin implementar código ni autorizar migraciones. Los puntos 1–4 siguientes son el registro histórico que llevó a la autorización y materialización de migration 001; no son pasos pendientes ni autorizan editarla:

1. consolidar la matriz física de motores y dialectos, UUID, tipos monetarios, alcances de unicidad, tablas de identidad/RBAC/sesión, fronteras transaccionales y auditoría;
2. verificar cada decisión contra inventario por presentación y lote, `PaymentGroup`/`Payment`/`PaymentAttempt`, estados persistentes de `Sale`, redondeo único y configuración offline por dominio;
3. aprobar el esquema y las diferencias PostgreSQL/SQLite mediante revisión transversal;
4. solo entonces escribir y validar la primera migración objetivo, sin modificar la migración heredada.
La implementación posterior debe respetar esos invariantes.

## Riesgos abiertos

| ID | Severidad | Riesgo | Mitigación / condición de cierre |
|---|---|---|---|
| R-001 | Alta | Confundir la base avícola existente con la arquitectura objetivo puede perpetuar acceso global, lógica acoplada y modelo monoempresa. | Migrar caso por caso según `docs/migration/avicola-baseline-migration.md`; no declarar módulos objetivo `DONE` por la existencia del código heredado. |
| R-002 | Baja | Riesgo residual de que la implementación física vuelva a mezclar estados persistentes, proyecciones y estados de agregados diferentes. | DEC-001 cerrado mediante `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`; validar el modelo físico y las migraciones contra estos documentos durante `TECH-002`. |
| R-003 | Alta | Pagos mixtos con proveedores externos no tienen atomicidad distribuida y pueden producir doble cobro o compensaciones pendientes. | Estados explícitos, idempotencia, incidencias y pruebas de respuestas tardías. |
| R-004 | Alta | El aislamiento multi-tenant está definido pero no probado en la base objetivo. | SEC-003 y pruebas negativas obligatorias antes de datos reales. |
| R-005 | Alta | El contrato local-first está documentado, pero todavía no existe una implementación probada de sincronización. | Implementar `SYNC-004` sobre los contratos `SYNC-001`, `SYNC-002` y `SYNC-003`, con pruebas de duplicados, orden, recuperación y reloj incorrecto. |
| R-006 | Alta | El modelo físico objetivo sigue incompleto; reintroducir una compra genérica o transformar el legado en órdenes/facturas inexistentes fijaría errores de dominio. | Mantener el contrato cerrado de `PHY-G06`, completar los gates restantes de `TECH-002` y crear migraciones solo después de una autorización documental independiente. |
| R-007 | Media | La canalización versionada de pricing está definida, pero todavía no tiene una implementación objetivo. | Implementarla conforme a `DEC-003`, `DEC-006` y `PRICE-002`, con pruebas deterministas. |
| R-008 | Media | RPO, RTO, retención, volúmenes, concurrencia y tiempos de sincronización siguen sin benchmark. | Medir y aprobar objetivos antes de comprometer SLA. |
| R-009 | Media | La matriz de hardware existe, pero todos los modelos permanecen `UNTESTED`. | Seleccionar equipos, implementar simuladores y alcanzar `LAB_VALIDATED` antes de declarar compatibilidad. |
| R-010 | Media | External Integrations y facturación electrónica tienen contrato neutral, pero no existen migrations 002/003, adapters SIIGO/FACTUS/ALEGRA ni validación normativa/productiva. | Diseñar/materializar 002 External Integrations, después 003 fiscal, e implementar cada adapter sin modificar el dominio comercial; exigir evidencia autorizada independiente antes de promoverlo. |
| R-011 | Media | El frontend HTML actual está previsto para reemplazo y no demuestra el runtime Electron, accesibilidad ni navegación final por rol. | Materializar el runtime definido por `DEC-010` y ejecutar UX-002 a UX-004 antes de adopción operativa. |
| R-012 | Media | Firma, custodia de claves y soporte están documentados, pero proveedores y PoC de protección local no están implementados. | Materializar los controles definidos por `SEC-004`, probar el perfil `OS_PROTECTED` o `DB_ENCRYPTED` y firmar artefactos antes del piloto. |

## Decisiones cerradas

| ID | Prioridad | Decisión cerrada | Evidencia | Consecuencia |
|---|---|---|---|---|
| DEC-001 | `P0` | Taxonomía definitiva de estados de pagos, intentos, refunds, reversals, liquidaciones, conciliaciones, contracargos, revisión e incidencias; transiciones, terminalidad y proyecciones derivadas. | `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`. | `PAY-007` queda `DONE`; `PaymentStatus` no incorpora estados de refund, reversal, settlement, reconciliation ni chargeback. El diseño físico deberá mantener agregados, estados, eventos y proyecciones separados. |
| DEC-002 | `P0` | Política predeterminada para pagos inferiores, sobrepagos, fallos parciales y compensaciones entre efectivo y proveedores externos. | `docs/adr/DEC-002-payment-compensation-policy.md`. | `CASH-003` y `SALES-002` quedan desbloqueados documentalmente; caja, ventas y pagos deben conservar componentes independientes, operaciones compensatorias, idempotencia, control de concurrencia y trazabilidad append-only. |
| DEC-003 | `P0` | Orden único y versionado de precio base, precio promocional, promociones, descuentos, impuestos y redondeo mediante `PRICING_PIPELINE_V1`. | `docs/adr/DEC-003-pricing-calculation-order.md`. | `PRICE-002` y `SALES-003` quedan desbloqueados documentalmente; `DEC-006` complementa la regla exacta de redondeo `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`. Toda implementación debe conservar snapshots inmutables, decimal exacto, algoritmos versionados y separación entre pricing y cobertura. |
| DEC-004 | `P0` | Separación definitiva entre `Product`, `ProductVariant` y `ProductPresentation`, con cardinalidades, identidad vendible, SKU, códigos, inventario, conversiones, pricing, impuestos y migración. | `docs/adr/DEC-004-product-variant-presentation-model.md`, `docs/architecture/conceptual-data-model.md`, `docs/domain/commercial-engine.md`, `docs/domain/glossary.md` y `docs/domain/event-catalog.md`. | `CAT-002` queda `READY`; las decisiones críticas relacionadas quedaron cerradas y `TECH-002` continúa `IN_PROGRESS` después del cierre de `PHY-G06`. |
| DEC-006 | `P0` | Política versionada `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`, con empate alejándose de cero, separación fiscal/comercial, residuos deterministas, devoluciones, offline y conciliación. | `docs/adr/DEC-006-nearest-50-rounding-policy.md` y `docs/adr/DEC-003-pricing-calculation-order.md`. | `TAX-003` quedó `DONE`; `SALES-003` redujo sus bloqueos documentales; toda implementación debe conservar decimal exacto, snapshots, versión, checksum y ajustes explícitos. |
| DEC-007 | `P0` | Autoridad por dato, políticas de sincronización, idempotencia, control de versión, reloj confiable, causalidad, outbox/inbox, checkpoints, conflictos, retención, recuperación, seguridad y observabilidad local-first. | `docs/adr/DEC-007-local-first-data-authority.md`, `docs/adr/ADR-003-local-first.md`, `docs/architecture/conceptual-data-model.md`, `docs/domain/commercial-engine.md` y `docs/domain/glossary.md`. | `SYNC-003` quedó `DONE`; `TECH-005` dejó de depender de `DEC-007`; la implementación deberá conservar operaciones globalmente identificadas, transacciones atómicas, deduplicación, aislamiento multiempresa y conflictos explícitos. |
| DEC-008 | `P0` | Jerarquía de firma, almacenamiento de claves, activación offline, reemplazo de dispositivo y alcance de gracia. | `docs/adr/DEC-008-device-trust-license-activation.md`. | `LIC-002` y `DEV-002` quedaron `DONE`; la decisión dejó de bloquear `TECH-002` y la salida de Fase 0. |
| DEC-009 | `P0` | Entornos, infraestructura pagada, producción central, RPO/RTO medidos, backups, retención, benchmark, observabilidad, rollback y portabilidad. | `docs/adr/DEC-009-operational-production-baseline.md`. | Prohíbe datos reales en recursos gratuitos; habilita `TECH-005` y condiciona SLA/hardware comercial a evidencia. |
| DEC-010 | `P0` | Electron productivo, React, POS Local Service, único escritor SQLite, canal local, PWA de laboratorio, empaquetado y actualización. | `docs/adr/DEC-010-pos-runtime.md`. | Define el runtime físico y desbloquea el esqueleto POS; PWA no es autoridad local productiva. |

## Decisiones pendientes

| ID | Prioridad | Decisión requerida | Bloquea |
|---|---|---|---|
| DEC-005 | `P1` | Política offline de crédito: vigencia del cupo sincronizado, límite, mora y resolución de consumo concurrente. | CUST-002 y PAY-009. |

## Hitos

### Fase 0 — Fundación de producto, arquitectura y dominio


Estado: `DONE`.

Objetivo: cerrar las decisiones y contratos conceptuales necesarios para diseñar la arquitectura objetivo sin modificar prematuramente modelos, frontend o infraestructura.

| Hito | Estado | Criterio / evidencia |
|---|---|---|
| F0.1 Producto y alcance | `DONE` | Documentos bajo `docs/product/` indicados en la evidencia, incluido este backlog. |
| F0.2 Arquitectura y ADR iniciales | `DONE` | `docs/architecture/` y `docs/adr/`. |
| F0.3 Dominio, seguridad, pruebas y migración | `DONE` | `docs/domain/`, `docs/security/permission-matrix.md`, `docs/testing/testing-strategy.md`, `docs/migration/avicola-baseline-migration.md`. |
| F0.4 Casos comerciales y operativos iniciales | `DONE` | Casos existentes bajo `docs/use-cases/`; la secuencia completa de pagos se consolida en F0.5. |
| F0.5 Secuencia completa de pagos | `DONE` | UC-PAY-001, 002, 003, 004, 005 y 006 están documentados, y `PAY-007` armoniza los estados en `docs/domain/payment-state-model.md`. |
| F0.6 Decisiones críticas cerradas | `DONE` | `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-006`, `DEC-007`, `DEC-008`, `DEC-009` y `DEC-010` cerradas con evidencia verificable; `DEC-005` queda diferida como decisión `P1` y no bloquea el cierre de decisiones críticas `P0`. |
| F0.7 Preparación para diseño físico | `DONE` | Auditoría documental completada; `SYNC-001`, `SYNC-002`, `SYNC-003`, `DEV-001`, `DEV-002`, `LIC-002` y decisiones críticas aplicables consolidadas. El cierre dejó `TECH-002` como entrada de Fase 1; actualmente está `IN_PROGRESS` y `PHY-G06` está cerrado. |

La Fase 0 quedó cerrada al completarse UC-PAY-004 y UC-PAY-005, consolidarse la máquina de pagos, cerrarse las decisiones `P0` necesarias para persistencia y documentarse invariantes y pruebas mínimas coherentes para los casos críticos.

### Fase 1 — Fundación técnica ejecutable

Estado: `IN_PROGRESS`.

Objetivo: crear el núcleo multiempresa comprobable sobre límites modulares, migraciones nuevas y controles backend, sin dar por válida la implementación heredada.

| Hito | Estado | Criterio de salida |
|---|---|---|
| F1.1 Esqueleto modular y contratos | `PLANNED` | Límites de módulo verificables y lógica fuera de controladores HTTP. |
| F1.2 Modelo físico y migraciones | `IN_PROGRESS` | `TECH-002` cerrado y migration 001 materializada/verificada en `255d813`; siguientes cortes son aditivos y requieren manifest/autorización independientes. Device-Licensing/Catalog conservan sus condiciones posteriores. |
| F1.3 Seguridad e identidad | `PLANNED` | `SEC-G01` a `SEC-G10` formalizados pero no evaluados; requiere aislamiento multi-tenant probado, sesiones revocables, MFA crítico, permisos backend y evidencia de release. |
| F1.4 CI y calidad base | `PLANNED` | Lint, tipos, pruebas, seguridad y validación de migraciones obligatorios. |
| F1.5 Primer corte vertical | `PLANNED` | Onboarding mínimo y un flujo autenticado funcionan con auditoría e idempotencia. |
| F1.6 Base local-first | `PLANNED` | Identificadores globales, outbox y reintento demostrados sin duplicación. |

La Fase 1 no incluye como terminados domicilios, aplicaciones de comprador/domiciliario, facturación electrónica, GPS, conciliación bancaria avanzada ni especialización regulatoria de droguería.

## Registro de cambios

- 2026-08-02: `UC-PAY-004` pasó de `READY` a `IN_PROGRESS` como siguiente trabajo aprobado. `UC-PAY-005` permanece `PLANNED` y dependiente de `UC-PAY-004`. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-02: `UC-PAY-004` pasó de `IN_PROGRESS` a `DONE`, con evidencia en `docs/use-cases/payments/UC-PAY-004-refund-payment.md`. `UC-PAY-005` pasó de `PLANNED` a `READY`. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `UC-PAY-005` pasó de `READY` a `IN_PROGRESS` como siguiente trabajo aprobado. `PAY-007` permanece `PLANNED` y dependiente de `UC-PAY-005`. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `UC-PAY-005` pasó de `IN_PROGRESS` a `DONE`, con evidencia en `docs/use-cases/payments/UC-PAY-005-reconcile-payment.md`. `PAY-007` pasó de `PLANNED` a `READY`. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `PAY-007` pasó de `READY` a `IN_PROGRESS` como siguiente trabajo aprobado. `UC-PAY-005` permanece `DONE`. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `PAY-007` pasó de `IN_PROGRESS` a `DONE`, con evidencia en `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`. `DEC-001` se movió de decisiones pendientes a decisiones cerradas. `F0.5` quedó `DONE`; la Fase 0 permanece `IN_PROGRESS` porque continúan abiertas decisiones `P0` necesarias para persistencia.

- 2026-08-04: `DEC-002` pasó de decisión pendiente a `IN_PROGRESS` como siguiente trabajo `P0`. `CASH-003` y `SALES-002` permanecen bloqueados hasta cerrar la política de pago inferior, sobrepago, fallo parcial y compensación. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `DEC-002` pasó de `IN_PROGRESS` a decisión cerrada, con evidencia en `docs/adr/DEC-002-payment-compensation-policy.md`. `CASH-003` y `SALES-002` pasaron de `PLANNED` a `READY`; `CASH-003` queda como siguiente trabajo autorizado. `F0.6` permanece `IN_PROGRESS` por las decisiones críticas restantes.
- 2026-08-04: `CASH-003` pasó de `READY` a `IN_PROGRESS` como siguiente trabajo `P0`. `SALES-002` permanece `READY` y dependiente de la consolidación operativa de caja. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `CASH-003` pasó de `IN_PROGRESS` a `DONE`, con evidencia en `docs/use-cases/cash/UC-CASH-003-cash-operations.md`. `SALES-002` pasó de `READY` a `IN_PROGRESS` como siguiente trabajo `P0`. La Fase 0 permanece `IN_PROGRESS`.
- 2026-08-04: `SALES-002` pasó de `IN_PROGRESS` a `DONE`, con evidencia en `docs/use-cases/sales/UC-SALES-002-manage-sale-lifecycle.md`. `DEC-003` pasó de decisión pendiente a `IN_PROGRESS` como siguiente trabajo `P0`. La Fase 0 permanece `IN_PROGRESS`.

- 2026-08-04: `DEC-003` pasó de `IN_PROGRESS` a decisión cerrada, con evidencia en `docs/adr/DEC-003-pricing-calculation-order.md`. `DEC-004` pasó de decisión pendiente a `IN_PROGRESS` como siguiente trabajo `P0`. `PRICE-002` y `SALES-003` quedan desbloqueados por pricing, pero el redondeo exacto continúa condicionado por `DEC-006`. La Fase 0 permanece `IN_PROGRESS`.

- 2026-08-04: `DEC-004` pasó de `IN_PROGRESS` a decisión cerrada, con evidencia en `docs/adr/DEC-004-product-variant-presentation-model.md` y documentación relacionada alineada. `CAT-002` pasó de `PLANNED` a `READY`. `DEC-006` pasó de decisión pendiente a `IN_PROGRESS` como siguiente trabajo `P0`. `TECH-002` permanece `PLANNED` por decisiones críticas restantes.

- 2026-08-04: `DEC-006` pasó de `IN_PROGRESS` a decisión cerrada, con evidencia en `docs/adr/DEC-006-nearest-50-rounding-policy.md`; `DEC-003` quedó armonizada con `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`. `TAX-003` pasó a `READY` y `DEC-007` pasó a `IN_PROGRESS` como siguiente trabajo `P0`.

- 2026-08-06: `DEC-007` pasó de `IN_PROGRESS` a decisión cerrada, con evidencia en `docs/adr/DEC-007-local-first-data-authority.md` y documentos de dominio alineados. `SYNC-003` pasó a `READY`, `TECH-005` dejó de depender de `DEC-007` y `DEC-008` pasó a `IN_PROGRESS` como siguiente decisión `P0`.

## Regla de actualización del backlog

1. Todo cambio de alcance, estado, prioridad o dependencia debe actualizar este archivo en el mismo cambio que introduce la evidencia o descubre el impedimento.
2. Cada elemento movido a `DONE` debe incluir al menos una ruta real y verificable; si la evidencia desaparece o deja de cumplir el criterio, el elemento sale de `DONE`.
3. Al iniciar trabajo, se registra `IN_PROGRESS`; al bloquearse, se registra causa y condición de desbloqueo; al diferirse o excluirse, se registra la decisión de alcance.
4. La actualización debe revisar también orden inmediato, riesgos, decisiones e hitos afectados; no se actualizan estados de forma aislada.
5. No se marcan como terminadas capacidades objetivo por existir únicamente en la base heredada, en HTML estático, en una descripción conceptual o en código sin pruebas suficientes.
6. Un nuevo caso de uso debe respetar identificador, épica, prioridad, dependencias, invariantes, permisos, idempotencia, auditoría, offline y pruebas mínimas cuando apliquen.
7. Antes de cerrar un cambio del backlog se ejecutan, como mínimo, `git diff --check` y la validación relevante al artefacto modificado.
8. Este archivo se mantiene en UTF-8 y conserva una única cola ordenada de trabajo inmediato.

- 2026-08-06: `DEC-008` pasó de `IN_PROGRESS` a `DONE`, con evidencia en `docs/adr/DEC-008-device-trust-license-activation.md` y alineación del modelo conceptual, modelo de seguridad, reglas de negocio, glosario y `UC-LIC-001`. `LIC-002` pasó a `READY`; `DEV-001` pasó a `IN_PROGRESS` como siguiente trabajo `P0`; `DEV-002` permanece `PLANNED` hasta cerrar ambas dependencias. `F0.6` pasó a `DONE`; `DEC-005` quedó diferida como decisión `P1`.

- 2026-08-10: `DEV-001` pasó de `IN_PROGRESS` a `DONE` mediante `docs/use-cases/devices/UC-DEV-001-manage-device-lifecycle.md`. Se consolidaron registro, aprobación, operación conectada/offline, heartbeat, estados operativos, alertas administrativas, cambios de hardware, reinstalación, pérdida de clave, revocación, recuperación, reemplazo, desactivación, desinstalación confirmada y modalidades de propiedad y administración del activo. El modelo conceptual incorporó `DeviceOperationalState` y `DeviceManagementProfile`; las reglas de negocio quedaron extendidas hasta `RN-102` y el glosario fue alineado. `LIC-002` queda como siguiente trabajo `P0`.

- 2026-08-10: `LIC-002` pasó de `READY` a `DONE` mediante `docs/use-cases/licensing/UC-LIC-002-manage-license-lifecycle.md`. Se consolidaron emisión, renovación, avisos, gracia, restricción progresiva, suspensión, reactivación, revocación, terminación, modalidades `HYBRID` y `LOCAL_PERPETUAL`, cambios de plan y la relación con activaciones y dispositivos. El modelo conceptual separó `contract_status` de vigencia, gracia, revocación, restricción efectiva y validez; las reglas de negocio quedaron extendidas hasta `RN-116` y el glosario fue alineado. `DEV-002` pasa a `IN_PROGRESS` como siguiente trabajo `P0`.

- 2026-08-10: `DEV-002` pasó de `IN_PROGRESS` a `DONE` mediante `docs/use-cases/devices/UC-DEV-002-secure-pos-identity-license-contract.md`. Se consolidó el contrato operativo entre tenant, dispositivo, instalación, clave criptográfica, activación, licencia y entitlements; se definieron validación conectada/offline, autorización efectiva, códigos estables, flujos alternos, auditoría, observabilidad futura y pruebas mínimas. `RN-117` fija su relación normativa con `UC-DEV-001`, `UC-LIC-001`, `UC-LIC-002`, `DEC-007` y `DEC-008`. `F0.7` pasa a `IN_PROGRESS`.

- 2026-08-10: `SEC-002` pasó de `PLANNED` a `DONE` mediante la ampliación de `docs/security/permission-matrix.md`. Se definieron permisos atómicos, políticas ABAC, segregación de funciones, pruebas negativas y contrato estructurado de decisión de autorización. La deuda explícita de refund/reversal quedó cubierta y `ONB-001` pasó a `READY`.

- 2026-08-10: `INV-002` pasó de `PLANNED` a `DONE` mediante `docs/use-cases/inventory/UC-INVENTORY-002-manage-stock-lifecycle.md`. Se consolidaron reservas, salidas, ajustes, mermas, traslados, lotes, vencimientos, FEFO/FIFO, concurrencia, control de versión, operación local-first/offline, conflictos y compensaciones. El modelo conceptual, las reglas de negocio hasta `RN-130`, el glosario y la matriz de permisos quedaron alineados. La auditoría final no detectó contradicciones estructurales ni duplicados.

- 2026-08-10: `ONB-001` pasó de `READY` a `DONE` mediante `docs/use-cases/onboarding/UC-ONB-001-initialize-tenant.md`. Se consolidó el contrato funcional de onboarding para creación de tenant, empresa inicial, primera sucursal, propietario y configuración mínima. La identidad del usuario quedó definida como global; `TenantMembership` establece la pertenencia al tenant y `UserRoleAssignment` define roles y alcance operativo. Las reglas de negocio quedaron extendidas hasta `RN-139`, y modelo conceptual, tenant model y glosario fueron alineados.

- 2026-08-10: `PRICE-002` pasó de `PLANNED` a `DONE`. `UC-PRICE-002` quedó consolidado con `DEC-003` y `DEC-006`: conserva por separado precio base y precio promocional elegible, declara `PRICING_PIPELINE_V1`, produce `resolution_snapshot`, utiliza decimal exacto y no adelanta promociones posteriores, cupones, descuentos manuales, impuestos ni redondeos.

- 2026-08-10: `TAX-003` pasó de `READY` a `DONE`. `UC-TAX-001` quedó ampliado con precisión y normalización fiscal, residuos, conciliación y persistencia explícita de ajustes. `UC-ROUND-001` fue alineado con `DEC-006`: el redondeo fiscal ocurre antes del comercial, `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` opera a nivel documental y se obtiene un único `payable_amount` antes de los pagos e independiente del medio de pago.

- 2026-08-10: `SYNC-001` pasó de `PLANNED` a `DONE` mediante `docs/use-cases/sync/UC-SYNC-001-synchronize-operation.md`. Se consolidaron identidad global de operación, atomicidad local negocio+outbox, inbox central, idempotencia, checksum, expected_version, causalidad, autoridad por dominio, checkpoint, recuperación tras reinicio, aislamiento multi-tenant y prohibición de usar last-write-wins o reloj local como autoridad global. `SYNC-002` pasa a `READY`.

- 2026-08-10: `SYNC-002` pasó de `READY` a `DONE` mediante `docs/use-cases/sync/UC-SYNC-002-manage-offline-configuration.md`. Se descartó una entidad global de configuración y se consolidó versionado por dominio; la disponibilidad offline quedó definida como decisión derivada de versiones, vigencia, permisos, licencia, dispositivo, autoridad, revocaciones y dependencias.

- 2026-08-10: la auditoría general de preimplementación fue remediada sin iniciar el modelo físico. Se unificaron identidad UUID v7, alcances multi-tenant, propiedad modular, estados de ventas y pagos, topología `PaymentGroup`/`Payment`/`PaymentAttempt`, precisión monetaria, redondeo único por venta, inventario por presentación y lote, contratos local-first, configuración offline, transacciones críticas, migración y pruebas por dialecto. `TECH-002` permanece `READY`; el inicio de Fase 1 no tiene decisiones `P0` documentales pendientes.

- 2026-08-10: se cerró la preparación tecnológica previa a código mediante `ADR-005`, `DEC-009`, `DEC-010`, `ARCH-004` y `SEC-004`. Se fijaron stack TypeScript/NestJS/Electron, POS Local Service como único escritor SQLite, infraestructura pagada para datos reales, modos `HYBRID`/`LOCAL_PERPETUAL`, pruebas objetivo, aislamiento del despliegue Avícola heredado, contrato fiscal neutral, Factus como primer sandbox, Siigo como segunda validación y matriz de hardware sin certificaciones inventadas. `TECH-002` permanece como siguiente trabajo `P0 READY`; ninguna implementación objetivo fue declarada terminada.

- 2026-08-10: `TECH-002` pasó de `READY` a `IN_PROGRESS` con la matriz `docs/architecture/physical-model/traceability.md`. El inventario relaciona los casos de uso con módulos y agregados, excluye capacidades diferidas y registra brechas físicas que deben cerrarse antes del esquema. La primera migración permanece bloqueada hasta aprobar tipos, scopes, aislamiento, transacciones, auditoría y diferencias PostgreSQL/SQLite.

- 2026-08-10: `TECH-002` cerró documentalmente `PHY-G01` a `PHY-G05` y diseñó convenciones, fundación, dispositivos/licencias y catálogo sin escribir DDL. Al abordar `PHY-G06`, se alineó recepción con `inventory_location_id` y se diseñaron Supplier, GoodsReceipt, items, lotes, movimientos, costo y saldo; `TECH-002` pasó a `BLOCKED` porque `purchase_id` referencia Purchase sin contrato funcional suficiente. No se avanzó a `PHY-G07`.

- 2026-08-10: la segunda pasada controlada de `PHY-G06` eliminó la referencia genérica del contrato vigente y cerró GoodsReceipt independiente, líneas, múltiples asignaciones de lote, un movimiento por asignación, costo de recepción separado, compensaciones, permisos, eventos, migración heredada y frontera atómica. `PHY-G06` pasó a `CLOSED` y `TECH-002` volvió a `IN_PROGRESS`; no se inició `PHY-G07`.

- 2026-08-10: `PHY-G07` cerró el contrato físico de caja mediante autoridades explícitas para CashShift, CashMovement, CashCount y revisión de diferencias; se alinearon corte, efectivo esperado, denominaciones, correcciones, concurrencia, permisos, eventos, operación offline y migración heredada. No se escribió DDL ni se inició `PHY-G08`.

- 2026-08-12: `PHY-G08` cerró el contrato físico documental de SaleReturn. Se separaron estados persistentes de proyecciones de Sale, SaleReturn de Refund/Reversal, ownership y permisos de Sales/Payments, y se alinearon tenant, snapshots, elegibilidad, dinero, inventario, caja, fiscalización, local-first, auditoría, eventos y migración heredada. No se escribió DDL ni se inició `PHY-G09`.

- 2026-08-12: `PHY-G09` cerró el contrato físico documental de Reversal, Settlement y Reconciliation. `PAY-007` quedó como autoridad única de estados; se alinearon eventos canónicos, ownership de Payments, componentes monetarios exactos, tratamiento versionado del bruto frente a reversals, snapshots de alcance, permisos sobre roles existentes, provider authority, replay, idempotencia, fraude, local-first, auditoría y migración heredada. No se escribió DDL ni se inició `PHY-G10`.

- 2026-08-12: se formalizaron `SEC-G01` a `SEC-G10` mediante `docs/security/security-gates.md` y la matriz obligatoria amenaza → control → prueba → evidencia. Los diez gates permanecen `PLANNED`/no evaluados porque no existe implementación ni evidencia ejecutable del stack objetivo. `TECH-002` y la secuencia física no cambiaron; `PHY-G10` no se inició.

- 2026-08-12: `PHY-G10` cerró el contrato documental de versiones de configuración por dominio. Se eliminó `Configuration` como dominio global, se reconoció Tax independiente, se definieron CashPolicy/InventoryPolicy y versiones inmutables, y se alinearon ownership, scopes, vigencia, precedencia explícita, checksum, snapshots, permisos, secretos, eventos, local-first y migración legado. `TECH-002` permanece `IN_PROGRESS`; `SEC-G01` a `SEC-G10` permanecen `PLANNED`/`NOT_EVALUATED`, no se escribió DDL y no se inició `PHY-G11`.

- 2026-08-12: `PHY-G11` cerró el contrato documental de dead letter. Se eligió `SyncDeadLetter` como agregado separado referencial, sin duplicar `SyncOperation`, Outbox, Inbox o payload; se alinearon ownership, identidad, clasificación, retries versionados, errores permanentes, revisión/reactivación, archivo/retención, idempotencia, causalidad, seguridad, permisos, auditoría, eventos, concurrencia, legado y pruebas PostgreSQL/SQLite. `TECH-002` permanece `IN_PROGRESS`; los security gates permanecen `PLANNED`/`NOT_EVALUATED`, no se escribió DDL y no se inició `PHY-G12`.

- 2026-08-12: `PHY-G12` cerró el contrato documental de agregados fiscales neutrales. `ElectronicDocument` quedó como único nombre canónico y se formalizaron `FiscalConnection`, `FiscalSubmissionAttempt`, `FiscalArtifact`, `FiscalIncident`, `FiscalReconciliation` e items; se separaron Tax y emisión, snapshots, cuatro máquinas internas y estado externo, `UNKNOWN_OUTCOME` técnico/fiscal, correctivos, numeración, idempotencia, webhooks conceptuales, local-first, tenant, secretos, permisos, eventos, auditoría, concurrencia, legado y pruebas. `TECH-002` permanece `IN_PROGRESS`; `SEC-G01` a `SEC-G10` permanecen `PLANNED`/`NOT_EVALUATED`, la primera migración permanece `NO-GO` y `PHY-G14` no se inició.

- 2026-08-12: `PHY-G14` pasó de `BLOCKED_BY_POC` a `CLOSED` después de ejecutar el PoC aislado `poc/rls/` en PostgreSQL 16.14. Pasaron RLS/FORCE para owner y runtimes, fail-closed sin contexto o con UUID inválido, SELECT/INSERT/UPDATE/DELETE cross-tenant, `WITH CHECK`, FK tenant-aware, reuse de conexión, rollback, worker secuencial, admin global explícito, introspección y dump/restore con roles separados. La evidencia es parcial para `SEC-G01`, que permanece `PLANNED`/`NOT_EVALUATED`; `TECH-002` sigue `IN_PROGRESS` y la primera migración sigue `NO-GO`.

- 2026-08-12: la remediación R1 de `TECH-002` cerró siete incompatibilidades documentales: Foundation conserva `IN_REVIEW` con condiciones satisfechas/trasladadas/pendientes; AuditEvent quedó append-only con snapshots sanitizados; Outbox quedó 1:1 y referencial a SyncOperation; DeviceKey usa una sola identidad; límites usan `FINITE`/`UNLIMITED`/`NOT_APPLICABLE`; dinero separa escalas 6/10/2; y PriceChange dejó de ser entidad física candidata. No se implementaron DDL, migraciones ni tests ejecutables. `TECH-002` continúa `IN_PROGRESS`, los security gates siguen `PLANNED`/`NOT_EVALUATED` y la primera migración sigue `NO-GO`.

- 2026-08-12: `TECH-002 / R2-A` cerró documentalmente relaciones Foundation↔Devices/Licensing↔Sync. `sync-base-schema.md` fija identidades, cardinalidades, candidate keys/FKs tenant-aware, Operation/Outbox/Inbox/Checkpoint, Conflict/Review/DeadLetter, orden sin ciclos, delete policies, split PostgreSQL/SQLite, transacciones y seguridad. Foundation y Device/Licensing permanecen `IN_REVIEW`; no se ejecutaron security gates, DDL ni migraciones.

- 2026-08-14: `TECH-002 / R2-B` pasó `PASS` documental mediante contratos físicos base de Sales, Payments, Pricing, Tax e Inventory y la auditoría transversal de Sync comercial, multi-negocio, capability model, hardware/providers, seguridad y transacciones. No se creó catálogo definitivo de capabilities ni se adelantaron Customer Credit, PurchaseOrder o serial tracking. En ese corte, `TECH-002` permaneció `IN_PROGRESS`, `SEC-G01` a `SEC-G10` siguieron `PLANNED`/`NOT_EVALUATED`, R3/R4 quedaron pendientes y la primera migración permaneció `NO-GO`.

- 2026-08-14: `TECH-002 / R3` obtuvo `PASS` en el PoC desechable `poc/physical-model/`: PostgreSQL 16.14 pasó `97/97`, SQLite 3.50.4/WAL pasó `83/83`, y dump/restore pasó con roles separados. Se validaron equivalencia de tipos y restricciones, aislamiento tenant, atomicidad, idempotencia, append-only, concurrencia, Outbox/Inbox/Checkpoint y recuperación. La evidencia es parcial para `SEC-G01`, `SEC-G05`, `SEC-G06`, `SEC-G08` y `SEC-G09`; todos los gates conservan `PLANNED`/`NOT_EVALUATED`. `TECH-002` permanece `IN_PROGRESS`, R4 sigue pendiente y la primera migración permanece `NO-GO`.

- 2026-08-14: `TECH-002 / R4` obtuvo `PASS` documental. `docs/migration/first-target-migration-manifest.md` fija un control plane PostgreSQL mínimo y una contraparte SQLite limitada a control de migraciones; excluye Device/Licensing dependiente de crypto, Inbox/Checkpoint receptor y todos los dominios comerciales. Foundation pasa a `APPROVED_FOR_MIGRATION_DESIGN` solo para 001; Device-Licensing y Catalog siguen `IN_REVIEW`. Security gates no cambian, `TECH-002` sigue `IN_PROGRESS` y primera migración `NO-GO`.

- 2026-08-14: la primera revisión transversal final de `TECH-002` produjo `NO-GO` y seis blockers materiales B01–B06: bootstrap/ledger, autoridad del migrador, recovery, ownership de onboarding, Session/RLS y `AuditEvent.resource_id`. `TECH-002 / R5` los cerró documentalmente con bootstrap permanente previo a STARTED, ledger único sin metadata Kysely, máquina de estados fail-closed, FK OWNER compuesta, Session RLS/FORCE y referencia AuditEvent condicional verificable. El scope de 001 no se amplió, los security gates no cambiaron y no se escribió DDL.

- 2026-08-14: la revisión transversal final #2 revalidó R1–R5 y confirmó B01–B06 `CLOSED`, scope 001 exacto, aislamiento tenant-aware, autoridad única, lifecycle/recovery, separación legacy y cero blockers categoría A. `TECH-002` pasó a `DONE` y la primera migración a `GO_AUTHORIZED` solo para implementar `001_central_foundation` y `001_local_migration_control`. `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED`; Fase 1, Device/Licensing, Catalog y producción no se declararon terminados. Registro histórico previo a `255d813`.

- 2026-08-14: `255d813` materializó migration 001 con evidencia PostgreSQL `54/54`, SQLite `12/12` y combined `66/66`; desde este punto sus artefactos y checksums son inmutables.

- 2026-08-17: `INT-001` cerró documentalmente External Integrations: conexión general separada de `FiscalConnection`, provider registry extensible, capabilities, mappings, ownership, discovery, secrets/tokens, dispatch, webhooks, rate limits, evidencia y matriz SIIGO/FACTUS/ALEGRA/HKA/ODOO. No se creó SQL ni adapter; los providers permanecen `NOT_EVALUATED` y los SEC-G no cambian.

- 2026-08-17: la gobernanza resolvió el blocker de alcance de INT-002 separando materialización progresiva dentro de Phase 1: migration 002 contiene solo External Integrations foundation y permite únicamente dispatch `NON_FISCAL`; migration 003 contendrá Fiscal/Electronic Invoicing y habilitará `FISCAL` atómicamente con `FiscalSubmissionAttempt`. No se creó manifest detallado ni SQL, no cambió INT-001 y migration 001 permanece inmutable.

Próxima actualización obligatoria: reiniciar `INT-002` para diseñar el manifest exacto de migration 002 External Integrations `NON_FISCAL`, sin modificar migration 001, sin tablas fiscales y sin escribir SQL.
