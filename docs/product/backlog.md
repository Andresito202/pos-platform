# Backlog maestro

## Propósito y autoridad

Este archivo es la fuente de verdad del trabajo del proyecto. Consolida el estado, la prioridad, las dependencias, la evidencia y las decisiones que gobiernan el paso desde la base avícola existente hacia POS Platform.

Si otro documento de avance, una conversación o una lista informal contradice este backlog, prevalece este archivo hasta que se actualice mediante el flujo oficial.

Última actualización: 2026-08-04.

## Estado general

- Rama de trabajo verificada: `architecture/foundation`.
- Estado inicial del árbol al crear este backlog: limpio.
- Etapa actual: definición de arquitectura y dominio antes de modificar el modelo físico.
- Fase 0: `IN_PROGRESS`.
- Último trabajo completado: `PAY-007`, con estado `DONE` y prioridad `P0`.
- Siguiente trabajo aprobado y en curso: `DEC-004`, con estado `IN_PROGRESS` y prioridad `P0`; `DEC-003` quedó `DONE` con evidencia verificable.
- Los ciclos de pagos, caja y ventas, junto con la canalización versionada de pricing, quedaron documentados; `DEC-004` está en curso para separar definitivamente `ProductVariant` y `ProductPresentation`.
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
| SEC-002 | `P0` | `PLANNED` | Definir permisos atómicos, políticas ABAC y pruebas negativas por módulo. | La matriz declara esta evolución pendiente. |
| SEC-003 | `P0` | `PLANNED` | Implementar aislamiento de tenant, sesiones revocables, MFA y reautenticación. | Fase 1; depende de ONB-002 y DEV-001. |
| SEC-004 | `P1` | `PLANNED` | Definir gestión de secretos, firma de licencias/actualizaciones y acceso temporal de soporte. | Depende de LIC-002 y DEV-002. |

### Catálogo

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| CAT-001 | `P0` | `DONE` | Definir producto, actualización, identificadores, variantes, presentaciones y conversiones. | `docs/use-cases/catalog/` |
| CAT-002 | `P1` | `PLANNED` | Alinear el modelo conceptual de variante/presentación y diseñar persistencia física. | Requiere DEC-004. |
| CAT-003 | `P1` | `PLANNED` | Implementar catálogo multiempresa con unidades, códigos y snapshots. | Fase 1; depende de ARCH-003 y SEC-003. |
| CAT-004 | `P3` | `DEFERRED` | Especializaciones regulatorias de droguería. | Fase especializada según `docs/product/business-types.md`. |

### Precios

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| PRICE-001 | `P0` | `DONE` | Definir programación y resolución determinista de precios. | `docs/use-cases/pricing/UC-PRICE-001-schedule-price.md`, `docs/use-cases/pricing/UC-PRICE-002-resolve-sale-price.md` |
| PRICE-002 | `P0` | `PLANNED` | Cerrar el orden definitivo entre precio base, precio promocional, descuentos e impuestos. | Requiere DEC-003. |
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
| TAX-003 | `P0` | `PLANNED` | Resolver empate de redondeo y política de conciliación fiscal. | Requiere DEC-006. |
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
| INV-002 | `P0` | `PLANNED` | Definir reservas, salidas, ajustes, mermas, traslados, lotes, vencimientos y concurrencia. | Reglas iniciales: `docs/domain/business-rules.md`. |
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
| ONB-001 | `P0` | `PLANNED` | Definir creación de tenant, empresa, primera sucursal, propietario y configuración inicial. | Depende de SEC-002 y LIC-002. |
| ONB-002 | `P0` | `PLANNED` | Diseñar bootstrap transaccional, idempotente y auditable. | Depende de ONB-001 y TECH-002. |
| ONB-003 | `P2` | `PLANNED` | Definir importación masiva y migración asistida de datos. | Depende de CAT-003, CUST-003 y PUR-002. |

### Licencias

Estado de la épica: `IN_PROGRESS`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| LIC-001 | `P0` | `DONE` | Definir validación de licencia híbrida y local perpetua. | `docs/use-cases/licensing/UC-LIC-001-validate-license.md` |
| LIC-002 | `P0` | `PLANNED` | Definir emisión, firma, activación, renovación, gracia, suspensión y reactivación. | Requiere DEC-008. |
| LIC-003 | `P1` | `PLANNED` | Implementar derechos por módulos, límites y dispositivos sin pérdida de datos. | Fase 1; depende de LIC-002 y DEV-002. |

