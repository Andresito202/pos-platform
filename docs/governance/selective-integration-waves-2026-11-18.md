# Integración selectiva main ← PR #106 — decisiones 2026-11-18

Fuente de producto: rama `cursor/commercial-design-review-0d11` (tip de trabajo; no es canónica hasta merge verificado).
Destino canónico: `main`.
PR acumulado: [#106](https://github.com/Andresito202/pos-platform/pull/106) (Draft). Se preserva; no se pierde historial.

## Decisiones del propietario

1. Priorizar olas **0, 1, 2 y 3** para consolidar producto en `main`.
2. Integración **selectiva** por dependencias reales, con verificación de ascendencia Git de cada slice.
3. Reutilizar **exclusivamente** implementaciones existentes (sin reescribir roles, licencias, sectores, inventario, caja, ventas ni sync).
4. Ola **4**: recuperar instalador Windows aprobado en baseline `76253bb6` / evidencia `5e526641`, **sin** incorporar modificaciones SCM comerciales posteriores fallidas.
5. Ola **5** (canal comercial Electron↔NT SERVICE post-`76253bb6`): **congelada** temporalmente.
6. Hardware: preservar código y evidencias; distinguir integración de certificación física.
7. **FACTUS** permanece como último bloque (ola 7).

## Restricciones

- No exigir NSIS comercial verde para integrar componentes independientes (olas 0–3).
- No crear otro POS, servicios duplicados, arquitecturas alternativas ni pantallas de laboratorio.
- Un solo producto canónico en `main`.
- Conservar controles fail-closed (`SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`, RT-009-B, Session-0).
- Presentar diff y dependencias de cada ola **antes** de su merge.
- Merge a `main` únicamente con merge commit (nunca squash/rebase).

## Olas

| Ola | Contenido | Baseline / hitos | Estado |
|---|---|---|---|
| 0 | Gobernanza: línea activa = `cursor/commercial-design-review-0d11` | blobs tip / este documento | PR #108 Draft |
| 1 | SQLite M017–M024 + inventario (lotes/FEFO/reservas/conversión) | Techo schema **`321d09db`** (M024). Features: `ba579f1a`→`0b4965b0`→`9717ee78`. Cadena 017–021 viaja en el mismo `local-database.ts` | Diff presentado; sin merge |
| 2 | Sectores M025–M029 + licencias + roles | Schema `c3f6946e` (M029); licencias `dcd75305`; roles `a21c3e79` → UI `0cb6d72d`. PG license: 006/017/022/023 (pelar FACTUS 018) | Diff presentado; sin merge |
| 3 | Central Sync / outbox / multicaja lab | `b895d8a7`→**`8ae99fea`**; PG `028_sync_domain_projections`. No Bloque 7 UI/NSIS | Diff presentado; sin merge |
| 4 | Instalador Windows aprobado | Corte SHA **`76253bb6`** (docs lock `d206408e`); evidencia `5e526641`. **No** path-checkout solo de packaging | Después de 0–3 |
| 5 | SCM comercial tip | `79fba84f`…`9922e91c` (canal commercial IPC; tip debilita `NOT_PROVEN`) | **CONGELADA** en #106 |
| 6 | Hardware | código+evidencias existentes (p. ej. M018 bindings) | Integración ≠ certificación física |
| 7 | FACTUS | último (`018_factus_pay_*`, adapters) | Bloqueado al final |

## Método Git por ola de producto

1. Branch desde `main`.
2. `git checkout <BASELINE_SHA> -- <INCLUDE_PATHS>` (blobs existentes; sin reescritura).
3. Completar solo deps de compilación del **mismo** SHA.
4. Tests mínimos del slice; presentar diff+deps; merge commit tras autorización.

Orden Git ≠ orden de olas: `0cb6d72d` (Bloque 6 / W2 UI) es **descendiente** de `8ae99fea` (W3). La extracción path-selective es obligatoria; no mergear el hito completo de Bloque 6 como atajo de W2.

## Ola 1 — INCLUDE / EXCLUDE (auditoría)

**Include:** `packages/database-sqlite` (techo `321d09db`), `apps/pos-local-service/src/inventory/` **excepto** `execute-transform-use-case.ts`, wiring batch/conversion/reservation en commercial handler + `ipc-commercial`, UI `InventoryBatch*` / `InventoryConversion*`, tests inventory v22–v24 / batches, docs `shared-inventory-20261115.md`. Waiting-carts (M019) si el techo schema las trae.

**Exclude:** transform/pharmacy/bakery, `license-sector`, PG 006+, PG 028, Windows/NSIS/SCM, FACTUS, Android, Bloque 7 (`ab879594`+).

**Tests mínimos:** `pnpm test:contracts` (inventory*); `pnpm --filter @pos-platform/database-sqlite test`; `pnpm --filter @pos-platform/pos-local-service test -- inventory`.

## Ola 2 — INCLUDE / EXCLUDE (auditoría)

**Include:** M025–029 + tests; `execute-transform-use-case.ts`; `pharmacy/` `bakery/`; `pharmacy-sale-eligibility-port`; license-capacity + `license-sector` + central license pieces de `dcd75305`; UI Pharmacy/Bakery/Transform + `roleNavigation` / gates `0cb6d72d`; PG 006/017/022/023; e2e bloque4 / sector tests.

**Exclude:** Bloque 5 como producto (W3); Bloque 7; FACTUS 018; Android; SCM tip; pantallas lab nuevas.

**Tests mínimos:** sqlite pharmacy/bakery/v25; `bloque4-sector-license-e2e`; desktop roleNavigation/AdminPanels.

## Ola 3 — INCLUDE / EXCLUDE (auditoría)

**Include:** `apps/pos-local-service/src/sync/` (jitter/dispatcher/isolated gate), `bloque5-offline-sync-e2e`, PG 028, `central-sync-gate` / lab-migrate / server, docs bloque5.

**Exclude:** `ab879594`+ outbox UI/NSIS; SCM commercial channel; FACTUS; Android.

**Nota:** imports de `DurableSyncStore` en inventory/pharmacy **ya existen en main** — no fuerzan meter Bloque 5 en W1/W2.

**Tests mínimos:** `pos-local-service` bloque5/sync; `pnpm --filter @pos-platform/target-migrations central-sync:gate`.

## Ola 4 — corte instalador (auditoría)

- **Baseline aprobado:** `76253bb6` (preferible docs lock `d206408e`).
- Packaging `electron-builder.yml` / `installer.nsh` / pack scripts: **idénticos** tip↔`76253bb6`.
- Tip NSIS rojo = paso `electron_winsw_scm_commercial_ipc` post-baseline (**sí**, trabajo ola 5).
- **Estrategia:** corte SHA / restaurar blobs `76253bb6` de gates/lifecycle; **no** cherry-pick `79fba84f…9922e91c`; **no** path-checkout solo `packaging/**` sobre main (acoplado a descriptor/lifecycle/gates).
- **Gates a preservar del baseline:** `assertWindowsScmCommercialCertification` incondicional `NOT_PROVEN` en `76253bb6`; RT-009-B BLOCKED. El tip debilita el gate (1) — ola 4 no debe traer esa semántica.

## Ascendencia Git (medida)

- `main` = `591ad4c1`
- tip = `9922e91c`
- merge-base(`main`, tip) = `main` (fast-forward posible; **no** se usará un merge masivo)
- `321d09db` / `76253bb6` / `8ae99fea` / `dcd75305` son ancestros de tip
- Lineal de hitos: `a21c3e79` → inventario/sectores → `dcd75305` → `8ae99fea` → `0cb6d72d` → `ab879594` → `76253bb6` → `79fba84f…9922e91c` (ola 5)

