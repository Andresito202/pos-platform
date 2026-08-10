# Backlog maestro

## Propósito y autoridad

Este archivo es la fuente de verdad del trabajo del proyecto. Consolida el estado, la prioridad, las dependencias, la evidencia y las decisiones que gobiernan el paso desde la base avícola existente hacia POS Platform.

Si otro documento de avance, una conversación o una lista informal contradice este backlog, prevalece este archivo hasta que se actualice mediante el flujo oficial.

Última actualización: 2026-08-10.

## Estado general

- Rama de trabajo verificada: `architecture/foundation`.
- Estado inicial del árbol al crear este backlog: limpio.
- Etapa actual: transición hacia la fundación técnica ejecutable y el diseño del modelo físico objetivo.
- Fase 0: `DONE`.
- Último hito completado: cierre documental de la Fase 0, incluida la consolidación de `SYNC-001`, `SYNC-002` y `SYNC-003`.
- Siguiente trabajo habilitado: `TECH-002`, con estado `READY` y prioridad `P0`, como entrada de la Fase 1.
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
| ARCH-004 | `P1` | `PLANNED` | Definir contratos de integración POS local, API central y servicio de hardware. | Depende de SYNC-001 y DEV-002. |

### Seguridad

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| SEC-001 | `P0` | `DONE` | Definir modelo de seguridad, roles y matriz de permisos. | `docs/architecture/security-model.md`, `docs/product/roles.md`, `docs/security/permission-matrix.md` |
| SEC-002 | `P0` | `DONE` | Definir permisos atómicos, políticas ABAC y pruebas negativas por módulo. | Cerrado en `docs/security/permission-matrix.md` con permisos atómicos, políticas ABAC, segregación de funciones, pruebas negativas y contrato estructurado de decisión de autorización. |
| SEC-003 | `P0` | `PLANNED` | Implementar aislamiento de tenant, sesiones revocables, MFA y reautenticación. | Fase 1; depende de ONB-002 y DEV-001. |
| SEC-004 | `P1` | `PLANNED` | Definir gestión de secretos, firma de licencias/actualizaciones y acceso temporal de soporte. | Depende de LIC-002 y DEV-002. |

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
| TAX-004 | `P3` | `DEFERRED` | Facturación electrónica e integraciones fiscales. | Fase posterior según `docs/product/scope.md`. |

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
| PUR-001 | `P1` | `PLANNED` | Definir proveedor, orden de compra, compra, recepción parcial, cancelación y devolución a proveedor. | La recepción inicial está en `docs/use-cases/inventory/UC-INVENTORY-001-receive-stock.md`; no cubre toda la épica. |
| PUR-002 | `P1` | `PLANNED` | Implementar compras separando recepción física y factura. | Depende de PUR-001 e INV-003. |

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
| DEV-003 | `P2` | `PLANNED` | Implementar adaptadores de lector, impresora, cajón y balanza. | Depende de ARCH-004 y matriz de hardware pendiente. |

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
| TECH-002 | `P0` | `READY` | Diseñar modelo físico nuevo, migraciones, restricciones, índices y fronteras de transacción. | Fase 1; decisiones documentales críticas de Fase 0 cerradas. Debe seguir `docs/migration/avicola-baseline-migration.md`, conservar las decisiones `DEC-004`, `DEC-006`, `DEC-007` y `DEC-008`, y no reescribir silenciosamente la migración original. |
| TECH-003 | `P0` | `PLANNED` | Definir contratos API, errores, idempotency keys, versionado y correlación. | Depende de casos de uso de Fase 0. |
| TECH-004 | `P0` | `PLANNED` | Crear pipeline CI con lint, tipos, pruebas, seguridad y validación de migraciones. | Requisitos en `docs/testing/testing-strategy.md`; no hay evidencia de pipeline objetivo terminado. |
| TECH-005 | `P1` | `PLANNED` | Definir observabilidad, backups, restauración, actualización y rollback por modalidad. | Requiere objetivos RNF, `DEC-009` y criterios verificables de capacidad, recuperación y retención. |
| TECH-006 | `P1` | `PLANNED` | Establecer datos de prueba, fixtures multi-tenant y pruebas de concurrencia/recuperación. | Depende de TECH-002 y TECH-004. |

## Orden inmediato de trabajo

1. `TECH-002` — `P0`, `READY`: diseñar el modelo físico nuevo, migraciones, restricciones, índices y fronteras de transacción.
2. Reevaluar `TECH-003` y los trabajos dependientes después de completar el diseño físico y registrar su evidencia.
3. Mantener `DEC-005`, `DEC-009` y `DEC-010` como decisiones `P1` pendientes según sus dependencias; no bloquean el inicio de `TECH-002`.