### Dispositivos

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| DEV-001 | `P0` | `PLANNED` | Definir registro, aprobación, vínculo, sesión, revocación y recuperación de dispositivo. | Concepto en `docs/architecture/conceptual-data-model.md`; no existe caso de uso dedicado. |
| DEV-002 | `P0` | `PLANNED` | Definir identidad segura del POS y contrato con licencias. | Depende de DEV-001 y LIC-002. |
| DEV-003 | `P2` | `PLANNED` | Implementar adaptadores de lector, impresora, cajón y balanza. | Depende de ARCH-004 y matriz de hardware pendiente. |

### Sincronización

Estado de la épica: `PLANNED`.

| ID | Prioridad | Estado | Trabajo | Dependencias / evidencia |
|---|---|---|---|---|
| SYNC-001 | `P0` | `PLANNED` | Definir identidad global, outbox, idempotencia, orden y contrato de sincronización. | Principios: `docs/adr/ADR-003-local-first.md`. |
| SYNC-002 | `P0` | `PLANNED` | Definir versiones de configuración y disponibilidad offline por módulo. | Depende de SYNC-001. |
| SYNC-003 | `P0` | `PLANNED` | Definir conflictos, reintentos, recuperación, reloj incorrecto y observabilidad. | Depende de SYNC-001 y DEC-007. |
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
| TECH-002 | `P0` | `PLANNED` | Diseñar modelo físico nuevo, migraciones, restricciones, índices y fronteras de transacción. | Debe seguir `docs/migration/avicola-baseline-migration.md`; no se reescribe silenciosamente la migración original. |
| TECH-003 | `P0` | `PLANNED` | Definir contratos API, errores, idempotency keys, versionado y correlación. | Depende de casos de uso de Fase 0. |
| TECH-004 | `P0` | `PLANNED` | Crear pipeline CI con lint, tipos, pruebas, seguridad y validación de migraciones. | Requisitos en `docs/testing/testing-strategy.md`; no hay evidencia de pipeline objetivo terminado. |
| TECH-005 | `P1` | `PLANNED` | Definir observabilidad, backups, restauración, actualización y rollback por modalidad. | Requiere DEC-007 y objetivos RNF pendientes. |
| TECH-006 | `P1` | `PLANNED` | Establecer datos de prueba, fixtures multi-tenant y pruebas de concurrencia/recuperación. | Depende de TECH-002 y TECH-004. |

## Orden inmediato de trabajo

1. `DEC-004` — `P0`, `IN_PROGRESS`: separar definitivamente `ProductVariant` y `ProductPresentation` en glosario, modelo conceptual y persistencia.
2. Resolver después las decisiones `P0` restantes que bloquean persistencia: `DEC-006`, `DEC-007` y `DEC-008`.
3. Reevaluar `TECH-002` y `TECH-003` después de cerrar las decisiones documentales de persistencia, catálogo, redondeo, sincronización y seguridad.


No se inicia implementación de la arquitectura objetivo mientras los invariantes que afectan transacciones, estados y persistencia sigan abiertos en esta secuencia.

## Riesgos abiertos

