# Bloque 7 — Informe definitivo (cierre interno)

**Repositorio:** Andresito202/pos-platform  
**Rama única:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft — no fusionar a `main`, no FACTUS)  
**Estado:** **BLOQUE_7_BLOQUEADO** hasta CI exact-head SUCCESS del tip de remediación (luego `BLOQUE_7_CERRADO_INTERNO`)

| Referencia | SHA |
|---|---|
| HEAD inicial (CI SUCCESS confirmado) | `1ee066d146d03a01ff7a23ff56137cd3f1ebbc5e` |
| Tip funcional Bloque 7 | `ab8795949e71165a12498c8ea991383ed39ab0b1` |
| Tip docs previo (CI fail vulnerab.) | `b5c1247c2c8c1ad312e861a553eafeb83b566abe` |
| Tip remediación supply-chain (este commit) | `c5a1f0699391effe0974dfebecdada2f599174c3` |

## Defectos corregidos

| Defecto | Corrección |
|---|---|
| StatusPanel sin operaciones pendientes de sync | `RuntimeStatusResultSchema` + `DurableSyncStore.outboxDepth()` + StatusPanel (conteos reales PENDING/IN_FLIGHT/RETRY_WAIT y DEAD_LETTER) |
| `NOT_AUTHENTICATED` al boot no re-sonda | `CentralSyncComponent` arma probe espaciado y pasa a drenaje cuando aparece credencial |
| ROLE-PREVIEW doc: SUPERVISOR con “caja y ventas” | Alineado con bridge/`ROLE_SCREEN_ORDER` (sin carrito) |
| CI vulnerability gate: `electron-builder@26.0.12` → tar/app-builder-lib/builder-util-runtime high/critical | Bump `electron-builder@26.18.1` + `pnpm.overrides` (`tar`, `builder-util-runtime`, `app-builder-lib`, `dmg-builder`, `builder-util`, `electron-builder-squirrel-windows`) |
| License gate: `truncate-utf8-bytes@1.0.2` SPDX `WTFPL` sin clasificar (vía sanitize-filename / builder-util) | `WTFPL` añadido a `allow` con `preserve-license-text` (permisiva; no debilita deny floor) |

## Funcionalidades verificadas

| Área | Resultado | Claim |
|---|---|---|
| 4 roles UI (Vitest) | desktop suite | TESTED |
| Sectores 3 (UI gates + bloque4 6 PASS) | AdminPanels + bloque4 e2e | TESTED |
| Offline/sync (bloque5 suite) | 18 PASS reconfirmados | TESTED |
| Indicador outbox en StatusPanel | tests StatusPanel | TESTED |
| Reconexión auth Central Sync | central-sync-component test | TESTED |
| Contracts IPC outbox fields | 344 PASS | TESTED |
| electron-builder + NSIS config + dep | `electron-builder.yml`, `pack:windows-nsis` | IMPLEMENTED |
| NSIS .exe en Linux | falla sin wine | SKIP (lab Windows) |
| win-unpacked win32 generado en Linux | presente bajo `dist-installer/` (no versionado) | GENERATED (local) |
| Firma Authenticode | RT-009-B | BLOCKED |
| Instalación física / FACTUS / Android / VPS | fuera de alcance | SKIP |
| Vulnerability + license gates (local, tip remediación) | PASS observados | TESTED (local; CI tip pendiente) |

## Pruebas PASS / FAIL / SKIP (este entorno)

**PASS:** contracts 344; desktop 341; StatusPanel 6; central-sync+sync-store 12; bloque4+bloque5 18; architecture; typecheck desktop+local-service; desktop build; `ci:vulnerability-audit`; `ci:license-gate` (+ inventory/SBOM con `REVIEWED_SHA`); `ci:license-tests` 13; `ci:supply-chain-tests` / vulnerability policy tests.

**FAIL:** tip `b5c1247c` CI — Repository policy / vulnerability audit (remediado en tip siguiente; no se declara PASS remoto hasta exact-head).

**SKIP:** NSIS final sin wine; install/uninstall/upgrade físico; Authenticode; FACTUS; capturas homes rol Windows; VPS/Android/hardware.

## Artefactos

| Artefacto | Estado |
|---|---|
| `apps/pos-desktop/electron-builder.yml` | versionado |
| `apps/pos-desktop/scripts/pack-windows-nsis.mjs` | versionado |
| `electron-builder@26.18.1` devDependency | versionado en lockfile |
| `dist-installer/` | gitignored; generado localmente |

## Riesgos / dependencias externas

1. RT-009-B certificado Authenticode ausente.
2. NSIS completo requiere wine (Linux) o host Windows.
3. Consumers Central tipados inventario/reservas (Bloque 5).
4. Sobreventa relativa multicaja offline.
5. DEC-024 TLS PROPOSED / provenance.
6. picomatch GHSA-fc5q exceptions hasta 2026-12-17.
7. Icono Electron por defecto en packer (brand icon no cableado al builder).
8. `electron-builder-squirrel-windows` permanece como peer de `app-builder-lib` (DEC-010 sigue siendo NSIS; no se adopta Squirrel como empaquetador).

## Checklist previo a distribución comercial

- [ ] CI exact-head verde en tip de release
- [ ] NSIS generado en Windows lab + install/uninstall/upgrade verificados
- [ ] Authenticode con certificado real (RT-009-B)
- [ ] Capturas 4 roles + 3 sectores en canal real Windows
- [ ] FACTUS / bancos / hardware / Android / VPS según alcance
- [ ] Autorización expresa del propietario para merge a `main`

## Estado final

**BLOQUE_7_BLOQUEADO** (CI tip remediación pendiente)  
No certificación comercial. No `PRODUCTION`. No fusionar a `main` sin autorización. No intervenir FACTUS.
