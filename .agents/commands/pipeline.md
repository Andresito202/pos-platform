# Pipeline Command

Cuando el usuario escriba `/pipeline`, ejecuta el Agent Pipeline completo
(sección "Pipeline de trabajo" de `AGENTS.md`) para la tarea actual,
siguiendo las 7 fases en orden: AUDIT → PLAN → BUILD → TEST → REVIEW →
EVIDENCE → SHIP.

No saltes fases. No declares una fase completa sin evidencia.

Reporta el estado al final de cada fase antes de continuar a la siguiente,
usando las categorías de evidencia definidas en `AGENTS.md`
según la escalera vigente del tablero; una publicación no acredita runtime ni producción.

Si un test no puede ejecutarse, indica la razón exacta en vez de omitir la
fase.
