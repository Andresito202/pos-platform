# End-of-day checkpoint — SQL 003 contract gap

## Fecha, propósito y condición de esta rama

- Fecha: 2026-08-25 (`America/Bogota`).
- Propósito: preservar de forma remota y recuperable el candidato estático SQL 003 que todavía no está aprobado, junto con el resultado bloqueante de su revisión contractual.
- Rama WIP: `wip/sql003-contract-gap-20260825`.
- Rama canónica de trabajo: `architecture/physical-model`.
- HEAD base: `cb1dafdc987104a5fdc75034de833df157cbfe67`.

Esta rama WIP no es canónica y no debe fusionarse directamente. Los ocho archivos preservados no están aprobados. No debe hacerse cherry-pick ni merge completo sin remediación y revisión independientes. `architecture/physical-model` continúa siendo la rama canónica de trabajo.

## Relación con `origin/main`

La relación se obtuvo después de `git fetch --prune origin`, sin pull, merge, rebase ni reset:

- `origin/main`: `9fc31a7f90a2844801b434b85a4706c6c43fcf12`.
- `architecture/physical-model`: `cb1dafdc987104a5fdc75034de833df157cbfe67`.
- Merge-base: `9fc31a7f90a2844801b434b85a4706c6c43fcf12`.
- `git rev-list --left-right --count origin/main...architecture/physical-model`: `0 38`.
- `origin/main` es ancestro de `architecture/physical-model`: sí.
- `architecture/physical-model` es ancestro de `origin/main`: no.
- Diagnóstico: no hay divergencia; la rama de trabajo contiene 38 commits adicionales sobre `origin/main`.
- Esta comprobación fue exclusivamente informativa. No se integró ninguna rama y `main` no fue modificada.

## Archivos preservados y SHA-256

Los ocho archivos existentes antes de crear este checkpoint son:

| Ruta | SHA-256 |
|---|---|
| `tools/target-migrations/src/contract.ts` | `23dcae6c4189347c3783f2d5b72931d51be92af2e131cdd8b48dfbcf3d1c8660` |
| `tools/target-migrations/src/index.ts` | `0ef2b79250ee69bb2f722d5d07a0e5025058d6793d09a31e766d2e933271eb2b` |
| `tools/target-migrations/src/postgres-introspection.ts` | `759f6790c2225d3d3c6548d2b6b99f7943f53f706e0a2122c8f1c0186c1de6ec` |
| `tools/target-migrations/src/postgres.ts` | `db6ebc4bb8f77984fac096c09ef643e286d0c021019be0e0bb12a6587babd9c9` |
| `tools/target-migrations/src/shared.ts` | `cb21cda44d75a101a28257b385aab3f8d6f617ef4153a8ab3d29ac346de7621d` |
| `tools/target-migrations/sql/postgres/003_fiscal_electronic_invoicing_foundation.down.sql` | `a434fa3b582a023092a65f39a6b36b64d46e40aaa0fa9e4ede1e24125581de23` |
| `tools/target-migrations/sql/postgres/003_fiscal_electronic_invoicing_foundation.up.sql` | `9d83452f8f8e16c9037addfec30c6ef7deb61ec70e960587780c2268840da0bb` |
| `tools/target-migrations/tests/postgres-003-static.test.ts` | `124612910e3b2769d978769203b8e96f0f9c77e1df6e336c4e11901b730d9c37` |

Hashes específicos del SQL 003:

- UP: `9d83452f8f8e16c9037addfec30c6ef7deb61ec70e960587780c2268840da0bb`.
- DOWN: `a434fa3b582a023092a65f39a6b36b64d46e40aaa0fa9e4ede1e24125581de23`.

## Estado del candidato SQL 003

- `STATIC CANDIDATE`.
- `UNREVIEWED`.
- `NOT TESTED`.
- `NOT APPROVED`.
- `NOT APPLIED`.
- `NOT FOR MERGE`.

Los resultados de revisiones distintas se conservan por separado y no se suman como si describieran necesariamente hallazgos únicos:

