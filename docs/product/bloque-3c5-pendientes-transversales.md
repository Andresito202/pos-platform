# 3C-5 — Pendientes transversales (revisión integral)

**Rama:** `cursor/catalog-inventory-caja-c53a`  
**Base de evidencia:** commits 3C-1…3C-4 sobre `a134c732`; este documento no duplica suites ya ejecutadas.

## Criterio aplicado

- Corregir en esta rama solo defectos P0/P1 de integridad de ventas, pagos o stock monodispositivo.
- Documentar con contrato, evidencia y bloqueo concreto lo que depende de Central Sync, SCM o un alcance UI/contrato nuevo.
- No improvisar Central ni SCM aquí.

## Matriz

| # | Pendiente | Estado | Evidencia / contrato | Acción en 3C |
|---|-----------|--------|----------------------|--------------|
| 1 | Invalidación entre ventanas | PARTIAL | `catalog-invalidate.ts` — `CustomEvent` por renderer; comentario: no multi-ventana. Tests: `catalog-invalidate-coalesce.test.ts`. IPC main no hace broadcast entre `BrowserWindow`. | Documentado. Canal Electron dedicado = trabajo posterior. No afecta integridad SQLite única. |
| 2 | Sync de stock entre cajas | BLOCKED_EXTERNAL | Misma DB: FEFO/reservas en `sqlite-inventory-store` + MIGRATION_024. Multicaja offline: `bloque5-offline-sync-e2e.test.ts`, `docs/testing/bloque5-offline-sync-20261117.md`, `shared-inventory-20261115.md`. | No corregir en rama. Requiere Central Sync + proyección/reservas compartidas. |
| 3 | Conflictos offline | PARTIAL | Monodispositivo: `VERSION_CONFLICT` / `IDEMPOTENCY_CONFLICT` / `INSUFFICIENT_STOCK` en handlers y stores; recuperación IN_FLIGHT en `durable-sync-store`. Multicaja: sin flujo de compensación de producto. | Local cubierto (3C-1/024). Multicaja → Central. |
| 4 | Zona horaria por sucursal | PENDING | Inventario FEFO: `commercial-calendar.ts` default `America/Bogota`; no lee timezone de sucursal local. Modelo central: `organization.branches.timezone`. | Documentado. Extensión por sucursal = cambio autorizado aparte. Colombia fija permanece vigente. |
| 5 | Fecha comercial del renderer | PARTIAL | Cobro/FEFO: servidor `commercialBusinessDate()`. Renderer: `useCommercialSale.operationTime()` usa calendario del host; `InventoryPanel.today()` usa UTC `toISOString`. Import: columna `business_date`. | P1 documental/recibo, no FEFO al cobrar. Alinear renderer = ítem explícito posterior. |
| 6 | Presentaciones adicionales XLSX | IMPLEMENTED | 3C-2: `presentacion` / `cantidad_por_presentacion` / `presentacion_base` → presentación secundaria + `conversion.rule.approve`. Tests import + docs `catalog-xlsx-import-next-block.md`. | Cerrado en 3C-2. |
| 7 | Cambio autorizado `stock_controlled` | PARTIAL | Alta e import de alta lo setean. `update-product-use-case` y update de import **no** mutan el flag. | Documentado. Requiere permiso/contrato de cambio; no parche silencioso en import. |
| 8 | Atomicidad de importaciones | PARTIAL (por diseño) | Confirm fila a fila; fallo a mitad conserva filas ya confirmadas; reintento `IDEMPOTENT` por `catalog-import:{import_id}:{row_id}`. Sin rollback de archivo completo. | Contrato operativo documentado. No P0 de doble stock si se reintenta con las mismas claves. |
| 9 | Recuperación parcial | PARTIAL | Caja: `pendingChange` / `retryPending`. Bakery 3C-4: reopen SQLite → confirm `IDEMPOTENT`. Sync: `recoverInterruptedDispatches`. Pagos parciales: estados + UI paneles. | Sin P0 nuevo monodispositivo. Reanudar import desde fila N / reconciliación Central: pendiente externo. |

## Integridad ventas / pagos / stock (esta rama)

| Invariante | Estado en 3C |
|------------|--------------|
| Venta no COMPLETED si el inventario no pudo descontarse | Cubierto (PaymentRollback / `INSUFFICIENT_STOCK` + 3C-1 `sale.cancel`) |
| Reserva de venta no liberada por IPC de reservas manuales | Conservado; liberación vía cancelación autorizada |
| Pagos confirmados no se anulan solos | Conservado; sin auto-refund |
| Producción pastelería no inventa stock en React | Cubierto (3C-4 → `executeTransform`) |
| Multicaja offline sin stock global | Bloqueo externo documentado; no se simula progreso |

## Dependencias externas (bloqueo concreto)

1. **Central Sync** — proyección de stock/reservas entre dispositivos; ACK de `INVENTORY_RESERVATION_*`; gate `central-sync:gate` / workflow dedicado. Owner: sync central, no Caja.
2. **SCM comercial** — `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`; PR #127 fuera de alcance. No mezclar en import/caja.
3. **Canal multi-ventana Electron** — invalidación entre `BrowserWindow` del mismo host; no sustituye sync entre cajas.

## Pruebas de este subbloque

Ninguna suite nueva: 3C-5 es revisión documental. Las suites de 3C-1…3C-4 ya ejercitaron reservas, pagos/stock, presentaciones, peso/transform, producción, reinicio e idempotencia. No se declara PASS adicional aquí.

## Cierre de bloque 3C

Con 3C-1…3C-5 en esta rama: pendientes operativos de Catálogo/Inventario/Caja quedan **cerrados o documentados con bloqueo**. No quedan P0/P1 monodispositivo de integridad ventas/pagos/stock sin resolución o justificación verificable en la matriz anterior.
