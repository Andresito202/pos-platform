# Reconciliación de auditorías paralelas — 2026-11-24

Fuentes: [Audit Windows Electron security](bc-3162702e-aa5f-5a07-a893-0f76a061821e), [Audit web API auth security](bc-aa249b43-42f9-54ac-b452-d2435985311f), [Audit Android anti-piracy fraud](bc-f681f78a-2807-5e54-bc9d-4f9ef801c54c), [Audit comercial portal security](bc-cc839149-418c-5f18-96a8-03084b97ea41).

Los inventarios marcaron controles ABSENT en el momento del muestreo. Esta nota los alinea con remediaciones ya publicadas y residuales abiertos. **No** declara SEC-G PASS.

## Ya remediado tras el muestreo

| Hallazgo auditoría | Remediación | Evidencia |
|---|---|---|
| Electron fuses / ASAR ABSENT | `electron-builder.yml` + `ELECTRON_FUSES_POLICY` | PR #137; tests 9 PASS |
| Rate limiter en `main.ts` desalojaba presupuestos | Sustituido por `FixedWindowRateLimiter` canónico + durable opcional | PR #137; tests 4 PASS |
| Android root/Frida/debug ABSENT (off-HEAD) | `AndroidRuntimeIntegrity` + `files.json` verify | PR #136 @ `64d4430e`; tests 2 PASS + compileKotlin |
| SSRF en `commercialApiOrigin` trial callback | `assertSafeCommercialPortalCallbackOrigin` + re-validate before fetch | PR #135 @ `d257e512`; bridge tests 12 PASS |
| Portal webhook/SCA/rate (Task) | Header/Bearer + atomic upsert + CI SCA | PR #1 @ `28b1803`; CI SUCCESS; [Remediate portal security gaps](bc-8b729e96-87b8-5500-9a4d-5184ce1b97c8) |

## Confirmado reutilizable (no duplicar)

- IPC allowlist / contextIsolation / sandbox / preload (Electron).
- DPAPI / Keystore / LicenseCapacityGate / TrustedClockGuard / DeviceProof.
- MFA WebAuthn BUSINESS/GLOBAL, CSRF cookie `__Host-*`, Zod contracts.
- SBOM CycloneDX + provenance en CI de pos-platform.
- Portal: captcha anti-replay, Factus kill-switch, admin GLOBAL-only (PR #1).

## Gaps abiertos priorizados

| Gap | Repo / rama | Acción |
|---|---|---|
| Webhook Factus `?key=` | camacho-pos-comercial PR #1 @ `28b1803` | Bearer / `X-Factus-Pay-Webhook-Key`; query solo con `FACTUS_PAY_WEBHOOK_ALLOW_QUERY_KEY` (default false). PR #2 superseded |
| Rate-limit multi-instancia | camacho-pos-comercial PR #1 @ `28b1803` | Upsert SQL atómico; CI SUCCESS |
| CI SCA portal | camacho-pos-comercial PR #1 @ `28b1803` | Critical fail-closed; high residual documented |
| Turnstile / edge WAF no RUNTIME_VERIFIED | ambos | Residual infra |
| Authenticode / Play / cert física | pos-platform | BLOCKED / reservada |
| Refresh-token family enforcement en app | pos-platform tip | Residual SEC-G02 |
| `--no-sandbox` en scripts smoke Electron | pos-desktop | No confundir con `sandbox:true` del renderer |

## SEC-G01..G10

Siguen `PLANNED / NOT_EVALUATED`. Matriz: `docs/security/sec-g-evaluation-matrix-20261124.md`.