- Revisión estática SQL: `HIGH=5`, `MEDIUM=2`.
- Revisión contractual actual: `HIGH=3`.
- Riesgo LOW heredado conocido: `related_id` como desempate diagnóstico final.

## Estado contractual fiscal

Resultado: `BLOCKED_BY_CONTRACT_GAP`.

### HIGH-001 — Componente mutable en la clave lógica

- Fuente: propuesta contractual, fórmula de `logical_operation_key`; `docs/migration/third-target-migration-manifest.md:661`; SQL UP candidato, líneas 407 y 464.
- Contrato esperado: una clave lógica estable, determinista y versionada solo puede incorporar campos inmutables.
- Contradicción: `correction_source_reference` forma parte de la fórmula propuesta, pero puede actualizarse durante `DRAFT`.
- Impacto: una misma intención puede recibir raíces diferentes según el momento de cálculo, rompiendo deduplicación y trazabilidad.
- Remediación requerida: decidir entre retirarlo de la fórmula o volverlo realmente inmutable y reconciliar permisos y guards. No elegir implícitamente en SQL.

### HIGH-002 — Ruta de retry desde `FAILED` inalcanzable

- Fuente: propuesta contractual, semántica de `started_at` y retry; SQL UP candidato, línea 413; `docs/migration/third-target-migration-manifest.md:716` y `:764`.
- Contrato esperado: todo retry permitido debe partir de un estado alcanzable que pruebe ausencia de transmisión.
- Contradicción: `CREATED -> IN_PROGRESS` fija `started_at`; `FAILED` solo es alcanzable desde `IN_PROGRESS`; simultáneamente se pretende permitir retry desde `FAILED` únicamente con `started_at IS NULL`.
- Impacto: implementaciones diferentes pueden repetir o bloquear de forma incompatible una emisión fiscal.
- Remediación requerida: definir una transición pre-transporte alcanzable, evidencia separada de entrega al transporte o restringir expresamente retry a `CANCELLED` previo al inicio.

### HIGH-003 — Alcance de consulta y recuperación no reconciliado

- Fuente: `docs/architecture/physical-model/electronic-invoicing-schema.md:176`, `:228` y `:415`; `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md:199`; `docs/migration/third-target-migration-manifest.md:533`, `:769` y `:772`; `docs/architecture/integration-contracts.md:123`.
- Contrato esperado: todas las fuentes deben coincidir sobre el alcance y ownership de submit, consulta, polling, reconciliación y recuperación.
- Contradicción: se propone `SUBMIT_DOCUMENT` como único `operation_type` de 003, mientras fuentes autoritativas vigentes contemplan consulta y recuperación asociadas a attempts/reconciliación sin un estrechamiento contractual expreso.
- Impacto: dos implementadores razonables pueden materializar alcances incompatibles.
- Remediación requerida: aprobar explícitamente v1 solo-submit y prohibir automatización adicional hasta un contrato futuro, o definir ahora los literales, capacidades, raíces y ciclos adicionales.

## Decisiones propuestas, todavía no aprobadas

- Usar exclusivamente `FiscalSubmissionAttempt.operation_type='SUBMIT_DOCUMENT'` en migration 003.
- Discriminar factura, notas y documento soporte mediante `document_type` y capability.
- Mantener `IntegrationDispatch.idempotency_key` como raíz estable y exigir igualdad exacta en cada attempt.
- Conservar reintentos como filas individuales numeradas con la misma raíz y checksum.
- Mantener `UNKNOWN_OUTCOME` histórico y bloquear retry ciego de la misma operación.
- Tratar correction, contingency y reconciliation como conceptos distintos de `operation_type`.
- Diferir query y artifact retrieval a un contrato independiente.

Estas decisiones son candidatas; HIGH-001, HIGH-002 y HIGH-003 impiden considerarlas aprobadas.

## Estados preservados

