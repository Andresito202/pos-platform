# Migration numbering reconciliation — 2026-11-24

## Collision found

| ID | SCM line (`#137` / `codex/scm-real-integration-20261122`) | Commercial line (`#135` / `#136`) |
|---|---|---|
| 034 | `034_scm_checkpoints` | `034_reporting_aggregate_permissions` |
| 035 | *(retirado)* era `central_rate_limit_counters` | `035_subscription_license_fulfillment` |
| 036 | — | `036_commercial_portal_bridge` (#135) |
| 037 | `037_central_rate_limit_counters` (rate limit) | — |

`035_central_rate_limit_counters` en #137 **colisionaba** con `035_subscription_license_fulfillment` de #135/#136. Se renumeró a **037** en esta línea.

El choque **034** (SCM vs reporting) es preexistente entre líneas; no se reescribe aquí. Al integrar a `main` habrá que reconciliar 034 con renumeración explícita — no mergear a ciegas.

## Dependencia de 037

Predecesor ledger: `004_device_trust` (no 034). Así D-3 y cualquier runtime Central con 001–004 pueden aplicar rate-limit counters **sin** arrastrar la cadena comercial completa, sin omitir la migration y sin debilitar RLS.

## D-3

Workflow `d3-live-security-e2e.yml` aplica `postgres:commercial:apply -- --central-rate-limit` después de 004, antes de arrancar Central (backend Postgres por defecto).