La implementación de la arquitectura objetivo debe comenzar por la fundación técnica y respetar los invariantes cerrados durante la Fase 0.

## Riesgos abiertos

| ID | Severidad | Riesgo | Mitigación / condición de cierre |
|---|---|---|---|
| R-001 | Alta | Confundir la base avícola existente con la arquitectura objetivo puede perpetuar acceso global, lógica acoplada y modelo monoempresa. | Migrar caso por caso según `docs/migration/avicola-baseline-migration.md`; no declarar módulos objetivo `DONE` por la existencia del código heredado. |
| R-002 | Baja | Riesgo residual de que la implementación física vuelva a mezclar estados persistentes, proyecciones y estados de agregados diferentes. | DEC-001 cerrado mediante `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`; validar el modelo físico y las migraciones contra estos documentos durante `TECH-002`. |
| R-003 | Alta | Pagos mixtos con proveedores externos no tienen atomicidad distribuida y pueden producir doble cobro o compensaciones pendientes. | Estados explícitos, idempotencia, incidencias y pruebas de respuestas tardías. |
| R-004 | Alta | El aislamiento multi-tenant está definido pero no probado en la base objetivo. | SEC-003 y pruebas negativas obligatorias antes de datos reales. |
| R-005 | Alta | El contrato local-first está documentado, pero todavía no existe una implementación probada de sincronización. | Implementar `SYNC-004` sobre los contratos `SYNC-001`, `SYNC-002` y `SYNC-003`, con pruebas de duplicados, orden, recuperación y reloj incorrecto. |
| R-006 | Alta | No hay modelo físico objetivo; modificar silenciosamente la migración heredada puede fijar errores de dominio. | Ejecutar `TECH-002` como entrada `READY` de Fase 1 y crear nuevas migraciones conforme a las decisiones cerradas. |
| R-007 | Media | La canalización versionada de pricing está definida, pero todavía no tiene una implementación objetivo. | Implementarla conforme a `DEC-003`, `DEC-006` y `PRICE-002`, con pruebas deterministas. |
| R-008 | Media | RPO, RTO, retención, volúmenes, concurrencia y tiempos de sincronización siguen sin benchmark. | Medir y aprobar objetivos antes de comprometer SLA. |
| R-009 | Media | Hardware, Windows y operación offline carecen de una matriz de equipos y pruebas reales. | Definir matriz, simuladores y laboratorio antes de certificar compatibilidad. |
| R-010 | Media | Facturación electrónica y droguería pueden introducir requisitos regulatorios que alteren snapshots, impuestos o trazabilidad. | Mantenerlos `DEFERRED` hasta una fase especializada y validación normativa. |
| R-011 | Media | El frontend HTML actual está previsto para reemplazo y no demuestra accesibilidad ni navegación final por rol. | UX-002 a UX-004 antes de adopción operativa. |
| R-012 | Media | Firma, custodia de claves y recuperación de licencias/dispositivos están documentadas, pero todavía no implementadas. | Implementar conforme a `DEC-008`, `LIC-002`, `DEV-001` y `DEV-002`; completar `SEC-004` según su alcance. |

## Decisiones cerradas

