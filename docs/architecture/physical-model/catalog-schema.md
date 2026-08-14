# TECH-002D: esquema físico de catálogo

## Estado y alcance

`IN_REVIEW` dentro de `TECH-002`.

Este bloque materializa `UC-CAT-001` a `UC-CAT-006` y `DEC-004` sin crear stock, precios ni impuestos implícitos. Incluye Product, Brand, Category, UnitOfMeasure, Variant, Presentation, Identifier y UnitConversion. No contiene DDL ni autoriza migraciones.

## Autoridad y ubicación

| Tabla lógica | Clase | Autoridad |
|---|---|---|
| UnitOfMeasure | `CENTRAL_MASTER_REPLICATED` | catálogo global publicado por plataforma |
| Brand, Category, Product, Variant, Presentation, Identifier, UnitConversion | `CENTRAL_MASTER_REPLICATED` | Catalog central; SQLite conserva snapshot requerido para operar |

El POS local no edita estos maestros en la primera fase. Creación y cambios se confirman centralmente y llegan como versiones; habilitar edición local futura exige caso de uso, autoridad y resolución de conflictos explícitos.

## Catálogos de apoyo

### `catalog.units_of_measure`

Global, sin `tenant_id`.

| Columna | Tipo PostgreSQL / SQLite | Regla |
|---|---|---|
| `id` | `uuid` / UUID TEXT | PK UUID v7 |
| `code` | `text` | uppercase, globalmente unique e inmutable |
| `name` | `text` | no vacío |
| `symbol` | `text` | no vacío |
| `dimension` | `text` | `COUNT`, `MASS`, `VOLUME`, `LENGTH`, `AREA`, `PACKAGING`, `TIME`, `SERVICE` |
| `precision_scale` | `smallint` / INTEGER | entre 0 y 6 |
| `status` | `text` | `ACTIVE`, `RETIRED` |
| `created_at` | timestamp | creación |
| `retired_at` | timestamp nullable | requerido si retirada |

`precision_scale` limita cantidades aceptadas; no modifica la escala física `(19,6)` de almacenamiento. Una cantidad debe ser múltiplo exacto de `10^-precision_scale`.

### `catalog.brands`

Tenant-scoped con RLS: `id`, `tenant_id`, `company_id`, `name`, `name_normalized`, `status`, `created_at`, `retired_at`, `version`.

Constraints:

- `UNIQUE (tenant_id, id)` y `(tenant_id, company_id, id)`;
- FK compuesta a Company;
- unique `(tenant_id, company_id, name_normalized)` para impedir reutilización ambigua;
- estados `ACTIVE`, `RETIRED` y coherencia de `retired_at`.

No se expone una operación para administrar marcas hasta que exista caso de uso autorizado; la tabla satisface la referencia `brand_id` ya exigida por Product.

### `catalog.categories`

Tenant-scoped con RLS.

Columnas: `id`, `tenant_id`, `company_id`, `code NULL`, `code_normalized NULL`, `name`, `name_normalized`, `status`, `created_at`, `retired_at NULL`, `version`.

Constraints:

- FKs y uniques compuestos por tenant/company;
- unique `(tenant_id, company_id, name_normalized)`;
- unique parcial `(tenant_id, company_id, code_normalized) WHERE code_normalized IS NOT NULL`;
- pares original/normalizado coherentes;
- estados `ACTIVE`, `RETIRED`;
- no contiene `parent_category_id`: no existe caso de uso vigente para jerarquía, movimiento o ciclos.

## `catalog.products`

