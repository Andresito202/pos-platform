---
name: repo-governance-check
description: Usar antes de decir que un cambio quedó integrado, mergeado o en main en pos-platform. El repo no tiene branch protection nativa, así que la verificación es manual obligatoria.
---
# Verificación de gobernanza del repositorio

pos-platform no tiene branch protection/rulesets preventivos (plan GitHub actual no lo permite).
Por eso TODA integración a `main` exige, en este orden:

1. Cambios van en una rama, nunca push directo a `main`.
2. **Se mergea con MERGE COMMIT. Nunca squash ni rebase.** El workflow ejecuta
   `Main push governance` (`tools/ci/validate-main-push-history.sh`), que exige
   que todo commit de primera línea en `main` sea un merge commit creado por
   GitHub. Un squash produce un commit de un solo padre y el gate lo rechaza:
   `main introduced non-merge commit <sha>. Direct pushes and squash/rebase
   merges are not accepted.` Ocurrió el 2026-09-06 con los PRs #42 y #43 y dejó
   `main` en rojo. Por API el parámetro es `merge_method: "merge"`.
3. Se abre PR con SHA esperado documentado.
4. CI corre sobre el HEAD exacto del PR (no un commit viejo) — revisa que el run corresponda al SHA correcto.
5. Tras el merge, se verifica el estado post-merge REAL en GitHub (no se asume): SHA de main,
   estado del run CI post-merge, working tree limpio.
6. Solo entonces se documenta como `CANONICALLY_APPLIED` (ver skill claims-level-audit).

Nunca reportes "ya quedó en main" sin haber consultado el estado real de GitHub en esta sesión.
Ver docs/governance/repository-governance.md para el detalle completo.
