---
name: claims-level-audit
description: Usar SIEMPRE antes de afirmar que algo quedó DOCUMENTED, MATERIALIZED, TESTED, REVIEWED, CANONICALLY_APPLIED o PRODUCTION_READY en pos-platform. Evita overclaiming.
---
# Auditoría de nivel de claim

Antes de escribir cualquiera de estas palabras en un commit, PR, README o respuesta al usuario,
verifica el nivel real:

1. `DOCUMENTED` — existe en docs/ con contenido específico, no solo mencionado.
2. `MATERIALIZED` — el código/artefacto existe en el filesystem y compila/corre.
3. `TESTED` — corriste el test tú mismo en este turno y viste el resultado (no infieras de un run anterior).
4. `REVIEWED` — alguien (humano) lo aprobó explícitamente, no basta con que Claude lo generó.
5. `CANONICALLY_APPLIED` — está en `main`, con PR mergeado y SHA verificado en GitHub real (no local).
6. `PRODUCTION_READY` — corrió en el entorno productivo objetivo, no solo local/CI.

Si no puedes verificar un nivel, usa `NOT_EVALUATED` o `REQUIRES_LOCAL_VERIFICATION` en vez de
inventar un estado optimista. Nunca subas de nivel algo solo porque "debería funcionar".
