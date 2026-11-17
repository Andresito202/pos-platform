# Bloque 6 — Informe definitivo (cierre interno)

**Repositorio:** Andresito202/pos-platform  
**Rama única:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft — no fusionar a `main`, no Bloque 7, no FACTUS)  
**Estado:** **BLOQUE_6_CERRADO_INTERNO**

| Referencia | SHA |
|---|---|
| HEAD inicial aprobado | `8ae99fea1607c79665f3b869c21dee573da53e25` |
| Tip funcional Bloque 6 | `0cb6d72d019c620548bf9756f695a22f48e2e9b6` |
| Tip CI exact-head (claim) | `f7926274d24e998bb95703ce09afda62dd8e1b05` |

Motor UI: `apps/pos-desktop` + `apps/pos-local-service` existentes. Sin segundo POS, sin role-preview como producto, sin rediseño de login, sin FACTUS.

## CI exact-head (`f7926274`) — 6/6 SUCCESS

Observado 2026-11-17 contra tip `f7926274d24e998bb95703ce09afda62dd8e1b05`:

| # | Workflow | Run | Conclusión |
|---|---|---|---|
| 1 | TARGET foundation validation | [44149722614](https://github.com/Andresito202/pos-platform/actions/runs/44149722614) | success |
| 2 | CodeQL SAST | [44149722634](https://github.com/Andresito202/pos-platform/actions/runs/44149722634) | success |
| 3 | D-3 Live Security E2E | [44149722476](https://github.com/Andresito202/pos-platform/actions/runs/44149722476) | success |
| 4 | G1.2 Live Session Bootstrap | [44149722558](https://github.com/Andresito202/pos-platform/actions/runs/44149722558) | success |
| 5 | Central Sync Persistence Gate | [44149722719](https://github.com/Andresito202/pos-platform/actions/runs/44149722719) | success |
| 6 | strix-penetration-test | [44149722603](https://github.com/Andresito202/pos-platform/actions/runs/44149722603) | success |

Check-runs: 9 success · 2 skipped · **0 failed** (skipped: Main push governance, FACTUS).

## Defectos corregidos

| Defecto | Corrección |
|---|---|
| Flake CI SUPERVISOR → `transfer-review-panel` (Inventario quedaba `aria-current`) | `App.tsx`: reset de nav sólo con identidad local *settled*; `useLocalOperatorSession`: no blankear sesión autenticada en probes; test con click nativo + `waitFor` |
| Política alimentaria visible sin licencia Salsamentaria | `CatalogPanel`: formulario gated por `SECTOR_SALSAMENTARIA` |
| Pastelería sin test id estable | `BakeryPanel`: `data-testid="bakery-panel"` |

## Integración por roles (TESTED — Vitest)

| Rol | Home / superficies | Carrito | Evidencia |
|---|---|---|---|
| CAJERO | Caja (`sale-panel`) | Sí | `App.test.tsx` Role-ordered |
| SUPERVISOR | Inventario; Revisar transferencias | No | flake corregido + waitFor |
| ADMINISTRADOR | Dashboard; sin Caja | No | `App.test.tsx` |
| SUPERADMINISTRADOR local | Auditoría (no GLOBAL) | No | `App.test.tsx` |
| GLOBAL | `platform-entry.tsx` separado | N/A | portal HTTPS; no mezclado con local |

Permisos backend locales preservados (bridge + rechazo `sale.create` en roles no cajero — evidencia Bloque 4/consolidación previa).

## Módulos sectoriales (TESTED — UI + Bloque 4)

| Sector | Gate | Evidencia |
|---|---|---|
| Salsamentaria | `SECTOR_SALSAMENTARIA` → food policy + `inventory-transform-panel` | `AdminPanels.test.tsx` |
| Farmacia | `SECTOR_FARMACIA` → `pharmacy-panel` | `AdminPanels.test.tsx` |
| Pastelería | `SECTOR_PASTELERIA` → `bakery-panel` | `AdminPanels.test.tsx` |
| 3 empresas × 4 roles (capacidad firmada) | licencias sectoriales | `bloque4-sector-license-e2e.test.ts` 6 PASS (reconfirmado) |

No se reconstruyeron módulos del Bloque 4.

## Experiencia comercial

- Marca amarilla/naranja vigente en build renderer (`camacho-pos-colombia-*.png`).
- Sidebar expandible/contraíble + logout en menú: TESTED (`App.test.tsx`).
- StatusPanel: conectividad `runtime.status.get` (conectado/sin conexión). **No** hay indicador de cola outbox en UI (runtime status no expone pending count) — riesgo pendiente.
- Login aprobado no modificado.

## Capturas reales

| Captura | Qué acredita | Qué no acredita |
|---|---|---|
| `docs/testing/bloque6-captures/bloque6-login-entry-real.png` | Electron compilado + login comercial + BrandMark + StatusPanel | Login BUSINESS / 4 roles en vivo |
| Homes por rol (Caja/Inventario/Dashboard) | — | **SKIP** en Linux: DPAPI + named pipes + LocalChannel win32. Ver `ROLE_HOME_CAPTURE_SKIP.md`. Path: `local-operator-live.spec.ts` en Windows. |

No se usó role-preview ni visual-preview como evidencia comercial.

## Empaquetado Windows (diferenciado)

| Nivel | Resultado |
|---|---|
| Artefacto Desktop build (`pnpm --filter @pos-platform/pos-desktop build`) | **PASS** — `dist/start.bundle.mjs` + renderer + logo |
| Artefacto Local Service `linux-x64` INTERACTIVE | **PASS** — `pos-local-service-0.0.0-linux-x64.tar.gz` sha256 `d7d3db9f7d4e4096badfb9c8b59597b279fca8b96cbeab498ac8a640dfc5dc8d` |
| Artefacto Local Service `win32-x64` INTERACTIVE | **GENERATED** — `pos-local-service-0.0.0-win32-x64.tar.gz` sha256 `0d2b54681ac47aa5b458b2fda777121b90a23c29812d5ac9be79570a276dda5c` (generado en Linux; no ejecutado en Windows) |
| electron-builder + NSIS instalador | **NOT MATERIALIZED** (DEC-010 documentado; RT-009-B) |
| Instalación / desinstalación / actualización / conservación de datos en PC | **SKIP** — requiere Windows físico |
| Firma Authenticode | **BLOCKED** — RT-009-B `REQUIRES_CERTIFICATE` |
| Distribución comercial certificada | **NO** |

No se desactivaron SCM/DPAPI/IPC/firmas/auth para obtener build.

## Pruebas PASS / FAIL / SKIP

**PASS (este entorno):**
- `pnpm --filter @pos-platform/pos-desktop test` — 340 PASS
- `pnpm --filter @pos-platform/pos-desktop typecheck` — exit 0
- `pnpm --filter @pos-platform/pos-desktop build` — exit 0
- Electron `e2e/boot.spec.ts` (xvfb) — 5 PASS
- `bloque4-sector-license-e2e.test.ts` — 6 PASS
- `pnpm architecture:check` — PASS
- `pnpm test:contracts` — 343 PASS
- Captura login real Electron

**SKIP:**
- Capturas homes por rol en Linux
- Instalador NSIS / WinSW install-uninstall-upgrade físico
- Firma de código
- FACTUS / Android / VPS / hardware
- Indicador UI de outbox pendiente (sin campo en `runtime.status`)

**FAIL:** ninguno observado en suites ejecutadas arriba.

## Riesgos y dependencias externas

1. RT-009-B certificado Authenticode ausente.
2. electron-builder/NSIS aún no materializado en `package.json`.
3. Capturas/E2E de 4 roles con canal real requieren Windows (`local-operator-live`).
4. Indicador de operaciones pendientes de sync no expuesto en StatusPanel.
5. Excepciones picomatch GHSA-fc5q (tooling) hasta 2026-12-17.
6. Sin certificación comercial / merge a main.

## Estado final

**BLOQUE_6_CERRADO_INTERNO**  
No certificación comercial. No `PRODUCTION`. No iniciar Bloque 7. No fusionar a `main`. No intervenir FACTUS.
