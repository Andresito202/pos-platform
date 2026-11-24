# Evidencia ejecutable — fase seguridad integral (2026-11-24)

## Commits

| Rama | HEAD | Contenido |
|---|---|---|
| `cursor/security-integral-phase-c53a` (PR #137) | tip | Rate limit Postgres, fuses, seal anti-wipe, antifraud IPC/negatives, SEC-G buckets |
| `cursor/android-commercial-integration-c53a` (PR #136) | `64d4430e` | AndroidRuntimeIntegrity + runtime files.json verify |
| `cursor/android-r8-hardening-c53a` (PR #138) | tip | R8 opcional + host wire de `verifyAndroidEmbeddedRuntimeIntegrity` |

## Pruebas ejecutadas en este entorno

| Comando | Resultado observado |
|---|---|
| `pnpm --filter @pos-platform/pos-desktop exec vitest run tests/electron-fuses-policy.test.ts tests/window-security.test.ts` | 9 PASS |
| `pnpm --filter @pos-platform/central-authority exec vitest run tests/durable-fixed-window-rate-limiter.test.ts` | 4 PASS |
| `pnpm --filter @pos-platform/contracts exec vitest run tests/ipc-contracts.test.ts` | 42 PASS (incl. inyección de precio) |
| `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/license-capacity.test.ts` | 7 PASS (incl. wipe+seal) |
| `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/android-runtime-integrity.test.ts` | ejecutado en #138 |
| `gradle -p apps/pos-android compileKotlin` | BUILD SUCCESSFUL (histórico #136) |

No se repitieron suites ya aprobadas de PR #135/#136 (host 8 PASS, CI 11 SUCCESS en `8b99cffc`).

## Controles nuevos / corregidos

1. **Rate limit:** default `CENTRAL_RATE_LIMIT_BACKEND=postgres` → `PostgresFixedWindowRateLimiter` + migration `037_central_rate_limit_counters` (pred. `004_device_trust`; D-3 aplica antes de arrancar Central). Fallbacks: `file` / `memory`.
2. **Electron Fuses / ASAR integrity:** `electron-builder.yml` + `ELECTRON_FUSES_POLICY` + test de no debilitamiento.
3. **Android BUSINESS integrity:** debugger/Frida/root artifacts; digest verify del motor embebido; host falla si `ANDROID_REQUIRE_RUNTIME_MANIFEST=1` sin `files.json`.
4. **License wipe seal:** product seal + sticky machine seal (`XDG_STATE_HOME` / `PROGRAMDATA`); borrar SQLite+product seal no reinicia trial.
5. **Antifraude IPC:** `sale.create` rechaza `unit_price` / descuentos / totales inyectados (`z.strictObject`).
6. **Numeración:** `docs/security/migration-numbering-reconciliation-20261124.md` (035→037 vs #135/#136).

## No ejecutado (bloqueos reales)

- Certificación física Windows / M60WL (reservada).
- Turnstile (requiere secreto Cloudflare + wiring portal PR #1).
- WAF/DDoS/firewall de borde.
- Authenticode / Play signing productivos.
- Cobros Factus reales / sandbox conectado.
- Promoción SEC-G01..G10 a PASS.

## Repos visibilidad

`pos-platform` y `camacho-pos-comercial` observados **public** vía API; checklist de privatización documentado sin cambiar visibility.
