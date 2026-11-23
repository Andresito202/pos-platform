# Bloques 3A/3B — importación y disponibilidad Caja

## Separación vigente (no mezclar writers)

1. **Catálogo:** plantilla `camacho-catalogo.csv|xlsx` → preview → confirm
   - Alta: `catalog.product.register`
   - Actualización comercial: `catalog.product.update`
   - Precio: `catalog.price.publish`
2. **Existencias:** plantilla `camacho-existencias.csv|xlsx` → preview → confirm
   - Solo `inventory.stock.receive` (suma, no sobrescribe saldo)
   - Identidad idempotente `inventory-csv:{import_id}:{row_id}`

La selección de archivo **no escribe**. La confirmación puede fallar a mitad;
las filas ya confirmadas permanecen. Si el alta ya se aplicó bajo `import_id`+
`row_id`, el reintento es `IDEMPOTENT` y **no** reescribe cambios posteriores
de otro administrador.

## Seguridad XLSX

Límites publicados: comprimido ≤1 MiB, expandido ≤2 MiB, entrada ≤1 MiB,
≤64 entradas ZIP. Filtro fflate por tamaño declarado antes de inflar; recuento
real tras expandir. Sin macros, fórmulas ni rutas fuera de OOXML permitido.

## Disponibilidad Caja (3B)

Estados: `AVAILABLE`, `LOW`, `OUT_OF_STOCK`, `RESTRICTED`,
`VERIFICATION_REQUIRED`, `NOT_TRACKED`.

- Dispensable = lotes `AVAILABLE` no vencidos − reservas (sin doble descuento).
- `quantity_unsellable` = físico − sellable (vencido/bloqueado).
- Umbral `low_stock_threshold` por presentación (MIGRATION_032), permiso
  `CATALOG_PRODUCT_UPDATE`, precisión acotada a la unidad.
- Farmacia: perfil con receta/controlado → `VERIFICATION_REQUIRED`; registro
  inválido/vencido → `RESTRICTED`. La venta definitiva sigue en backend.

## Presentaciones y conversión (3C-2)

- Misma `codigo_producto` + distinta `presentacion` → `catalog.presentation.register`.
- `cantidad_por_presentacion` + `presentacion_base` aprueban una regla
  `inventory.conversion.rule.approve` (1 de esta → N de la base). No mueve stock.
- Ejecutar fraccionamiento/caja→unidad sigue siendo
  `inventory.conversion.execute` con lote autorizado.

## Pendiente 3C / multicaja

- Canal de invalidación entre ventanas/dispositivos.
- Atomicidad de archivo completo.
- Cambio de `stock_controlled` en actualización.
- Zona horaria por sucursal en evaluación de vencimiento (hoy America/Bogota fija).