Tenant-scoped con RLS.

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK |
| `tenant_id` | `uuid` | no | RLS |
| `company_id` | `uuid` | no | FK compuesta Company |
| `internal_code` | `text` | sí | valor presentado |
| `internal_code_normalized` | `text` | sí | acompaña a code |
| `name` | `text` | no | no vacío |
| `name_normalized` | `text` | no | búsqueda de similitud; no unique |
| `description` | `text` | sí | texto comercial |
| `brand_id` | `uuid` | sí | misma empresa |
| `category_id` | `uuid` | sí | misma empresa |
| `product_type` | `text` | no | `STANDARD`, `WEIGHTED`, `SERVICE`, `COMPOSITE`, `PREPARED`, `RETURNABLE`, `REGULATED` |
| `variant_policy` | `text` | no | `NO_VARIANTS`, `OPTIONAL_VARIANTS`, `REQUIRED_VARIANTS` |
| `base_unit_id` | `uuid` | no | FK UnitOfMeasure activa al crear |
| `stock_controlled` | `boolean` | no | control explícito |
| `lot_controlled` | `boolean` | no | control explícito |
| `expiration_controlled` | `boolean` | no | implica lote |
| `serial_controlled` | `boolean` | no | control explícito |
| `tax_category_id` | `uuid` | sí | FK tenant/company-aware a `tax.tax_classifications`, cerrada por R2-B |
| `business_attributes` | `jsonb` | no | value object canónico bajo schema allowlisted y versionado por `product_type`; no admite claves libres |
| `status` | `text` | no | `DRAFT`, `ACTIVE`, `INACTIVE` |
| `creation_idempotency_key` | `text` | no | alcance empresa |
| `creation_request_checksum` | `text` | no | request canónico |
| `created_at` | `timestamptz` | no | creación |
| `updated_at` | `timestamptz` | no | actualización |
| `deactivated_at` | `timestamptz` | sí | requerido si inactivo |
| `version` | `bigint` | no | expected version |

Constraints e índices:

- `UNIQUE (tenant_id, id)`, `(tenant_id, company_id, id)`;
- unique parcial `(tenant_id, company_id, internal_code_normalized) WHERE ... IS NOT NULL`, incluyendo inactivos mientras no exista política de reutilización;
- `UNIQUE (tenant_id, company_id, creation_idempotency_key)`;
- FKs compuestas a Brand y Category;
- `CHECK (NOT expiration_controlled OR lot_controlled)`;
- `business_attributes` se valida contra el contrato tipado publicado para `product_type`, rechaza campos desconocidos y no sustituye columnas, FK, estado, unidad, impuesto, capability o control de inventario; mientras no exista contrato publicado solo admite el objeto vacío;
- índice `(tenant_id, company_id, status, name_normalized)` requiere una columna `name_normalized text NOT NULL`, almacenada y validada junto con `name`;
- no se crea stock, precio ni tax snapshot al insertar Product.

La columna `name_normalized` forma parte de la tabla para búsqueda, pero no es unique: productos con nombres iguales pueden coexistir; el sistema solo informa similitud.

## Variantes

### `catalog.product_variants`

Columnas: `id`, `tenant_id`, `company_id`, `product_id`, `canonical_attributes jsonb`, `attributes_checksum text`, `status`, `creation_idempotency_key`, `creation_request_checksum`, `created_at`, `retired_at NULL`, `version`.

Constraints:

- FK `(tenant_id, company_id, product_id)`;
- `UNIQUE (tenant_id, company_id, product_id, attributes_checksum)`;
- `UNIQUE (tenant_id, company_id, creation_idempotency_key)`;
- `canonical_attributes` es objeto canónico validado y su checksum debe coincidir;
- no contiene unidad, SKU, precio, stock ni identificador operativo;
- estados `ACTIVE`, `RETIRED`.

No se crea `ProductVariantAttributeValue` separado mientras el conjunto de atributos siga siendo realmente abierto y no exista caso de uso que exija catálogo tipado de atributos. `DEC-004` permite atributos canónicos; si se introduce búsqueda/regulación por atributo, se requiere contrato y migración explícitos.

## Presentaciones

### `catalog.product_presentations`

| Columna | Tipo PostgreSQL | Nulable | Regla |
|---|---|---:|---|
| `id` | `uuid` | no | PK e identidad vendible |
| `tenant_id` | `uuid` | no | RLS |
| `company_id` | `uuid` | no | scope |
| `product_id` | `uuid` | no | FK Product |
| `variant_id` | `uuid` | sí | FK Variant del mismo Product |
| `name` | `text` | no | no vacío |
| `name_normalized` | `text` | no | equivalencia |
| `internal_sku` | `text` | sí | valor presentado |
| `internal_sku_normalized` | `text` | sí | acompaña SKU |
| `unit_id` | `uuid` | no | FK UnitOfMeasure |
| `contained_quantity` | `numeric(19,6)` | no | `> 0` y respeta precision_scale |
| `quantity_scale` | `smallint` | no | 0..6 y no mayor que unidad |
| `variable_quantity` | `boolean` | no | habilita límites/tara |
| `minimum_quantity` | `numeric(19,6)` | sí | `> 0` |
| `maximum_quantity` | `numeric(19,6)` | sí | `>= minimum` |
| `tare_quantity` | `numeric(19,6)` | sí | `>= 0`, menor que máximo cuando exista |
| `scale_format` | `text` | sí | código versionado de codificación de medición aprobado; neutral a adapter/proveedor |
| `sales_enabled` | `boolean` | no | capacidad |
| `purchasing_enabled` | `boolean` | no | capacidad |
| `inventory_enabled` | `boolean` | no | capacidad |
| `breakable` | `boolean` | no | posibilidad, no movimiento |
| `stock_mode` | `text` | no | `INDEPENDENT`, `CONVERTED_TO_BASE`, `DERIVED`, `NON_STOCK` |
| `status` | `text` | no | `ACTIVE`, `INACTIVE` |
| `creation_idempotency_key` | `text` | no | alcance empresa |
| `creation_request_checksum` | `text` | no | request canónico |
| `created_at` | `timestamptz` | no | creación |
| `deactivated_at` | `timestamptz` | sí | retiro operativo |
| `version` | `bigint` | no | concurrencia |

