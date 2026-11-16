# Prompt 7 Pastelería — auditoría y mapa de reutilización

**HEAD de partida:** `d24345a118d2087c4d230dc9e07241662065bae7`  
**Rama:** `cursor/commercial-design-review-0d11`  
**PR:** #106 Draft (sin merge)

## Núcleo reutilizado (REUSE AS-IS)

| Capacidad | Ubicación | Notas |
|---|---|---|
| Transform físico | `SqliteInventoryStore.executeTransform` / `ExecuteTransformUseCase` | Conservación masa/unidad, FEFO sellable, reservas, merma documental, genealogía MIXED |
| Lotes / FEFO | `MIGRATION_022` + receiveBatch / deductFefo | Sin segundo ledger |
| Catálogo | `catalog_product` / `catalog_presentation` | Ingredientes y terminados = productos normales |
| Food policy flags | `catalog_food_policy` (025) | Conservación/lote/expiry intent |
| Payments / Sales / Caja | sin cambios de motor | Terminados se venden por Caja existente tras liberación |
| Farmacia / Salsamentaria | 026 / 025 | No debilitados |

## EXTEND

| Cambio | Motivo |
|---|---|
| Outputs de transform: `expiryDate`, `manufactureDate`, `initialStatus` | Vida útil de producto terminado y cuarentena hasta liberación; default Salsamentaria intacto |
| Permisos `BAKERY_*` | Prompt exige no otorgar `INVENTORY_STOCK_ADJUST` implícito por operar Pastelería |

## NEW ADDITIVE (`MIGRATION_027`)

- `catalog_bakery_ingredient_profile`
- `catalog_bakery_finished_policy` (shelf_life_days + release_required + policy_basis)
- `bakery_recipe` / `bakery_recipe_line` (versionado; APPROVED inmutable)
- `bakery_production_order` / consumption / direct_cost
- `inventory_lot_acquisition_cost` (costo de adquisición; no `catalog_price`)

## DO NOT TOUCH

- Migraciones 001–026
- Motor paralelo de inventario/ventas/SQLite
- Inventar costos desde precio comercial
- DELETE de producción / reversión silenciosa de movimientos

## Pruebas ancla

- `apps/pos-local-service/tests/pasteleria-production.test.ts`
- `packages/database-sqlite/tests/bakery-v27-migration.test.ts`
- `packages/database-sqlite/tests/bakery-v28-migration.test.ts`
- Regresión: `salsamentaria-transform.test.ts`, `farmacia-*.test.ts`, `payment.test.ts`

## Cierre de integridad (post `dbd7e5ee`)

Defectos reproducidos y corregidos:

1. **Consumo vs receta:** `confirmProduction` aceptaba cualquier lista con stock. Ahora valida presentación/lote, consolida multi-lote, exige cantidades planificadas exactas frente al snapshot, rechaza omisiones/sustituciones no documentadas y exige desviación autorizada si `actual ≠ planned`.
2. **Cantidad comercial vs masa:** `actual_quantity` ya no se reutiliza como masa del terminado. `actual_net_mass_quantity` (M028) alimenta la conservación de masa; no se inventa peso por unidad.
3. **Costeo / liberación:** multi-lote suma costos de adquisición reales; `NOT_COSTABLE` mantiene `total/unit = null` (`zero_cost_forbidden`); venta física permitida solo si el lote está liberado/AVAILABLE; `release_required` sigue en cuarentena hasta `BAKERY_RELEASE` explícito.

`MIGRATION_028` aditiva: columna de masa neta, desviaciones de receta, columnas de desviación en consumo.
