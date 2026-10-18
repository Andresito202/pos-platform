# Auditoría y depuración de ramas — 2026-09-16

> Alcance de lectura — 2026-10-17. El censo de 68 refs y sus distancias pertenece al 2026-09-16. El inventario remoto actual (17 refs al corte auditado), las disposiciones y las dependencias de PR están en el backlog; los números inferiores no son el inventario vigente. Consultar [reconciliación operativa](../product/backlog.md) para la cola actual. Esta nota no elimina evidencia histórica ni certifica tests nuevos.

> Los prefijos de proveedor se retiraron por solicitud del propietario. Las etiquetas históricas abreviadas se identifican por sus SHAs y PR; no son nombres completos de rama.

## Veredicto

Se auditaron los **68 refs existentes antes de esta auditoría** comparándolos contra la línea activa [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92).

Resultado de la comparación Git:

- **1 línea activa:** [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92).
- **57 ramas con `ahead_by=0`:** todos sus commits están contenidos en la línea activa; no representan una implementación distinta que deba mantenerse activa.
- **10 ramas divergentes:** contienen commits que no están en la línea activa y por eso no se borran ni se consideran automáticamente inútiles; se clasifican por contenido abajo.
- `main` permanece como rama canónica del producto y no se considera una línea de implementación paralela.

Durante esta auditoría se crearon accidentalmente dos refs auxiliares (`_audit-temp` y `audit/branch-deprecation-record`) mientras se intentaba preparar la operación. Ambos parten del estado canónico y **no contienen una implementación alternativa**. El conector disponible no expone una operación de borrado de refs; por tanto no se simula su eliminación. Quedan marcados como `ABORTED_AUDIT_REF`, no como líneas de desarrollo.

## Regla de interpretación

`ahead_by=0` frente a la línea activa significa que el tip de esa rama es ancestro/contenido de la línea activa: su código ya está representado en la línea activa.

Eso permite retirar la rama como línea de trabajo **sin perder sus commits del historial**.

`ahead_by>0` significa que existe trabajo que no está en la línea activa. Ese trabajo debe auditarse por contenido antes de retirarlo.

## Línea activa

### [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92)

**Estado:** `ACTIVE / CANONICAL IMPLEMENTATION LINE`

HEAD inicial de la auditoría:

`bf39de720904f0b4aecf3541515c5b84cdb67f44`

Posteriormente se añadieron únicamente documentos de gobernanza:

- `54c3a57acdf1004e85bc64b926ace5ba848a2f6d`
- `7690845c6787ab60af5360dcc85f61fdd5a61b19`

No se crea otra línea para continuar Payment/Cash/Sale/Inventory/Sync.

---

# Ramas divergentes — requieren disposición explícita

## 1. `fix/runtime-status-envelope`

**Comparación:** `ahead_by=21`, `behind_by=42`.

**Relación:** corresponde al head de PR #79.

**Contenido único:** Payment + Cash + Sale, tendered cash, identifier snapshot, checksum, runtime status, auditorías y un `central-sync-server`.

**Disposición:** `HISTORICAL_EVIDENCE / SELECTIVE_INTEGRATION_ONLY`.

No se integra como bloque. Parte de su contenido ya fue incorporado selectivamente en otras líneas y parte requiere nueva verificación contra el estado actual. El PR #79 fue cerrado para eliminar la línea paralela. Su historial se conserva.

## 2. `feat/selective-pr79-payment-cash-sale`

**Comparación:** `ahead_by=4`, `behind_by=3`.

**Relación:** PR #81.

**Contenido único:** integración selectiva de Payment/Sale/Sync, incluyendo tendered cash, identifier snapshot, checksum y runtime status.

**Disposición:** `HISTORICAL_EVIDENCE / SELECTIVE_INTEGRATION_ONLY`.

No es línea activa. PR #81 fue cerrado. Antes de reutilizar cualquier cambio se debe comprobar si ya existe en [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92) y ejecutar regresión.

## 3. `sale-cash-shift-binding` (etiqueta histórica)

**Comparación:** `ahead_by=1`, `behind_by=70`.

**Commit único:** `940f5d70ed340ebd0ce998a60a0b90081ee3fefe`.

**Hallazgo:** el commit tiene evidencia fuerte de ejecución: typecheck, architecture check, repository policy y 1026 pruebas con 0 fallos en su fecha. Sin embargo, implementa resolución Sale→Cash por `origin_device_id` mediante `findOpenShiftForDevice`.

**Contradicción actual:** DEC-012/FZ-002 establece que el selector confiable es `cash_register_id` y que `origin_device_id` no es ownership del turno.