Constraints e índices:

- `UNIQUE (tenant_id, id)` y `(tenant_id, company_id, product_id, id)`;
- FK Product y constraint trigger que exige `variant.product_id = product_id` y mismo scope;
- unique parcial de SKU por empresa, incluyendo inactivos mientras no haya política de reutilización;
- `UNIQUE (tenant_id, company_id, creation_idempotency_key)`;
- checks de límites variables y escala;
- al menos una de `sales_enabled`, `purchasing_enabled`, `inventory_enabled` debe ser true;
- `NON_STOCK` implica `inventory_enabled = false`; los demás modos requieren inventario habilitado;
- no contiene factor de conversión: el input opcional crea UnitConversion en la misma transacción.

La equivalencia de presentación se controla con dos unique funcionales: uno para `variant_id IS NULL` y otro para `variant_id IS NOT NULL`, sobre Product/Variant, Unit, `contained_quantity`, `stock_mode` y nombre normalizado. Esto evita que NULL permita duplicados silenciosos.

`scale_format` no selecciona hardware ni contiene SDK, marca, modelo, puerto o credencial. Un adapter futuro interpreta la codificación y entrega una medición validada al dominio; compatibilidad física y configuración del dispositivo permanecen fuera de Catalog.

## Identificadores

### `catalog.product_identifiers`

Columnas: `id`, `tenant_id`, `company_id`, `product_id`, `variant_id NULL`, `presentation_id`, `identifier_type`, `raw_value`, `normalized_value`, `status`, `valid_from`, `valid_until NULL`, `creation_idempotency_key`, `creation_request_checksum`, `created_at`, `version`.

Constraints:

- FKs compuestas aseguran que Product, Variant opcional y Presentation coincidan;
- `UNIQUE (tenant_id, company_id, identifier_type, normalized_value)` conserva no reutilización hasta que exista política explícita;
- `UNIQUE (tenant_id, company_id, creation_idempotency_key)`;
- estados `ACTIVE`, `INACTIVE` y rango temporal válido;
- índice `(tenant_id, company_id, identifier_type, normalized_value, status)` para captura POS;
- todo identificador operativo resuelve directamente a Presentation.

## Conversiones

### `catalog.unit_conversions`

| Columna | Tipo PostgreSQL | Regla |
|---|---|---|
| `id` | `uuid` | PK |
| `tenant_id`, `company_id`, `product_id` | `uuid` | mismo scope |
| `variant_id` | `uuid NULL` | igual en origen y destino, incluido NULL |
| `source_presentation_id` | `uuid` | diferente de destino |
| `target_presentation_id` | `uuid` | diferente de origen |
| `conversion_factor` | `numeric(19,10)` | exacto y `> 0` |
| `reversible` | `boolean` | posibilidad matemática/operativa aprobada |
| `requires_authorization` | `boolean` | política de ejecución |
| `waste_policy` | `text` | código estable |
| `cost_policy` | `text` | código estable |
| `lot_policy` | `text` | código estable |
| `valid_from`, `valid_until` | timestamp | rango no vacío |
| `status` | `text` | `ACTIVE`, `INACTIVE` |
| `version` | `bigint` | versión publicada, inmutable |
| `creation_idempotency_key`, `creation_request_checksum` | `text` | idempotencia |
| `created_at` | timestamp | creación |

Constraints:

- constraint trigger exige mismo tenant/company/product y `variant_id IS NOT DISTINCT FROM` entre regla, origen y destino;
- dimensiones iguales, salvo equivalencia explícita por producto permitida por el contrato;
- `UNIQUE (tenant_id, company_id, product_id, source_presentation_id, target_presentation_id, version)`;
- no solapamiento de vigencias activas para el mismo par/dirección, probado con constraint trigger para no exigir extensiones PostgreSQL no aprobadas;
- detección de ciclos en el grafo vigente dentro de la transacción de publicación;
- una versión publicada no cambia; se cierra vigencia y se publica otra.

El input `base_presentation_id`/`conversion_factor` de `UC-CAT-005` crea Presentation y esta regla dentro de una sola transacción. No se persiste una segunda copia del factor en Presentation.

## SQLite

Tablas locales:

```text
catalog_units_of_measure
catalog_brands
catalog_categories
catalog_products
catalog_product_variants
catalog_product_presentations
catalog_product_identifiers
catalog_unit_conversions
```

Aplican UUID/timestamps/booleanos/JSON/decimales de `physical-conventions.md`. Los decimales de cantidad usan TEXT `(19,6)` y factores TEXT `(19,10)`. POS Local Service reemplaza snapshots por versión aceptada dentro de una transacción; no crea ni fusiona maestros.

## Fronteras transaccionales

### Crear Product

Valida idempotencia/checksum, scopes, Category/Brand/Unit, reglas de control, inserta Product, AuditEvent y outbox en un commit. No toca Inventory, Pricing ni Tax.

### Actualizar/desactivar Product

Usa expected version, valida dependencias mediante puertos propietarios, actualiza campos permitidos, registra before/after sanitizado en AuditEvent y outbox. Desactivar no borra ni cambia snapshots históricos.

### Crear Presentation

Bloquea Product/Variant, valida equivalencia, unidad, escala y stock mode; crea Presentation y, si se suministró conversión base, UnitConversion; agrega AuditEvent/outbox y confirma atómicamente. No crea stock.

### Convertir existencias

Catalog solo entrega la UnitConversion vigente. La transacción de ejecución pertenece a Inventory y crea movimientos/merma/costo allí; nunca actualiza cantidades en Catalog.

## Pruebas obligatorias

1. aislamiento tenant/company en todas las FKs;
2. internal code, SKU e identifier sin duplicación normalizada;
3. misma idempotency key/checksum retorna el mismo agregado; checksum distinto entra en conflicto;
4. Product con vencimiento sin lotes se rechaza;
5. Variant de otro Product no entra en Presentation;
6. cantidad y factor cero, negativos o fuera de precisión se rechazan en ambos dialectos;
7. presentación equivalente duplicada se rechaza incluso con `variant_id NULL`;
8. ciclos y solapamientos de UnitConversion se rechazan bajo concurrencia;
9. factor no se duplica en ProductPresentation;
10. crear Product/Presentation no crea stock ni precio;
11. desactivar conserva historia y no habilita reutilización silenciosa;
12. SQLite aplica snapshot completo de catálogo atómicamente;
13. identificador siempre resuelve a Presentation del mismo Product/Variant;
14. RLS y constraints impiden acceso o referencia cruzada.

## Gate del bloque

Catalog permanece `IN_REVIEW`. R1 clasifica sus condiciones sin declararlas satisfechas por inferencia:

| Condición | Clasificación R1 | Tratamiento |
|---|---|---|
| identidad, scope, presentaciones, identificadores y conversiones | satisfecha documentalmente | contrato de este bloque y `DEC-004` |
| `PriceChange` como posible persistencia duplicada | satisfecha | reclasificado por R1: no es entidad/tabla |
| cierre de `tax_category_id` entre Catalog y Tax | satisfecha | R2-B fija FK tenant/company-aware a TaxClassification en `tax-schema.md` |
| constraints de equivalencia/ciclos PostgreSQL y SQLite | pendiente | R3 y futuras pruebas por dialecto autorizadas |
| auditoría columna por columna contra `UC-CAT-001...006` | pendiente | cierre del bloque antes de migración |

Pasa a `APPROVED_FOR_MIGRATION_DESIGN` solo cuando las condiciones pendientes tengan evidencia. R2-B cerró Pricing/Tax sin iniciar pruebas ejecutables.

La primera migración permanece `NO-GO`.
