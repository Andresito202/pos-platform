# Certificación integral conectada — intento 2026-11-24

| Campo | Valor |
|---|---|
| pos-platform HEAD | `d72735ce8d407a061abaefbce73c83428d7e0d05` (PR #135) |
| camacho-pos-comercial HEAD | `d636c8983aef192cf56be2d79ca8fab4c9b39a9f` (PR #1) |
| Entorno | Cloud Agent Linux (`cursor`), sin Docker, sin Windows, sin Android/ADB |
| Merge | **NO** |
| Cobros PRODUCTION | **NO** |
| Resultado certificación comercial | **NO EJECUTABLE AQUÍ** — no se simula |

## Escalera (claims-level-audit)

| Requisito | Nivel observado | Evidencia |
|---|---|---|
| Bridge HTTP + contratos | `TESTED` (unit + CI exact-head) | `commercial-portal-bridge.test.ts` 11/11; CI PR #135 sin fallos |
| Persistencia PG migration 036 | `IMPLEMENTED` + artifact `TESTED` | SQL + `postgres-036-…-artifact.test.ts`; **no** `RUNTIME_VERIFIED` en este VM (sin Postgres Central) |
| Mint GLOBAL MFA real | `NOT_EVALUATED` | Sin cookie GLOBAL, sin WebAuthn, sin provision file, sin TLS Central |
| Trial → licencia firmada → caja | `NOT_EVALUATED` | Sin tenant/plan vivos, sin DeviceProof, sin Local Service Windows |
| Offline 120h + bloqueo efectivo | Parcial `TESTED` (componentes) | `license-capacity.test.ts` LICENSE_EXPIRED + restart; `offline_grace_until:null`; `TrustedClockGuard` rollback — **no** wall-clock 120h de un trial comercial real |
| Windows / Android | `NOT_EVALUATED` | Sin host Windows ni dispositivo Android |
| Factus sandbox real + licencia definitiva | `NOT_EVALUATED` | Sin `FACTUS_PAY_SANDBOX_*` credentials |
| Multiempresa / revocación / antirreplay | `TESTED` (unit bridge) | 11/11; no `END_TO_END` multiempresa productivo |

## Bloqueos exactos (faltan para continuar)

1. **Central PostgreSQL + migraciones** hasta `036_commercial_portal_bridge` con rol `pos_platform_app`.
2. **Provision GLOBAL** (`CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE`, rejection verifier, TLS key/cert, `CENTRAL_DEPLOYMENT` origin HTTPS).
3. **Operador GLOBAL** con MFA WebAuthn y permiso `LICENSE_ISSUE` (ceremonia real; no `CENTRAL_BRIDGE_TEST_GATE` / headers de lab).
4. **`COMMERCIAL_BRIDGE_KEY` + `CENTRAL_TRIAL_WEBHOOK_KEY` (≥32)** compartidos con commercial-api.
5. **commercial-api** con `DATABASE_URL` Postgres + `CENTRAL_AUTHORITY_ORIGIN` apuntando al Central TLS real.
6. **Tenant + plan ACTIVE** en Central para ISSUED (trial/provisioning); mapping empresa comercial → `tenancy.tenants`.
7. **Factus Pay SANDBOX** email/password + webhook key ≥32 y URL pública alcanzable (no `sandbox-simulate-paid` como evidencia comercial).
8. **POS Local Service en Windows** con enrolamiento/DeviceProof + capacidad firmada; para Android, runtime/dispositivo autorizado.
9. **Autorización del propietario** para ventana humana de 120h / laboratorio físico si se exige observación wall-clock.

## Controles respetados

- No se usaron fixtures/`central-test:`/ExplicitTest como evidencia de login GLOBAL de producto.
- No se habilitó Factus PRODUCTION.
- No se creó otro POS ni otra rama paralela.
- No se fusionó a `main`.
