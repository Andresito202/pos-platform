# Evidencia ejecutable — fase seguridad integral (2026-11-24)

## Commits

| Rama | HEAD | Contenido |
|---|---|---|
| `cursor/security-integral-phase-c53a` | `49bf8342` + tip tras push docs | Rate limit durable, Electron fuses, auditoría, prep firma/privatización |
| `cursor/android-commercial-integration-c53a` (PR #136) | `64d4430e` | AndroidRuntimeIntegrity + runtime files.json verify |

## Pruebas ejecutadas en este entorno

| Comando | Resultado observado |
|---|---|
| `pnpm --filter @pos-platform/pos-desktop exec vitest run tests/electron-fuses-policy.test.ts tests/window-security.test.ts` | 9 PASS |
| `pnpm --filter @pos-platform/central-authority exec vitest run tests/durable-fixed-window-rate-limiter.test.ts` | 4 PASS |
| `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/android-runtime-integrity.test.ts` | 2 PASS |
| `gradle -p apps/pos-android compileKotlin` | BUILD SUCCESSFUL |

No se repitieron suites ya aprobadas de PR #135/#136 (host 8 PASS, CI 11 SUCCESS en `8b99cffc`).

## Controles nuevos / corregidos

1. **Rate limit:** main.ts ya no desaloja presupuestos activos; `DurableFixedWindowRateLimiter` + `CENTRAL_RATE_LIMIT_STATE_FILE` (single-node). Multi-nodo = residual.
2. **Electron Fuses / ASAR integrity:** `electron-builder.yml` + `ELECTRON_FUSES_POLICY` + test de no debilitamiento.
3. **Android BUSINESS integrity:** debugger/Frida/root artifacts; digest verify del motor embebido.
4. **Docs:** auditoría, prep firma comercial, prep privatización (repos siguen public).

## No ejecutado (bloqueos reales)

- Certificación física Windows / M60WL (reservada).
- Turnstile (requiere secreto Cloudflare + wiring portal PR #1).
- WAF/DDoS/firewall de borde.
- Authenticode / Play signing productivos.
- Cobros Factus reales / sandbox conectado.
- Promoción SEC-G01..G10 a PASS.

## Repos visibilidad

`pos-platform` y `camacho-pos-comercial` observados **public** vía API; checklist de privatización documentado sin cambiar visibility.
