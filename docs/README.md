# Documentación de Camacho POS Colombia

`Camacho POS Colombia` es el nombre comercial visible del producto. `POS Platform`, `pos-platform` y los scopes `@pos-platform/*` se conservan como identificadores técnicos internos para mantener compatibilidad, arquitectura y trazabilidad. La autoridad de esta identidad se documenta en `product/brand.md`.

## Propósito

Este índice define cómo leer la documentación TARGET y qué fuente tiene autoridad sobre cada tipo de decisión. Su objetivo es evitar que README, backlog, ADR, PRs o snapshots históricos contradigan el estado vigente.

## Estado real, con evidencia

Tres documentos miden el proyecto y **mandan sobre cualquier resumen**,
incluido el `README.md` de la raíz:

- [`governance/tablero-materializacion.md`](governance/tablero-materializacion.md)
  — 56 capacidades del producto, con su nivel y el comando que lo comprueba.
  Estructura congelada: sólo se mueve la columna del nivel.
- [`governance/stack-conformance-audit.md`](governance/stack-conformance-audit.md)
  — la lámina «STACK OBJETIVO DEFINIDO» contrastada punto por punto contra el
  árbol real.
- [`governance/materialization-state.md`](governance/materialization-state.md)
  — evidencia por capacidad y **el registro de deudas** (`D-1`…`D-18`).

Y uno que cruza producto con realidad:

- [`product/business-readiness.md`](product/business-readiness.md) — qué
  comercios de `product/business-types.md` puede atender hoy el POS, fila por
  fila.

## Jerarquía de fuentes

1. `product/backlog.md` — estado vigente del trabajo, prioridad, dependencia, bloqueo y orden inmediato.
2. `product/brand.md` — identidad comercial del producto, identificadores técnicos preservados y límites de claims.
3. `adr/` — decisiones arquitectónicas y políticas normativas aceptadas.
4. `architecture/module-map.md` y `architecture/data-ownership.md` — módulos, fronteras y ownership.
5. `architecture/` restante — topología, persistencia, integraciones y contratos físicos.
6. `domain/` — reglas, estados, eventos, glosario y motor comercial.
7. `use-cases/` — comportamiento funcional e invariantes por capacidad.
8. `security/` — permisos, secretos, gates y controles de seguridad.
9. `testing/` — estrategia, CI y criterios de evidencia.
10. `migration/` — manifests, orden y contratos de migrations TARGET.
11. `governance/repository-governance.md` — ramas, PRs, integración en `main` y evidencia remota/local.

## Regla de conflicto

Un documento histórico, comentario de PR, conversación o commit anterior no reemplaza automáticamente una fuente normativa vigente.

Si dos fuentes normativas actuales se contradicen:

1. no se implementa una interpretación arbitraria;
2. se identifica qué fuente debería ser autoridad según la jerarquía anterior;
3. se registra el bloqueo en el backlog si afecta una transición;
4. se reconcilian los documentos afectados en un cambio coherente;
5. solo después se reanuda implementación o materialización.

`DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`, `CANONICALLY_APPLIED` y `PRODUCTION_READY` son estados diferentes.

## Estado operativo vigente

- `main` es la única rama canónica.
- PR #2 integró la fundación TARGET y PR #3 retiró el runtime legacy.
- PR #5 integró el baseline inicial de supply chain y la gobernanza detectiva de `main`.
- PR #11 integró SQL/descriptor PostgreSQL 003; PR #12, límites Nx; PR #14, contratos ejecutables; PR #15, TECH-004.
- PR #6 reconcilió el estado canónico y PR #7 adoptó el nombre comercial `Camacho POS Colombia` con estado registral explícitamente pendiente.
- El merge de PR #7 quedó en `940107f8cc0976c130dd4f274928b2df248473f4`; su run post-merge #47 (`32937793013`) terminó `SUCCESS`, incluido `Main push governance = SUCCESS`.
- La branch protection preventiva nativa no está disponible para este repositorio privado con el plan GitHub actual; se documenta como limitación, no como protección existente.
- Migrations 001/002 están `MATERIALIZED / TESTED / IMMUTABLE`.
- SQL/descriptor PostgreSQL 003 y schema fiscal 003 están `INTEGRATED / GATES_CLOSED / PHYSICALLY_VALIDATED_IN_POSTGRESQL_16_14`; no están desplegados en producción y SQLite 003 continúa `NONE`.
- PR #4 y la remediación contractual autoritativa están `MERGED / CLOSED`; PR #11 integró INT-007. Providers, credenciales, sandbox y operación fiscal real siguen fuera de ese cierre.
- El runtime NestJS/Fastify, Electron/React/Vite y POS Local Service continúa `ABSENT / NOT_MATERIALIZED`.
- `SEC-G01..SEC-G10` continúan `PLANNED / NOT_EVALUATED`.

El estado detallado y la cola vigente se encuentran en `product/backlog.md`.

## Lectura recomendada para Fase 1

1. `../README.md`.
2. `product/brand.md`.
3. `product/backlog.md`.
4. `governance/repository-governance.md`.
5. `adr/ADR-005-target-technology-stack.md`.
6. `adr/DEC-010-pos-runtime.md`.
7. `architecture/module-map.md`.
8. `architecture/data-ownership.md`.
9. `architecture/system-context.md`.
10. `architecture/integration-contracts.md`.
11. `architecture/conceptual-data-model.md`.
12. `adr/DEC-007-local-first-data-authority.md`.
13. `adr/DEC-009-operational-production-baseline.md`.
14. `security/secret-key-and-support-management.md`.
15. `security/security-gates.md`.
16. `testing/testing-strategy.md`.
17. `testing/target-foundation-ci-gate.md`.
18. manifests aplicables bajo `migration/`.

## Capacidades especializadas

- `architecture/electronic-invoicing.md` — contrato fiscal neutral.
- `use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md` — ciclo funcional fiscal.
- `architecture/physical-model/external-integrations-schema.md` — foundation central de integraciones.
- `hardware/support-matrix.md` — evidencia y certificación de periféricos.

## Operación y despliegue

- `DEPLOYMENT.md` — entrada normativa de despliegue.
- `architecture/deployment-modes.md` — `HYBRID` y `LOCAL_PERPETUAL`.
- `adr/DEC-009-operational-production-baseline.md` — entornos e infraestructura pagada.
- `governance/repository-governance.md` — integración y ciclo de vida de ramas.

## Regla contra falsos avances

El runtime de aplicación TARGET todavía no está materializado. Documentación, migrations, PoC, CI o tooling no convierten por sí mismos al proyecto en una aplicación completa o lista para producción.

Los estados locales del equipo del desarrollador tampoco se deducen desde GitHub remoto; cuando no exista verificación local actual se utiliza `NOT_EVALUATED / REQUIRES_LOCAL_VERIFICATION`.
