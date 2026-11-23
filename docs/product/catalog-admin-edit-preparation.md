# Preparación — edición administrativa de productos (Bloque 1)

Auditoría previa a implementar `catalog.product.update` / cambio de precio / fotografía.

## Reutilizado (no rehacer)

| Capacidad | Ubicación | Estado |
|---|---|---|
| Alta de producto + presentación + precio | `catalog.product.register`, `CatalogPanel` | IMPLEMENTADO |
| Alta de presentación adicional | `catalog.presentation.register` (IPC) | Backend listo; UI de catálogo aún no la expone |
| Política alimentaria (Salsamentaria) | `catalog.food_policy.upsert` | IMPLEMENTADO |
| Importación CSV de existencias | `InventoryCsvImport` → `inventory.stock.receive` | IMPLEMENTADO (no es alta masiva de catálogo ni XLSX) |
| Lectura vendible + disponibilidad | `catalog.item.list` / `find` + inventario | IMPLEMENTADO en Bloque 1 |

## Ausente (no inventar en este bloque)

| Capacidad | Evidencia |
|---|---|
| Caso de uso `catalog.product.update` | No existe bajo `apps/pos-local-service/src/catalog/` |
| IPC de actualización de nombre/código/precio/foto | No hay mensaje en `ipc-commercial.ts` |
| Imagen verificada de producto | `ProductAvatar` es fallback simbólico; sin referencia de media en catálogo |
| Umbral comercial «existencia baja» | Sin política de sucursal; no emitir `LOW` fabricado |
| Restricción farmacia en tarjeta de caja | Perfiles pharmacy existen aparte; no proyectados aún a `availability_state` |

## Requisitos de una edición segura (cuando se autorice)

1. Permiso dedicado (no reutilizar solo `CATALOG_PRODUCT_REGISTER`).
2. Versionado / expected_version o append de precio (no last-write-wins genérico).
3. Aislamiento tenant/company; no aceptar IDs de otra empresa del payload.
4. Auditoría append-only del cambio.
5. Fotografía: solo referencia verificada; nunca blob inventado en renderer.
6. No mutar unidad base ni factores de conversión con movimientos históricos sin migración.

## Sectores (núcleo comercial compartido)

| Sector | Superficie | Nota Bloque 1 |
|---|---|---|
| Comercio general | Catálogo + inventario + Caja | Tarjetas con disponibilidad real |
| Farmacia | `PharmacyPanel` + lotes | Intacta; no duplicar núcleo |
| Salsamentaria | food policy + transform/peso | Intacta; peso vía `KGM`/`GRM` + balanza |
| Pastelería | `BakeryPanel` recetas/producción | Intacta; consumo vía bakery IPC |

**No se declara edición comercial completa ni importación XLSX** en este bloque.
