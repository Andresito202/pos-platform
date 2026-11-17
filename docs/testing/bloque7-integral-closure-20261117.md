# Bloque 7 — Informe definitivo (cierre interno)

**Repositorio:** Andresito202/pos-platform  
**Rama única:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft — no fusionar a `main`, no FACTUS)  
**Estado:** **BLOQUE_7_CERRADO_INTERNO**

| Referencia | SHA |
|---|---|
| HEAD inicial (CI SUCCESS confirmado) | `1ee066d146d03a01ff7a23ff56137cd3f1ebbc5e` |
| Tip funcional / claim CI | *(rellenar tras push)* |

## Defectos corregidos

| Defecto | Corrección |
|---|---|
| StatusPanel sin operaciones pendientes de sync | `RuntimeStatusResultSchema` + `DurableSyncStore.outboxDepth()` + StatusPanel (conteos reales PENDING/IN_FLIGHT/RETRY_WAIT y DEAD_LETTER) |
| `NOT_AUTHENTICATED` al boot no re-sonda | `CentralSyncComponent` arma probe espaciado y pasa a drenaje cuando aparece credencial |
| ROLE-PREVIEW doc: SUPERVISOR con “caja y ventas” | Alineado con bridge/`ROLE_SCREEN_ORDER` (sin carrito) |

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

## Pruebas PASS / FAIL / SKIP (este entorno)

**PASS:** contracts 344; desktop 341; StatusPanel 6; central-sync+sync-store 12; bloque4+bloque5 18; architecture; typecheck desktop+local-service; desktop build.

**FAIL:** ninguno en suites arriba.

**SKIP:** NSIS final sin wine; install/uninstall/upgrade físico; Authenticode; FACTUS; capturas homes rol Windows; VPS/Android/hardware.

## Artefactos

| Artefacto | Estado |
|---|---|
| `apps/pos-desktop/electron-builder.yml` | versionado |
| `apps/pos-desktop/scripts/pack-windows-nsis.mjs` | versionado |
| `electron-builder@26.0.12` devDependency | versionado en lockfile |
| `dist-installer/` | gitignored; generado localmente |

## Riesgos / dependencias externas

1. RT-009-B certificado Authenticode ausente.
2. NSIS completo requiere wine (Linux) o host Windows.
3. Consumers Central tipados inventario/reservas (Bloque 5).
4. Sobreventa relativa multicaja offline.
5. DEC-024 TLS PROPOSED / provenance.
6. picomatch GHSA-fc5q exceptions hasta 2026-12-17.
7. Icono Electron por defecto en packer (brand icon no cableado al builder).

## Checklist previo a distribución comercial

- [ ] CI exact-head verde en tip de release
- [ ] NSIS generado en Windows lab + install/uninstall/upgrade verificados
- [ ] Authenticode con certificado real (RT-009-B)
- [ ] Capturas 4 roles + 3 sectores en canal real Windows
- [ ] FACTUS / bancos / hardware / Android / VPS según alcance
- [ ] Autorización expresa del propietario para merge a `main`

## Estado final

**BLOQUE_7_CERRADO_INTERNO**  
No certificación comercial. No `PRODUCTION`. No fusionar a `main` sin autorización. No intervenir FACTUS.