- Migration 001: `MATERIALIZED / TESTED / IMMUTABLE`.
- Migration 002: `MATERIALIZED / TESTED / IMMUTABLE`.
- MAT-003 preflight histórico: `EXECUTED / PASS / REVIEWED`.
- Migration 003 canónica: `NOT_MATERIALIZED`.
- Ledger entries migration 003: `0`.
- SQL 003: no ejecutado ni aplicado.
- FACTUS, SIIGO y ALEGRA: `DESIGNED / NOT_EVALUATED`.
- Context7: `EVALUATED / NOT_REQUIRED / REMOVED`.

## Infraestructura

- Contenedor inspeccionado exclusivamente: `pos-target-canonical-local-postgres`.
- Estado encontrado: `running`.
- Acción ejecutada: `docker stop pos-target-canonical-local-postgres`.
- Estado verificado después de la detención: `exited`; no aparece como running.
- No se abrió PostgreSQL ni se ejecutaron consultas, migraciones, preflight o role-readiness.
- No se ejecutaron `docker compose down`, eliminación de contenedor/volúmenes/imágenes/redes, prune, reinicio ni inicio de otros contenedores.
- Docker Desktop CLI soporta oficialmente `docker desktop stop`. Por orden operativo, su detención queda como último paso posterior al push Git; el resultado terminal debe verificarse en el cierre de la tarea. No se autoriza matar procesos por fuerza.

## Paquetes externos

Estos archivos están fuera del repositorio:

| Paquete | SHA-256 |
|---|---|
| `FISCAL-003-ATTEMPT-OPERATION-IDEMPOTENCY-CONTRACT-DECISION-INDEPENDENT-REVIEW.md` | `fc1f7d7a1f191cade0b1e41880e1f513ca81c412103050a74d807a26dca8549c` |
| `FISCAL-003-ATTEMPT-OPERATION-IDEMPOTENCY-CONTRACT-DECISION-REVIEW.md` | `0e5bee833e786fde0337488315e9694643411e008cb3fb1b71fca4d13eafd856` |
| `MAT-003-SQL-003-STATIC-MATERIALIZATION-REVIEW.md` | `f4ea3b26a9276bb040b3c90d315e7d562307f4e58d26c1f3221df010909f027c` |
| `MAT-003-SQL-003-PLANNING-REVIEW.md` | `b1b2522e56d08c53c50f2a4e657472b296e42ee657c1821a7b90a111e43b6abf` |
| `MAT-003-checkpoint-review.md` | `cdf87d9d829a157e2950e80c285e22701146a2ecabb6e92aee40f4f9b5344d83` |

## Prohibiciones vigentes

- No resolver findings en esta rama WIP.
- No modificar SQL 003 ni documentación autoritativa.
- No ejecutar PostgreSQL, Docker adicional, migrations, preflight, role-readiness ni providers.
- No hacer merge, rebase, force push, amend, tags ni integrar en `main`.
- No evaluar FACTUS, SIIGO o ALEGRA.
- No reinstalar Context7.
- No tratar este checkpoint como aprobación técnica o contractual.

## Procedimiento seguro de reanudación

1. Confirmar que `architecture/physical-model` siga siendo la rama canónica, limpia y sincronizada con su upstream.
2. Verificar que `origin/wip/sql003-contract-gap-20260825` exista y que su commit coincida con el registrado en el cierre de jornada.
3. Leer este checkpoint y los paquetes externos por sus hashes, sin aplicar el SQL candidato.
4. Abrir un hilo independiente limitado a resolver HIGH-001, HIGH-002 y HIGH-003.
5. Producir una propuesta contractual reconciliada y someterla a revisión externa.
6. Solo una autorización posterior y separada podrá modificar documentación autoritativa o remediar SQL/pruebas.

## Próxima tarea exacta

Abrir un nuevo hilo de Codex para resolver exclusivamente HIGH-001, HIGH-002 y HIGH-003 del contrato Fiscal 003 y producir una propuesta reconciliada para revisión externa. No modificar todavía SQL 003, documentación autoritativa, PostgreSQL, migraciones, providers ni infraestructura.

STOP