**Disposición:** `HISTORICAL_EVIDENCE / DO_NOT_INTEGRATE_AS_IS`.

La prueba vertical es valiosa como evidencia de una juntura que debe existir, pero debe adaptarse al contrato vigente; no se copia la implementación que contradice la decisión ratificada. PR #82 fue cerrado.

## 4. `fiscal-adapter-gate` (etiqueta histórica)

**Comparación:** `ahead_by=2`, `behind_by=134`.

**Contenido único:** documentación del gate fiscal multi-proveedor.

**Disposición:** `HISTORICAL_DOCUMENTATION / NO_PARALLEL_IMPLEMENTATION`.

El trabajo fiscal no se reabre desde esta rama. La investigación y decisiones que ya estén reflejadas en el árbol activo son la fuente. Si algún documento único sigue faltando, se extrae como documentación, no como rama de código.

## 5. `handler-response-typing` (etiqueta histórica)

**Comparación:** `ahead_by=1`, `behind_by=70`.

**Commit:** `ad7c711a339c7f98352cc9a97a9edc4ac8e067ff`.

**Contenido:** tipado de las respuestas del `CommercialRequestHandler` contra contratos y corrección de una divergencia latente en `RegisterTransferPaymentResult`.

**Evidencia histórica:** typecheck, architecture check, repository policy y 1021 pruebas con 0 fallos en 2026-09-11.

**Disposición:** `EVIDENCE / POTENTIALLY USEFUL, NOT REIMPLEMENTED`.

El árbol activo ya tiene una versión más reciente del handler con operaciones fiscales y Receipt. No se reemplaza el archivo completo por la rama antigua. Si el guard de tipos aún falta en la versión actual, se extrae únicamente ese delta y se prueba sobre la línea activa.

## 6. `ledger-wip-lineage-correction` (etiqueta histórica)

**Comparación:** `ahead_by=1`, `behind_by=133`.

**Contenido único:** cambios documentales en DEC-017/materialization state.

**Disposición:** `HISTORICAL_DOCUMENTATION / NO CODE LINE`.

No se usa para implementación.

## 7. `wip/sql003-contract-gap-20260825`

**Comparación:** `ahead_by=1`, `behind_by=588`.

**Contenido:** SQL003 y tooling de migración fiscal en estado WIP.

**Disposición:** `HISTORICAL_WIP / DO NOT INTEGRATE`.

SQL003 ya tiene una línea posterior y evidencia de cierre. Esta rama existe como antecedente del contrato-gap; no debe reabrirse para modificar migraciones actuales.

## 8. `wip/local-catalog-inventory-payment-20260906`

**Comparación:** `ahead_by=21`, `behind_by=206`.

**Contenido:** una implementación alternativa mucho más amplia de Domain/Application/Database, Cash, Catalog, Inventory, Payment y migraciones 004–006.

**Disposición:** `HISTORICAL_ALTERNATIVE / DO NOT INTEGRATE WHOLE`.

Es una línea arquitectónica paralela y demasiado divergente. No se copia wholesale. Si alguna decisión o prueba concreta fuese necesaria, se audita de forma puntual contra la arquitectura vigente.

## 9. `domain/cash-open-vertical-20260901`

**Comparación:** `ahead_by=20`, `behind_by=206`.

**Contenido:** otra línea amplia de Domain/Application/Database para Cash/Catalog/Inventory y migraciones.

**Disposición:** `HISTORICAL_ALTERNATIVE / DO NOT INTEGRATE WHOLE`.

No se revive. Sirve como evidencia comparativa si aparece un defecto que obligue a revisar una decisión, nunca como segunda implementación.

## 10. `main`

**Comparación:** `ahead_by=1`, `behind_by=42`.

**Contenido único respecto de la línea activa:** `tools/target-migrations/src/central-sync-gate.ts`.

**Disposición:** `CANONICAL_PRODUCT_BRANCH / PRESERVE`.

`main` no se considera una rama competidora. Sigue siendo la autoridad del producto integrado. Su commit único respecto de la línea activa debe conservarse y no se debe intentar convertir `main` en la línea diaria de implementación.

---

# Ramas cuyo tip ya está contenido en la línea activa

Todas las siguientes tienen `ahead_by=0` frente a [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92). Por tanto, **no contienen una implementación que falte en la línea activa**.

Su estado pasa a `INTEGRATED / HISTORICAL — CANDIDATE FOR REF DELETION`.

