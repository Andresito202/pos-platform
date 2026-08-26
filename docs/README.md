# Documentación de POS Platform

Este índice contiene exclusivamente la fuente de verdad y los contratos TARGET.

## Fuente de verdad

1. `product/backlog.md` — estados, prioridades, dependencias y evidencia.
2. `adr/` — decisiones aceptadas y políticas normativas.
3. `architecture/` — contexto, módulos, ownership, persistencia e integraciones.
4. `domain/` — reglas, glosario, eventos y máquinas de estado.
5. `security/` — permisos, secretos, claves y soporte.
6. `use-cases/` — contratos funcionales.
7. `testing/` — estrategia y gates de calidad.
8. `migration/` — manifests, orden e integridad de migrations TARGET.

## Lectura recomendada para Fase 1

1. `../README.md`.
2. `product/backlog.md`.
3. `adr/ADR-005-target-technology-stack.md`.
4. `adr/DEC-010-pos-runtime.md`.
5. `architecture/system-context.md`.
6. `architecture/integration-contracts.md`.
7. `architecture/conceptual-data-model.md`.
8. `adr/DEC-007-local-first-data-authority.md`.
9. `adr/DEC-009-operational-production-baseline.md`.
10. `security/secret-key-and-support-management.md`.
11. `testing/testing-strategy.md`.
12. `migration/first-target-migration-manifest.md`.

## Capacidades especializadas

- `architecture/electronic-invoicing.md` — contrato fiscal neutral.
- `use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md` — ciclo funcional fiscal.
- `hardware/support-matrix.md` — evidencia y certificación de periféricos.

## Operación y despliegue

- `DEPLOYMENT.md` — entrada normativa de despliegue.
- `architecture/deployment-modes.md` — `HYBRID` y `LOCAL_PERPETUAL`.
- `adr/DEC-009-operational-production-baseline.md` — entornos e infraestructura pagada.

El runtime de aplicación TARGET todavía no está materializado. Ninguna documentación conceptual o evidencia de tooling debe interpretarse como una aplicación completa o lista para producción.
