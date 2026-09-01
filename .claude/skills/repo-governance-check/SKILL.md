---
name: repo-governance-check
description: Usar antes de decir que un cambio quedó integrado, mergeado o en main en pos-platform. El repo no tiene branch protection nativa, así que la verificación es manual obligatoria.
---
# Verificación de gobernanza del repositorio

pos-platform no tiene branch protection/rulesets preventivos (plan GitHub actual no lo permite).
Por eso TODA integración a `main` exige, en este orden:

1. Cambios van en una rama, nunca push directo a `main`.
2. Se abre PR con SHA esperado documentado.
3. CI corre sobre el HEAD exacto del PR (no un commit viejo) — revisa que el run corresponda al SHA correcto.
4. Tras el merge, se verifica el estado post-merge REAL en GitHub (no se asume): SHA de main,
   estado del run CI post-merge, working tree limpio.
5. Solo entonces se documenta como `CANONICALLY_APPLIED` (ver skill claims-level-audit).

Nunca reportes "ya quedó en main" sin haber consultado el estado real de GitHub en esta sesión.
Ver docs/governance/repository-governance.md para el detalle completo.
