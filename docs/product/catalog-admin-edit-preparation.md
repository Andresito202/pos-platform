# Edición administrativa de productos — Bloque 2

Estado tras implementar UC-CAT-002, precio autorizado y media verificada en la
rama `cursor/catalog-inventory-caja-c53a`.

## Reutilizado (no rehacer)

| Capacidad | Ubicación | Estado |
|---|---|---|
| Alta de producto + presentación + precio | `catalog.product.register`, `CatalogPanel` | IMPLEMENTADO |
| Lectura vendible + disponibilidad | `catalog.item.list` / `find` + inventario | IMPLEMENTADO |
| Reserva / deducción FEFO / recepción | inventario compartido | IMPLEMENTADO (evidencia en tests) |
| Importación CSV de existencias | `InventoryCsvImport` → `inventory.stock.receive` | IMPLEMENTADO (no es alta masiva de catálogo ni XLSX) |
| Sectores Farmacia / Salsamentaria / Pastelería | paneles + IPC sectoriales | IMPLEMENTADO como overlays; no duplican núcleo |

## Materializado en este bloque

| Capacidad | Evidencia |
|---|---|
| `catalog.product.update` (nombre, código, estado, presentación, barcode) | Use case + IPC + UI admin + tests |
| `catalog.price.publish` (supersede ACTIVE) | Use case + IPC + UI |
| `catalog.media.put` / `clear` / `get` | Validación magic/size/dims + disco + refs en SQLite |
| `product_version` / `presentation_version` / `media_id` en list/find | Contratos + proyección |
| Invalidación local de tarjetas Caja | Evento `pos:catalog-inventory-changed` (sin polling) |
| `ProductAvatar` con foto verificada o fallback simbólico | Renderer + caché de sesión por `media_id` |

## Campos realmente editables

- Nombre comercial
- Código interno
- Estado ACTIVE/INACTIVE
- Nombre de presentación y código de barras (con versión de presentación)
- Precio vía publish (no overwrite in-place)
- Fotografía (referencia verificada)

**No editables aquí (contrato/persistencia ausente o prohibido):** descripción, marca, categoría, stock, `unit_code`, `unit_precision`, factores de conversión.

## Corrección P1–P2 (post 41a14390)

- Media: stage → confirm → attach; abandon/reclaim evita ACTIVE huérfanos y archivos abandonados.
- Caché: ligada a sesión local; wipe en logout/cambio de usuario/revocación; revoke ObjectURL.
- Caja: invalidación local con cola si hay list in-flight (no multicaja).
- Admin: búsqueda/selección desde catálogo; versiones internas; recarga ante VERSION_CONFLICT.

## Pendiente explícito — Bloque 3

1. Columnas/migración autorizada para descripción, marca y categoría.
2. Importación XLSX y alta masiva de catálogo (CSV actual solo existencias; no presentar CSV como XLSX).
3. Proyección farmacia (lotes/bloqueos) a `availability_state` en tarjetas Caja.
4. Umbral comercial «existencia baja» (`LOW`) por política de sucursal.
5. Certificación física de balanza / hardware (no simulada).
6. Optimización server-side de variantes de imagen (hoy el renderer redimensiona a tarjeta; el servicio valida).
7. Canal de invalidación entre ventanas/dispositivos (hoy solo ventana local).

## Sectores

| Sector | Estado Bloque 2 |
|---|---|
| Comercio general | Núcleo compartido + edición + disponibilidad |
| Farmacia | Intacta; disponibilidad dispensable por lotes **no** proyectada aún a tarjeta |
| Salsamentaria | Intacta; peso vía presentaciones `KGM`/`GRM` + balanza cuando exista hardware |
| Pastelería | Intacta; consumo/producción vía bakery IPC existentes |

**No se declara END_TO_END comercial ni PRODUCTION.** No se declara XLSX.