| ID | Severidad | Riesgo | Mitigación / condición de cierre |
|---|---|---|---|
| R-001 | Alta | Confundir la base avícola existente con la arquitectura objetivo puede perpetuar acceso global, lógica acoplada y modelo monoempresa. | Migrar caso por caso según `docs/migration/avicola-baseline-migration.md`; no declarar módulos objetivo `DONE` por la existencia del código heredado. |
| R-002 | Baja | Riesgo residual de que la implementación física vuelva a mezclar estados persistentes, proyecciones y estados de agregados diferentes. | DEC-001 cerrado mediante `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`; validar el modelo físico y las migraciones contra estos documentos antes de aprobar `TECH-002`. |
| R-003 | Alta | Pagos mixtos con proveedores externos no tienen atomicidad distribuida y pueden producir doble cobro o compensaciones pendientes. | Estados explícitos, idempotencia, incidencias y pruebas de respuestas tardías. |
| R-004 | Alta | El aislamiento multi-tenant está definido pero no probado en la base objetivo. | SEC-003 y pruebas negativas obligatorias antes de datos reales. |
| R-005 | Alta | La operación local-first aún no tiene protocolo de sincronización ni política completa de conflictos. | SYNC-001 a SYNC-004, pruebas de duplicados, orden, recuperación y reloj incorrecto. |
| R-006 | Alta | No hay modelo físico objetivo; modificar la migración heredada antes de cerrar decisiones puede fijar errores de dominio. | TECH-002 después de PAY-007 y decisiones críticas. |
| R-007 | Media | El orden de precios, promociones, descuentos, impuestos y redondeo aparece conceptual pero requiere una única versión ejecutable. | Resolver DEC-003 y cubrir la canalización con pruebas deterministas. |
| R-008 | Media | RPO, RTO, retención, volúmenes, concurrencia y tiempos de sincronización siguen sin benchmark. | Medir y aprobar objetivos antes de comprometer SLA. |
| R-009 | Media | Hardware, Windows y operación offline carecen de una matriz de equipos y pruebas reales. | Definir matriz, simuladores y laboratorio antes de certificar compatibilidad. |
| R-010 | Media | Facturación electrónica y droguería pueden introducir requisitos regulatorios que alteren snapshots, impuestos o trazabilidad. | Mantenerlos `DEFERRED` hasta una fase especializada y validación normativa. |
| R-011 | Media | El frontend HTML actual está previsto para reemplazo y no demuestra accesibilidad ni navegación final por rol. | UX-002 a UX-004 antes de adopción operativa. |
| R-012 | Media | Firma, custodia de claves y recuperación de licencias/dispositivos no están definidas a nivel operativo. | LIC-002, DEV-001, DEV-002 y SEC-004. |

## Decisiones cerradas

| ID | Prioridad | Decisión cerrada | Evidencia | Consecuencia |
|---|---|---|---|---|
| DEC-001 | `P0` | Taxonomía definitiva de estados de pagos, intentos, refunds, reversals, liquidaciones, conciliaciones, contracargos, revisión e incidencias; transiciones, terminalidad y proyecciones derivadas. | `docs/domain/payment-state-model.md` y `docs/domain/payment-lifecycle.md`. | `PAY-007` queda `DONE`; `PaymentStatus` no incorpora estados de refund, reversal, settlement, reconciliation ni chargeback. El diseño físico deberá mantener agregados, estados, eventos y proyecciones separados. |
| DEC-002 | `P0` | Política predeterminada para pagos inferiores, sobrepagos, fallos parciales y compensaciones entre efectivo y proveedores externos. | `docs/adr/DEC-002-payment-compensation-policy.md`. | `CASH-003` y `SALES-002` quedan desbloqueados documentalmente; caja, ventas y pagos deben conservar componentes independientes, operaciones compensatorias, idempotencia, control de concurrencia y trazabilidad append-only. |
| DEC-003 | `P0` | Orden único y versionado de precio base, precio promocional, promociones, descuentos, impuestos y redondeo mediante `PRICING_PIPELINE_V1`. | `docs/adr/DEC-003-pricing-calculation-order.md`. | `PRICE-002` y `SALES-003` quedan desbloqueados documentalmente, aunque `DEC-006` todavía debe cerrar la regla exacta de redondeo `NEAREST_50`; toda implementación debe conservar snapshots inmutables, decimal exacto, algoritmos versionados y separación entre pricing y cobertura. |

## Decisiones en curso

| ID | Prioridad | Decisión requerida | Estado | Evidencia esperada | Bloquea |
|---|---|---|---|---|---|
| DEC-004 | `P0` | Separación definitiva entre `ProductVariant` y `ProductPresentation` en glosario, modelo conceptual y persistencia. | `IN_PROGRESS` | ADR con definiciones, identidad, cardinalidad, atributos, SKU, códigos de barras, unidades, conversiones, inventario, pricing, impuestos, migración e invariantes. | `CAT-002` y `TECH-002`. |

## Decisiones pendientes

| ID | Prioridad | Decisión requerida | Bloquea |
|---|---|---|---|

