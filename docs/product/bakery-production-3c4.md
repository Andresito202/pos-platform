# 3C-4 — Pastelería / producción (evidencia local)

## Alcance

Verificar el camino existente de receta → orden → confirmación → `executeTransform`, sin inventar stock en React ni duplicar el motor de transformaciones.

## Código reutilizado

- `SqliteBakeryStore.confirmProduction` → `SqliteInventoryStore.executeTransform` (`reasonCode=BAKERY_PRODUCTION`)
- Casos de uso: `CreateBakeryRecipeDraft`, `ApproveBakeryRecipe`, `Create/PlanBakeryProductionOrder`, `ConfirmBakeryProduction`
- Migrations bakery v27/v28/v29 y contratos IPC `bakery-production-ipc-contracts`
- Elegibilidad de lotes por fecha comercial `America/Bogota` (P1 previo)

## Defectos

Ningún P0/P1 nuevo en el camino de confirmación. El stock físico solo cambia vía movimientos `TRANSFER_OUT` / `TRANSFER_IN` del transform; la merma es documental sobre el input ya consumido.

## Pruebas ejecutadas (este subbloque)

| Comando | Resultado observado |
|---|---|
| `pnpm --filter @pos-platform/contracts exec vitest run tests/bakery-production-ipc-contracts.test.ts` | 2 passed |
| `pnpm --filter @pos-platform/database-sqlite exec vitest run tests/bakery-v27-migration.test.ts tests/bakery-v28-migration.test.ts tests/bakery-v29-migration.test.ts` | 3 passed |
| `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/bakery-production-confirm.test.ts` | 4 passed |

## Invariantes comprobados

1. Confirmación con masa canónica debita harina (+1 UND) y acredita pan terminado (+10 UND) con movimientos trazables.
2. Auditoría `BAKERY_PRODUCTION_CONFIRMED` y outbox `BAKERY_PRODUCTION_CONFIRMED` se emiten una vez.
3. Reconfirmación con la misma clave → `IDEMPOTENT`; stock sin segundo movimiento.
4. Ingrediente con `expiry_date` anterior a la fecha comercial Bogotá → `plan` = `INSUFFICIENT_INGREDIENTS`; `confirm` = `LOT_NOT_SELLABLE`; stock físico intacto.
5. Tras cerrar y reabrir SQLite, el replay de confirmación es `IDEMPOTENT` sin inventar stock.
6. Sin `BAKERY_PRODUCTION_EXECUTE` → `UNAUTHORIZED`.

## Pendientes fuera de este subbloque

- Certificación física de balanza: no aplica a pastelería; permanece en 3C-3 / hardware device profile.
- Central Sync / SCM: no improvisados aquí; outbox local queda listo para dispatch cuando el gate central lo autorice.
- UI de pastelería en Caja: no redesarrollada; el bloque conserva el diseño comercial aprobado.