- `architecture/executable-boundaries-20260828`
- `architecture/foundation`
- `architecture/physical-model`
- `audit/main-governance-reconciliation-20260826`
- `brand/canonical-identity-assets-20260826`
- `ci/supply-chain-baseline-20260826`
- `audit-figures-and-dead-constant` (etiqueta histórica)
- `catalog-authorization-pack` (etiqueta histórica)
- `d8-preserved-lineage-disposition` (etiqueta histórica)
- `dec012-catalog-authorization` (etiqueta histórica)
- `dec017-architecture-ratification` (etiqueta histórica)
- `dian-reference-codes` (etiqueta histórica)
- `factus-adapter` (etiqueta histórica)
- `factus-nullable-fields` (etiqueta histórica)
- `factus-paginated-ranges` (etiqueta histórica)
- `factus-sandbox-diagnostics` (etiqueta histórica)
- `fiscal-capability-ports` (etiqueta histórica)
- `inventory` (etiqueta histórica)
- `ledger-transport-correction` (etiqueta histórica)
- `merge-governance-rule` (etiqueta histórica)
- `payment-wire-routing` (etiqueta histórica)
- `per-port-verification` (etiqueta histórica)
- `pos-platform-a7f38u` (etiqueta histórica)
- `pos-platform-repo-switch-02opws` (etiqueta histórica)
- `posix-process-test-contract` (etiqueta histórica)
- `provider-payload-research` (etiqueta histórica)
- `sale-cash-shift-binding-fixed` (etiqueta histórica)
- `self-describing-shape-mismatch` (etiqueta histórica)
- `skills-truth-pass` (etiqueta histórica)
- `stability-sweep` (etiqueta histórica)
- `strix-configuration-gate` (etiqueta histórica)
- `strix-required-vars-fix` (etiqueta histórica)
- `vulnerability-gate` (etiqueta histórica)
- `cleanup/pure-pos-platform-20260825`
- `design/sql003-contract-reconciliation-20260826`
- `docs/backlog-rt008-integrated-20260903`
- `docs/camacho-pos-colombia-branding-20260826`
- `docs/canonical-state-reconciliation-20260826`
- `docs/dec010-empaquetador-electron-builder-nsis-20260903`
- `docs/dec011-authorization-projection-sas-20260903`
- `docs/governance-self-review-policy-20260901`
- `docs/int006-post-merge-backlog-reconciliation-20260826`
- `docs/int007-post-merge-closure-20260828`
- `docs/readme-backlog-rt006-reconciliation-20260901`
- `docs/runtime-readiness-reconciliation-20260828`
- `docs/sql003-authoritative-contract-remediation-20260826`
- `docs/tech004-postmerge-closure-20260828`
- `feat/peer-identity-real-channel`
- `feat/receipt-projection`
- `feat/security-lifecycle-boot`
- `feat/sql003-v2-materialization-20260826`
- `governance-electron-ci`
- `runtime/durable-sync-rt005-20260828`
- `runtime/local-foundation-rt001-004-20260828`
- `runtime/vertical-slice-rt006-20260901`
- `tech/tech003-executable-contracts-20260828`
- `tech/tech004-quality-supply-chain-20260828`

## Excepción importante: `sale-cash-shift-binding-fixed` (etiqueta histórica)

Está contenida y por tanto no tiene delta pendiente. No se debe confundir con `sale-cash-shift-binding` (etiqueta histórica): la primera ya está incorporada; la segunda contiene el commit histórico que contradice el selector de caja vigente.

---

# Reglas para retirar físicamente las ramas

1. Una rama `INTEGRATED` no se reutiliza.
2. Una rama `HISTORICAL_WIP` no se reutiliza.
3. Una rama `DIVERGED` no se elimina hasta registrar su disposición.
4. PRs paralelos cerrados permanecen como historial.
5. El borrado de refs es una operación de mantenimiento independiente.
6. No se hace force-push para simular un borrado.
7. No se borra un commit único antes de verificar que la información que contiene está conservada en otra referencia o documento.

El conector utilizado para esta auditoría no expone una operación de `DELETE refs`. Por eso la depuración realizada aquí cierra las líneas de PR duplicadas y documenta la disposición, pero **no inventa un borrado físico de ramas que no puede ejecutar**.

## Resultado operativo

Desde este registro:

> **NO SE DESARROLLA EN NINGUNA DE LAS RAMAS ANTERIORES.**
>
> El único lugar donde se implementa es [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92).
>
> Todo lo demás es evidencia, historial o producto integrado.

Cualquier agente que reciba una tarea debe comprobar primero este documento y `docs/governance/canonical-development-line.md`.