| ID | Prioridad | Decisión cerrada | Evidencia | Consecuencia |
|---|---|---|---|---|
| DEC-001 | `P0` | Taxonomía definitiva de estados de pagos, intentos, refunds, reversals, liquidaciones, conciliaciones, contracargos, revisión e incidencias; transiciones, terminalidad y proyecciones derivadas. | `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`. | `PAY-007` queda `DONE`; `PaymentStatus` no incorpora estados de refund, reversal, settlement, reconciliation ni chargeback. El diseño físico deberá mantener agregados, estados, eventos y proyecciones separados. |
| DEC-002 | `P0` | Política predeterminada para pagos inferiores, sobrepagos, fallos parciales y compensaciones entre efectivo y proveedores externos. | `docs/adr/DEC-002-payment-compensation-policy.md`. | `CASH-003` y `SALES-002` quedan desbloqueados documentalmente; caja, ventas y pagos deben conservar componentes independientes, operaciones compensatorias, idempotencia, control de concurrencia y trazabilidad append-only. |
| DEC-003 | `P0` | Orden único y versionado de precio base, precio promocional, promociones, descuentos, impuestos y redondeo mediante `PRICING_PIPELINE_V1`. | `docs/adr/DEC-003-pricing-calculation-order.md`. | `PRICE-002` y `SALES-003` quedan desbloqueados documentalmente; `DEC-006` complementa la regla exacta de redondeo `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`. Toda implementación debe conservar snapshots inmutables, decimal exacto, algoritmos versionados y separación entre pricing y cobertura. |
| DEC-004 | `P0` | Separación definitiva entre `Product`, `ProductVariant` y `ProductPresentation`, con cardinalidades, identidad vendible, SKU, códigos, inventario, conversiones, pricing, impuestos y migración. | `docs/adr/DEC-004-product-variant-presentation-model.md`, `docs/architecture/conceptual-data-model.md`, `docs/domain/commercial-engine.md`, `docs/domain/glossary.md` y `docs/domain/event-catalog.md`. | `CAT-002` queda `READY`; las decisiones críticas relacionadas quedaron cerradas y `TECH-002` está `READY`. |
| DEC-006 | `P0` | Política versionada `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`, con empate alejándose de cero, separación fiscal/comercial, residuos deterministas, devoluciones, offline y conciliación. | `docs/adr/DEC-006-nearest-50-rounding-policy.md` y `docs/adr/DEC-003-pricing-calculation-order.md`. | `TAX-003` quedó `DONE`; `SALES-003` redujo sus bloqueos documentales; toda implementación debe conservar decimal exacto, snapshots, versión, checksum y ajustes explícitos. |
| DEC-007 | `P0` | Autoridad por dato, políticas de sincronización, idempotencia, control de versión, reloj confiable, causalidad, outbox/inbox, checkpoints, conflictos, retención, recuperación, seguridad y observabilidad local-first. | `docs/adr/DEC-007-local-first-data-authority.md`, `docs/adr/ADR-003-local-first.md`, `docs/architecture/conceptual-data-model.md`, `docs/domain/commercial-engine.md` y `docs/domain/glossary.md`. | `SYNC-003` quedó `DONE`; `TECH-005` dejó de depender de `DEC-007`; la implementación deberá conservar operaciones globalmente identificadas, transacciones atómicas, deduplicación, aislamiento multiempresa y conflictos explícitos. |
| DEC-008 | `P0` | Jerarquía de firma, almacenamiento de claves, activación offline, reemplazo de dispositivo y alcance de gracia. | `docs/adr/DEC-008-device-trust-license-activation.md`. | `LIC-002` y `DEV-002` quedaron `DONE`; la decisión dejó de bloquear `TECH-002` y la salida de Fase 0. |

## Decisiones pendientes

| ID | Prioridad | Decisión requerida | Bloquea |
|---|---|---|---|

| DEC-005 | `P1` | Política offline de crédito: vigencia del cupo sincronizado, límite, mora y resolución de consumo concurrente. | CUST-002 y PAY-009. |
| DEC-009 | `P1` | RPO, RTO, retención de auditoría, hardware mínimo y límites de carga de referencia. | TECH-005 y criterios de salida de Fase 1. |
| DEC-010 | `P1` | Estrategia de evolución del frontend y sistema de diseño que reemplazará la interfaz estática. | UX-003 e implementación del POS. |

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
| F0.6 Decisiones críticas cerradas | `DONE` | `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-006`, `DEC-007` y `DEC-008` cerradas con evidencia verificable; `DEC-005` queda diferida como decisión `P1` y no bloquea el cierre de decisiones críticas `P0`. |
| F0.7 Preparación para diseño físico | `DONE` | Auditoría documental completada; `SYNC-001`, `SYNC-002`, `SYNC-003`, `DEV-001`, `DEV-002`, `LIC-002` y decisiones críticas aplicables consolidadas. `TECH-002` queda `READY` como entrada de Fase 1. |

La Fase 0 quedó cerrada al completarse UC-PAY-004 y UC-PAY-005, consolidarse la máquina de pagos, cerrarse las decisiones `P0` necesarias para persistencia y documentarse invariantes y pruebas mínimas coherentes para los casos críticos.

### Fase 1 — Fundación técnica ejecutable

Estado: `PLANNED`.

Objetivo: crear el núcleo multiempresa comprobable sobre límites modulares, migraciones nuevas y controles backend, sin dar por válida la implementación heredada.

| Hito | Estado | Criterio de salida |
|---|---|---|
| F1.1 Esqueleto modular y contratos | `PLANNED` | Límites de módulo verificables y lógica fuera de controladores HTTP. |
| F1.2 Modelo físico y migraciones | `PLANNED` | Tenant, empresa, sucursal, usuario, roles, auditoría, licencia y dispositivo con restricciones e índices. |
| F1.3 Seguridad e identidad | `PLANNED` | Aislamiento multi-tenant probado, sesiones revocables, MFA crítico y permisos backend. |
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

Próxima actualización obligatoria: registrar el inicio de `TECH-002` cuando comience el diseño físico de Fase 1 y mantener alineados su estado, evidencia, riesgos y trabajos dependientes.
