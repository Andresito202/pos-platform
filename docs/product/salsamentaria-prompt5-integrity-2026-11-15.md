# Prompt 5 — corrección de integridad del despiece

**Rama:** `cursor/commercial-design-review-0d11` · PR #106 Draft  
**Partida:** `17b84fc0` (Prompt 5 feature)  
**Alcance:** integridad de `executeTransform()` sin motor de inventario paralelo ni cambios a migraciones 001–025.

## Defectos corregidos

| # | Defecto | Corrección |
|---|---|---|
| 1 | Doble descuento por merma (INPUT + movimiento SHRINKAGE) | Merma documental: atribuye masa/cantidad ya consumida en INPUT; sin segundo movimiento físico ni ledger SHRINKAGE |
| 2 | `canonicalMassUnit = null` permitía inventar existencias cross-unit | Sin masa medida: sólo conservación exacta misma unidad; merma y cross-unit → `MASS_RECONCILIATION_FAILED` / `UNIT_EQUIVALENCE_FAILED` |
| 3 | Genealogía heredaba primer lote | Multi-input: todos los lotes en audit/outbox; proveedor/recibo `MIXED` si discrepan; vencimiento = el más temprano |
| 4 | `quantity`/`massQuantity` arbitrarios en presentaciones de masa | Presentación masa: `quantity` debe equivaler a `massQuantity` bajo la unidad canónica |

## Evidencia local observada (este entorno)

```text
pnpm typecheck                                         → exit 0
pnpm --filter @pos-platform/pos-local-service test     → 998 passed | 116 skipped
  tests/salsamentaria-transform.test.ts                → 8 passed
pnpm --filter @pos-platform/pos-desktop test           → 332 passed
pnpm test:migrations:sqlite                            → 13 passed
pnpm test:contracts                                    → 337 passed
pnpm test:fiscal-adapters                              → 173 passed | 2 skipped
pnpm test:domain                                       → 47 passed
pnpm test:application                                  → 16 passed
pnpm architecture:check                                → PASS
pnpm ci:repository-policy                              → PASS
```

Cobertura negativa/regresión en `salsamentaria-transform.test.ts`: balance físico exacto, sin segundo consumo de merma, rechazo `canonicalMassUnit=null` cross-unit, rechazo masa arbitraria, genealogía mixta, rollback atómico, reservas, aislamiento empresa/sucursal, idempotencia, audit + outbox, conservación same-unit.

## No acreditado

- Producción certificada, E2E Windows/hardware físico, balanza acreditada, sync multi-caja ACK, merge a `main`.
