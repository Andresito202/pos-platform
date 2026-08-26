# Documentación de POS Platform

## Propósito

Este índice define cómo leer la documentación TARGET y qué fuente tiene autoridad sobre cada tipo de decisión. Su objetivo es evitar que README, backlog, ADR, PRs o snapshots históricos contradigan el estado vigente.

## Jerarquía de fuentes

1. `product/backlog.md` — estado vigente del trabajo, prioridad, dependencia, bloqueo y orden inmediato.
2. `adr/` — decisiones arquitectónicas y políticas normativas aceptadas.
3. `architecture/module-map.md` y `architecture/data-ownership.md` — módulos, fronteras y ownership.
4. `architecture/` restante — topología, persistencia, integraciones y contratos físicos.
5. `domain/` — reglas, estados, eventos, glosario y motor comercial.
6. `use-cases/` — comportamiento funcional e invariantes por capacidad.
7. `security/` — permisos, secretos, gates y controles de seguridad.
8. `testing/` — estrategia, CI y criterios de evidencia.
9. `migration/` — manifests, orden y contratos de migrations TARGET.
10. `governance/repository-governance.md` — ramas, PRs, integración en `main` y evidencia remota/local.

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
- PR #2 integró la fundación TARGET.
- PR #5 integró el baseline de supply chain y la gobernanza detectiva de `main`.
- El run post-merge #40 (`32933559784`) sobre `bfca119b27f9b4bf0a7b0541708161a2beb2833d` terminó `SUCCESS`, incluido `Main push governance = SUCCESS`.
- La branch protection preventiva nativa no está disponible para este repositorio privado con el plan GitHub actual; se documenta como limitación, no como protección existente.
- Migrations 001/002 están `MATERIALIZED / TESTED / IMMUTABLE`.
- SQL/descriptor 003 y schema fiscal 003 continúan ausentes; migration 003 está `NOT_MATERIALIZED`.
- PR #4 es una reconciliación contractual draft y permanece bloqueada por revisión independiente no disponible por cuota; no autoriza SQL003.
- El runtime NestJS/Fastify, Electron/React/Vite y POS Local Service continúa `ABSENT / NOT_MATERIALIZED`.
- `SEC-G01..SEC-G10` continúan `PLANNED / NOT_EVALUATED`.

El estado detallado y la cola vigente se encuentran en `product/backlog.md`.

## Lectura recomendada para Fase 1

1. `../README.md`.
2. `product/backlog.md`.
3. `governance/repository-governance.md`.
4. `adr/ADR-005-target-technology-stack.md`.
5. `adr/DEC-010-pos-runtime.md`.
6. `architecture/module-map.md`.
7. `architecture/data-ownership.md`.
8. `architecture/system-context.md`.
9. `architecture/integration-contracts.md`.
10. `architecture/conceptual-data-model.md`.
11. `adr/DEC-007-local-first-data-authority.md`.
12. `adr/DEC-009-operational-production-baseline.md`.
13. `security/secret-key-and-support-management.md`.
14. `security/security-gates.md`.
15. `testing/testing-strategy.md`.
16. `testing/target-foundation-ci-gate.md`.
17. manifests aplicables bajo `migration/`.

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
