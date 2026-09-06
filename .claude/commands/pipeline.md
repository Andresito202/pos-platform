# Pipeline Command

Cuando el usuario escriba `/pipeline`, ejecuta el Agent Pipeline completo
(sección "AGENT PIPELINE — POS PLATFORM" de `CLAUDE.md`) para la tarea actual,
siguiendo las 7 fases en orden: SPEC → PLAN → BUILD → TEST → REVIEW →
SIMPLIFY → SHIP.

No saltes fases. No declares una fase completa sin evidencia.

Reporta el estado al final de cada fase antes de continuar a la siguiente,
usando las categorías de evidencia definidas en `CLAUDE.md`
(`DOCUMENTED` / `MATERIALIZED` / `TESTED` / `REVIEWED` /
`CANONICALLY_APPLIED` / `PRODUCTION_READY` / `NOT_EVALUATED` /
`REQUIRES_LOCAL_VERIFICATION`).

Si un test no puede ejecutarse, indica la razón exacta en vez de omitir la
fase.