| DEC-005 | `P1` | Política offline de crédito: vigencia del cupo sincronizado, límite, mora y resolución de consumo concurrente. | CUST-002 y PAY-009. |
| DEC-006 | `P0` | Regla de empate para `NEAREST_50`, normalización de fracciones y conciliación con total fiscal. | TAX-003 y SALES-003. |
| DEC-007 | `P0` | Autoridad por dato, resolución de conflictos, reloj confiable, retención de outbox y recuperación en local-first. | SYNC-003 y TECH-005. |
| DEC-008 | `P0` | Jerarquía de firma, almacenamiento de claves, activación offline, reemplazo de dispositivo y alcance de gracia. | LIC-002 y DEV-002. |
| DEC-009 | `P1` | RPO, RTO, retención de auditoría, hardware mínimo y límites de carga de referencia. | TECH-005 y criterios de salida de Fase 1. |
| DEC-010 | `P1` | Estrategia de evolución del frontend y sistema de diseño que reemplazará la interfaz estática. | UX-003 e implementación del POS. |

## Hitos

### Fase 0 — Fundación de producto, arquitectura y dominio

Estado: `IN_PROGRESS`.

Objetivo: cerrar las decisiones y contratos conceptuales necesarios para diseñar la arquitectura objetivo sin modificar prematuramente modelos, frontend o infraestructura.

| Hito | Estado | Criterio / evidencia |
|---|---|---|
| F0.1 Producto y alcance | `DONE` | Documentos bajo `docs/product/` indicados en la evidencia, incluido este backlog. |
| F0.2 Arquitectura y ADR iniciales | `DONE` | `docs/architecture/` y `docs/adr/`. |
| F0.3 Dominio, seguridad, pruebas y migración | `DONE` | `docs/domain/`, `docs/security/permission-matrix.md`, `docs/testing/testing-strategy.md`, `docs/migration/avicola-baseline-migration.md`. |
| F0.4 Casos comerciales y operativos iniciales | `DONE` | Casos existentes bajo `docs/use-cases/`, salvo los huecos explícitos de pagos. |
| F0.5 Secuencia completa de pagos | `DONE` | UC-PAY-001, 002, 003, 004, 005 y 006 están documentados, y `PAY-007` armoniza los estados en `docs/domain/payment-state-model.md`. |
| F0.6 Decisiones críticas cerradas | `IN_PROGRESS` | `DEC-001`, `DEC-002` y `DEC-003` cerradas; `DEC-004` está `IN_PROGRESS`; permanecen abiertas `DEC-005`, `DEC-006`, `DEC-007` y `DEC-008`. |
| F0.7 Preparación para diseño físico | `PLANNED` | Estados y contratos coherentes, dependencias trazadas y ningún `P0` documental bloqueante. |

La Fase 0 termina cuando UC-PAY-004 y UC-PAY-005 estén `DONE`, la máquina de pagos esté consolidada, las decisiones `P0` necesarias para persistencia estén cerradas y los casos críticos tengan invariantes y pruebas mínimas coherentes.

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

## Regla de actualización del backlog

1. Todo cambio de alcance, estado, prioridad o dependencia debe actualizar este archivo en el mismo cambio que introduce la evidencia o descubre el impedimento.
2. Cada elemento movido a `DONE` debe incluir al menos una ruta real y verificable; si la evidencia desaparece o deja de cumplir el criterio, el elemento sale de `DONE`.
3. Al iniciar trabajo, se registra `IN_PROGRESS`; al bloquearse, se registra causa y condición de desbloqueo; al diferirse o excluirse, se registra la decisión de alcance.
4. La actualización debe revisar también orden inmediato, riesgos, decisiones e hitos afectados; no se actualizan estados de forma aislada.
5. No se marcan como terminadas capacidades objetivo por existir únicamente en la base heredada, en HTML estático, en una descripción conceptual o en código sin pruebas suficientes.
6. Un nuevo caso de uso debe respetar identificador, épica, prioridad, dependencias, invariantes, permisos, idempotencia, auditoría, offline y pruebas mínimas cuando apliquen.
7. Antes de cerrar un cambio del backlog se ejecutan, como mínimo, `git diff --check` y la validación relevante al artefacto modificado.
8. Este archivo se mantiene en UTF-8 y conserva una única cola ordenada de trabajo inmediato.

Próxima actualización obligatoria: al cerrar `DEC-004`, moverla a decisiones cerradas con evidencia verificable, habilitar `CAT-002` y reducir los bloqueos de `TECH-002`; después continuar con `DEC-006`, `DEC-007` y `DEC-008`.
