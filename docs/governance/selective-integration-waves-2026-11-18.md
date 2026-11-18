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
| 0 | Gobernanza: línea activa = `cursor/commercial-design-review-0d11` | blobs tip / este documento | En curso (este PR) |
| 1 | SQLite M017–M024 + inventario extendido | tip / commits inventario v22–v24 | Pendiente presentación |
| 2 | Sectores M025–M029 + licencias + roles | `dcd75305`, `a21c3e79`, `0cb6d72d` | Pendiente presentación |
| 3 | Central Sync / outbox lab | `8ae99fea` + gate | Pendiente presentación |
| 4 | Instalador Windows aprobado | **`76253bb6`** (excluye tip SCM comercial) | Después de 0–3 |
| 5 | SCM comercial tip | `76253bb6..tip` (16 archivos) | **CONGELADA** |
| 6 | Hardware | código+evidencias existentes | Integración ≠ certificación física |
| 7 | FACTUS | último | Bloqueado al final |

## Ascendencia Git (medida)

- `main` = `591ad4c1`
- tip = `9922e91c`
- merge-base(`main`, tip) = `main` (fast-forward posible; **no** se usará un merge masivo)
- `76253bb6` es ancestro de tip; delta tip = 9 commits / 16 archivos SCM comercial (ola 5)

