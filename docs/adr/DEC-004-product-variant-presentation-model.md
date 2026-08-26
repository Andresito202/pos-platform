# DEC-004 — Separación definitiva entre Product, ProductVariant y ProductPresentation

## Estado

`DONE`

## Prioridad

`P0`

## Contexto

El modelo actual del catálogo contiene una ambigüedad estructural entre:

- `Product`;
- `ProductVariant`;
- `ProductPresentation`.

Parte de la documentación usa `ProductVariant` para representar atributos comerciales como:

- color;
- talla;
- sabor;
- concentración;
- modelo.

Otra parte utiliza el mismo concepto para representar formas físicas o comerciales como:

- unidad;
- bolsa;
- botella;
- caja;
- paca;
- bulto;
- empaque.

Esta mezcla produce riesgos directos en:

- identidad del artículo vendible;
- códigos de barras;
- SKU;
- listas de precios;
- inventario;
- lotes;
- costos;
- impuestos;
- conversiones;
- compras;
- ventas;
- devoluciones;
- sincronización;
- migraciones;
- diseño físico.

La decisión debe cerrar definitivamente las responsabilidades y cardinalidades entre los tres conceptos.

---

# Decisión

El modelo conceptual oficial será:

```text
Product
├── ProductPresentation
└── ProductVariant
    └── ProductPresentation
```

Representación cardinal:

```text
Product 1 ─── 0..N ProductVariant
Product 1 ─── 1..N ProductPresentation
ProductVariant 1 ─── 1..N ProductPresentation
```

Una presentación puede pertenecer:

```text
directamente a Product
```

o:

```text
a ProductVariant
```

Nunca simultáneamente a dos variantes.

La jerarquía lógica será:

```text
Product
→ identidad maestra

ProductVariant
→ combinación opcional de atributos comerciales

ProductPresentation
→ unidad concreta de compra, almacenamiento o venta
```

---

# Regla principal

Todo artículo vendible debe resolverse finalmente a una `ProductPresentation`.

No se vende directamente:

- un `Product`;
- una `ProductVariant`.

El elemento operativo para:

- escaneo;
- precio;
- inventario;
- lote;
- venta;
- compra;
- devolución;
- conversión;
- ticket;

será una `ProductPresentation`.

---

# Alcance

Esta decisión define:

- identidad de producto;
- identidad de variante;
- identidad de presentación;
- cardinalidades;
- obligatoriedad de presentación;
- opcionalidad de variante;
- SKU;
- códigos de barras;
- unidades;
- conversiones;
- inventario;
- lotes;
- costos;
- precios;
- promociones;
- impuestos;
- compras;
- ventas;
- devoluciones;
- migración;
- invariantes;
- consecuencias para persistencia.

No define todavía:

- tablas físicas definitivas;
- tipos SQL;
- índices;
- migraciones ejecutables;
- endpoints finales;
- componentes de frontend;
- motor concreto de atributos;
- estrategia completa de búsqueda;
- catálogo externo;
- integración con proveedores;
- implementación de GS1.

---

# Documentos relacionados

Esta decisión debe mantenerse alineada con:

- `docs/architecture/conceptual-data-model.md`;
- `docs/domain/commercial-engine.md`;
- `docs/domain/glossary.md`;
- `docs/domain/event-catalog.md`;
- `docs/use-cases/catalog/UC-CAT-001-create-product.md`;
- `docs/use-cases/catalog/UC-CAT-002-update-product.md`;
- `docs/use-cases/catalog/UC-CAT-003-assign-identifier.md`;
- `docs/use-cases/catalog/UC-CAT-004-create-variant.md`;
- `docs/use-cases/catalog/UC-CAT-005-create-presentation.md`;
- `docs/use-cases/catalog/UC-CAT-006-convert-presentation.md`;
- `docs/adr/DEC-003-pricing-calculation-order.md`;
- `docs/product/backlog.md`.

Esta decisión condiciona:

- `CAT-002`;
- `TECH-002`;
- `TECH-003`;
- inventario;
- compras;
- pricing;
- impuestos;
- sincronización;
- importación controlada desde catálogos externos.

---

# Objetivos

1. Eliminar la ambigüedad entre variante y presentación.
2. Garantizar identidad determinista del artículo vendible.
3. Evitar inventario duplicado.
4. Evitar códigos de barras ambiguos.
5. Soportar productos simples.
6. Soportar productos con variantes.
7. Soportar múltiples presentaciones.
8. Soportar unidades y empaques.
9. Soportar fraccionamiento.
10. Soportar conversiones.
11. Soportar lotes.
12. Soportar precios específicos.
13. Soportar impuestos específicos.
14. Soportar productos por peso.
15. Soportar compras y ventas en unidades diferentes.
16. Mantener historial.
17. Permitir migración controlada.
18. Preparar el diseño físico.

---

# Principios

1. `Product` representa identidad maestra.
2. `ProductVariant` representa atributos comerciales.
3. `ProductPresentation` representa forma concreta operativa.
4. Las variantes son opcionales.
5. Las presentaciones son obligatorias para vender.
6. El inventario pertenece a presentaciones.
7. Los lotes pertenecen a inventario de presentaciones.
8. Los códigos operativos deben resolver a una presentación.
9. El precio final se resuelve para una presentación.
10. Una variante no representa una caja, bolsa o paca.
11. Una presentación no representa color, sabor o talla.
12. Las conversiones ocurren entre presentaciones compatibles.
13. Una conversión no cambia de variante.
14. La identidad histórica no se modifica destructivamente.
15. La desactivación no elimina historial.
16. Las relaciones deben ser deterministas.
17. No se permite doble contabilización de stock.
18. Todo artículo escaneable debe resolver sin ambigüedad.
19. Las reglas deben aislar tenants y empresas.
20. La migración no debe inferir relaciones inseguras.

---

# Terminología

## Product

Entidad maestra que representa el concepto comercial general.

Ejemplos:

- gaseosa;
- camiseta;
- arroz;
- ibuprofeno;
- pintura;
- tornillo;
- pollo;
- servicio de domicilio.

No representa todavía una unidad vendible concreta.

## ProductVariant

Combinación opcional de atributos que diferencia una alternativa comercial del producto.

Ejemplos:

- gaseosa / sabor naranja;
- camiseta / azul / talla M;
- ibuprofeno / 400 mg;
- pintura / color blanco;
- teléfono / modelo 128 GB.

## ProductPresentation

Forma concreta en la que un producto o variante se:

- compra;
- recibe;
- almacena;
- vende;
- identifica;
- convierte;
- devuelve.

Ejemplos:

- unidad;
- botella de 400 ml;
- botella de 1,5 litros;
- bolsa de 500 g;
- caja de 24 unidades;
- paca de 12 bolsas;
- bulto de 50 kg.

---

# Diferencia entre variante y presentación

## Variante

Responde:

```text
¿Qué versión comercial del producto es?
```

Ejemplos:

```text
color azul
talla M
sabor naranja
concentración 400 mg
modelo 128 GB
```

## Presentación

Responde:

```text
¿En qué forma y cantidad se compra, almacena o vende?
```

Ejemplos:

```text
unidad
caja de 20 tabletas
botella de 400 ml
paquete de 6
bulto de 50 kg
```

## Regla

Los siguientes conceptos no son equivalentes:

```text
talla M ≠ caja x12
sabor naranja ≠ botella 400 ml
concentración 400 mg ≠ caja de 20 tabletas
color blanco ≠ galón
```

---

# Ejemplos completos

## Producto sin variantes

```text
Product:
Arroz Roa
```

Presentaciones:

```text
bolsa de 500 g
bolsa de 1 kg
paca de 12 bolsas de 1 kg
```

No requiere `ProductVariant`.

## Producto con variantes

```text
Product:
Camiseta deportiva
```

Variantes:

```text
azul / talla M
azul / talla L
roja / talla M
roja / talla L
```

Cada variante puede tener presentaciones:

```text
unidad
paquete de 3
```

## Producto regulado

```text
Product:
Ibuprofeno
```

Variantes:

```text
200 mg
400 mg
600 mg
```

Presentaciones de la variante `400 mg`:

```text
tableta individual
blíster x10
caja x20
```

## Producto líquido

```text
Product:
Gaseosa
```

Variantes:

```text
original
naranja
limón
```

Presentaciones de cada variante:

```text
botella 400 ml
botella 1,5 L
botella 2,5 L
paquete x6 de 400 ml
```

---

# Product

## Propósito

Representar la identidad comercial general compartida por todas sus variantes y presentaciones.

## Responsabilidades

`Product` conserva:

- identidad maestra;
- empresa;
- nombre general;
- descripción;
- marca;
- categoría;
- tipo de producto;
- políticas generales;
- atributos comunes;
- estado;
- configuración base.

## Atributos conceptuales

- `id`;
- `company_id`;
- `internal_code`;
- `name`;
- `description`;
- `brand_id` opcional;
- `category_id`;
- `product_type`;
- `variant_policy`;
- `stock_controlled`;
- `lot_controlled`;
- `expiration_controlled`;
- `regulated`;
- `active`;
- `created_at`;
- `updated_at`;
- `version`.

## No pertenece directamente a Product

No deben almacenarse como verdad operativa final en `Product`:

- stock disponible;
- lote concreto;
- código de barras operativo;
- precio final de venta;
- costo unitario concreto;
- unidad de venta;
- factor de conversión;
- cantidad contenida.

Pueden existir valores predeterminados o plantillas, pero el artículo operativo final es la presentación.

---

# Política de variantes

`Product` debe declarar una política:

- `NO_VARIANTS`;
- `OPTIONAL_VARIANTS`;
- `REQUIRED_VARIANTS`.

## NO_VARIANTS

El producto no admite variantes.

Sus presentaciones dependen directamente del producto.

Ejemplo:

```text
Arroz Roa
→ bolsa 500 g
→ bolsa 1 kg
```

## OPTIONAL_VARIANTS

El producto puede tener variantes, pero no son obligatorias para todas las presentaciones.

Debe usarse con cuidado porque permite estructuras mixtas.

Ejemplo:

```text
producto general
→ presentación sin variante
→ variante A
   → presentación
```

## REQUIRED_VARIANTS

Toda presentación activa debe depender de una variante.

Ejemplo:

```text
Camiseta
→ azul / M
   → unidad
→ azul / L
   → unidad
```

---

# Regla sobre estructuras mixtas

La estructura mixta:

```text
Product
├── Presentation sin variante
└── Variant
    └── Presentation
```

solo se permite cuando `variant_policy = OPTIONAL_VARIANTS`.

Debe existir una justificación comercial explícita.

## Riesgo

Una estructura mixta puede producir:

- ambigüedad de precios;
- identificadores confusos;
- promociones incorrectas;
- errores de inventario;
- migraciones difíciles.

## Regla predeterminada

La política recomendada será:

```text
NO_VARIANTS
```

o:

```text
REQUIRED_VARIANTS
```

Se evitará `OPTIONAL_VARIANTS` salvo necesidad real.

---

# ProductVariant

## Propósito

Representar una combinación comercial única de atributos dentro de un producto.

## Atributos conceptuales

- `id`;
- `product_id`;
- `canonical_key`;
- `internal_reference` opcional;
- `display_name`;
- `active`;
- `created_at`;
- `updated_at`;
- `version`.

## Atributos de variante

Los valores pueden incluir:

- color;
- talla;
- sabor;
- concentración;
- modelo;
- capacidad;
- material;
- acabado;
- género;
- estilo.

## Regla

Los atributos admitidos deben definirse por:

- categoría;
- tipo de producto;
- empresa;
- política.

No se permite agregar atributos arbitrarios sin control cuando afecten identidad, búsqueda o persistencia.

---

# Identidad de variante

Una variante se identifica mediante una clave canónica.

Ejemplo:

```text
color=BLUE|size=M
```

La clave debe ser:

- normalizada;
- determinista;
- independiente del orden de entrada;
- única dentro del producto;
- inmutable cuando existan operaciones históricas.

## Ejemplo

Estas entradas representan la misma variante:

```text
color=azul, talla=M
talla=M, color=azul
```

No pueden crear dos registros.

---

# Inmutabilidad de variante

Una vez una variante tenga:

- ventas;
- compras;
- inventario;
- códigos;
- precios;
- presentaciones;

no deben modificarse destructivamente sus atributos estructurales.

## Corrección

Cuando el cambio altera identidad comercial:

```text
crear nueva variante
→ desactivar variante anterior
→ migrar relaciones cuando sea seguro
```

## Cambios permitidos

Pueden modificarse sin cambiar identidad:

- nombre visible;
- descripción;
- estado;
- metadatos no estructurales.

---

# ProductPresentation

## Propósito

Representar la unidad concreta y operativa utilizada en el negocio.

## Responsabilidades

Una presentación define:

- unidad;
- cantidad contenida;
- compra;
- venta;
- inventario;
- conversión;
- códigos;
- precio;
- impuestos;
- lotes;
- devoluciones.

## Atributos conceptuales

- `id`;
- `product_id`;
- `variant_id` opcional;
- `name`;
- `internal_sku`;
- `base_unit_id`;
- `contained_quantity`;
- `base_presentation_id` opcional;
- `conversion_factor` opcional;
- `sales_enabled`;
- `purchasing_enabled`;
- `inventory_enabled`;
- `breakable`;
- `stock_mode`;
- `active`;
- `created_at`;
- `updated_at`;
- `version`.

---

# Consistencia entre Product y ProductVariant

Si una presentación tiene `variant_id`, entonces:

```text
presentation.product_id
=
variant.product_id
```

## Prohibición

No se permite:

```text
Product A
└── Variant A1

Product B
└── Presentation B1
    └── variant_id = A1
```

Debe rechazarse por integridad.

---

# Obligatoriedad de presentación

Todo producto comercializable debe tener al menos una presentación activa y vendible.

## Producto simple

Se crea una presentación predeterminada:

```text
unidad
```

## Producto por peso

Puede crearse una presentación:

```text
kilogramo
```

o:

```text
gramo
```

## Servicio

Debe existir una presentación no inventariable:

```text
servicio
```

con:

```text
stock_mode = NON_STOCK
```

## Regla

El sistema no debe crear stock, precio ni venta directamente sobre `Product`.

---

# Presentación predeterminada

Un producto o variante puede declarar una presentación primaria.

Debe existir como relación explícita:

- `default_sales_presentation_id`;
- `default_purchase_presentation_id`;
- `default_inventory_presentation_id`.

## Regla

Las tres pueden ser diferentes.

Ejemplo:

```text
comprar: caja x24
almacenar: unidad
vender: unidad
```

## Restricción

La presentación predeterminada debe pertenecer al mismo producto y, cuando aplique, a la misma variante.

---

# Cardinalidades definitivas

## Product y ProductVariant

```text
Product 1
ProductVariant 0..N
```

## Product y ProductPresentation

```text
Product 1
ProductPresentation 1..N para producto comercializable
```

## ProductVariant y ProductPresentation

```text
ProductVariant 1
ProductPresentation 1..N cuando la variante está activa y comercializable
```

## ProductPresentation y ProductVariant

```text
ProductPresentation 0..1 ProductVariant
```

## Regla

Una presentación pertenece exactamente a un producto y opcionalmente a una variante del mismo producto.

---

# Artículo vendible

El término conceptual oficial será:

```text
SellableItem
```

No necesariamente como tabla física, sino como proyección.

Un `SellableItem` representa:

```text
ProductPresentation activa
+ Product
+ ProductVariant opcional
+ identificador
+ precio
+ impuesto
+ disponibilidad
```

## Regla

El POS opera sobre `presentation_id`.

Puede mostrar:

- producto;
- variante;
- presentación;

pero la referencia persistida en la línea de venta debe resolver a una presentación.

---

# Snapshot de línea de venta

Una línea de venta debe conservar como mínimo:

- `product_id`;
- `variant_id` opcional;
- `presentation_id`;
- nombre de producto;
- nombre de variante;
- nombre de presentación;
- atributos de variante;
- unidad;
- cantidad contenida;
- SKU;
- código utilizado;
- precio;
- impuesto;
- versión;
- snapshot.

## Regla

Las ventas históricas no dependen de nombres actuales del catálogo.

---

# SKU

## Definición

El SKU identifica internamente una unidad operativa del catálogo.

## Nivel oficial

El SKU operativo principal pertenece a:

```text
ProductPresentation
```

## Motivo

La presentación determina:

- forma de venta;
- unidad;
- cantidad;
- inventario;
- precio;
- código;
- compra.

## Product y ProductVariant

Pueden tener:

- código maestro;
- referencia interna;
- código de familia;
- referencia de modelo.

Pero no sustituyen el SKU de presentación.

---

# Unicidad del SKU

El SKU activo debe ser único dentro de:

```text
company_id
```

## Reglas

1. Un SKU no identifica dos presentaciones activas.
2. No se reutiliza inmediatamente.
3. La desactivación conserva historial.
4. Una migración debe detectar duplicados.
5. El SKU no depende del nombre visible.
6. El SKU no cambia por traducción.
7. Un SKU puede generarse o asignarse manualmente.
8. La restricción física usa `(company_id, normalized_sku)` para identificadores activos.
9. Compartir catálogo entre empresas requerirá una decisión futura y no cambia este alcance.

---

# Identificadores comerciales

Una presentación puede tener varios identificadores:

- código interno;
- EAN-8;
- EAN-13;
- UPC;
- PLU;
- código de proveedor;
- código de balanza;
- QR interno;
- código manual.

## Resolución operativa

Todo identificador usado para:

- escaneo;
- venta;
- compra;
- inventario;

debe resolver finalmente a una `ProductPresentation`.

---

# Identificadores en Product y ProductVariant

Se permiten identificadores informativos o de navegación en:

- `Product`;
- `ProductVariant`.

Pero no pueden producir ambigüedad operativa.

## Regla

Si un código apunta a `Product` o `ProductVariant` y existen varias presentaciones vendibles:

```text
se requiere selección explícita
```

No se completa una venta automáticamente.

## Recomendación

Los códigos de barras escaneables deben asignarse preferentemente a `ProductPresentation`.

---

# Código de balanza

Un código de balanza debe resolver:

- presentación;
- producto;
- unidad de peso;
- formato;
- cantidad o precio embebido;
- sucursal o perfil;
- checksum.

## Regla

El código de balanza no debe resolver únicamente a `Product` si existen presentaciones incompatibles.

---

# Identificador primario

Una presentación puede tener un identificador principal por tipo o canal.

Ejemplos:

- EAN principal;
- código interno principal;
- código de proveedor principal.

## Regla

Marcar uno como principal no elimina los anteriores.

---

# Invariantes iniciales

1. Todo artículo vendible tiene `presentation_id`.
2. Toda presentación pertenece a un producto.
3. Una presentación puede pertenecer a una variante.
4. La variante debe pertenecer al mismo producto.
5. Las variantes son opcionales.
6. Las presentaciones son obligatorias para vender.
7. El SKU operativo pertenece a la presentación.
8. El inventario no pertenece directamente al producto.
9. El inventario no pertenece directamente a la variante.
10. Los códigos operativos resuelven a presentación.
11. Una variante no representa empaque.
12. Una presentación no representa color, talla o sabor.
13. No existe doble contabilización de inventario.
14. No se modifica identidad histórica destructivamente.
15. La desactivación conserva historial.

---

# Inventario

## Regla principal

El inventario operativo pertenece a:

```text
ProductPresentation
```

Nunca directamente a:

- `Product`;
- `ProductVariant`.

## Motivo

Solo la presentación define de forma suficiente:

- unidad;
- cantidad contenida;
- forma de almacenamiento;
- forma de compra;
- forma de venta;
- factor de conversión;
- control de lote;
- precisión;
- stock mode.

## Clave conceptual de inventario

Un saldo debe poder distinguir como mínimo:

- `company_id`;
- `branch_id`;
- `inventory_location_id`;
- `presentation_id`;
- `lot_id` opcional;
- condición;
- estado.

## Proyección

```text
StockBalance
```

puede resumir saldos, pero no será la única fuente de verdad.

La fuente de verdad será el historial de movimientos o el mecanismo transaccional aprobado por `TECH-002`.

---

# Prohibición de stock en múltiples niveles

No se permite mantener simultáneamente como saldos independientes:

```text
Product.stock
ProductVariant.stock
ProductPresentation.stock
```

Eso produciría doble contabilización.

## Regla

`Product` y `ProductVariant` pueden exponer proyecciones agregadas:

```text
sum(stock de sus presentaciones)
```

pero no saldos persistentes independientes.

---

# Agregación de inventario

## Por producto

```text
product_stock_projection =
sum(stock de todas las presentaciones compatibles)
```

Solo es válida cuando existe una unidad común o una conversión autorizada.

## Por variante

```text
variant_stock_projection =
sum(stock de las presentaciones de la variante)
```

También requiere normalización de unidad.

## Restricción

No se suman directamente:

```text
cajas + unidades + kilogramos
```

sin convertir a una unidad común.

---

# Unidad base de inventario

Cada producto o variante inventariable debe definir una presentación base de inventario:

```text
default_inventory_presentation_id
```

Reglas:

1. Si la operación usa una variante, la presentación base pertenece a esa variante.
2. Si el producto no usa variante, la presentación base pertenece directamente al producto.
3. Una presentación base debe tener `inventory_enabled = true`.
4. Dos variantes no comparten implícitamente una presentación base.
5. Toda conversión de stock termina en la presentación base del mismo producto y variante opcional.

## Ejemplo

```text
Product:
Arroz

Presentaciones:
- bolsa 1 kg
- paca x12

Base de inventario:
bolsa 1 kg
```

## Regla

La presentación base:

- debe pertenecer al mismo producto;
- debe pertenecer a la misma variante cuando exista;
- debe estar activa;
- debe ser inventariable;
- no puede crear ciclos.

---

# StockMode

Los modos oficiales serán:

- `INDEPENDENT`;
- `CONVERTED_TO_BASE`;
- `DERIVED`;
- `NON_STOCK`.

---

# INDEPENDENT

## Definición

La presentación mantiene inventario propio.

Ejemplo:

```text
botella 400 ml
botella 1,5 L
```

si ambas se compran, almacenan y venden separadamente.

## Reglas

1. Tiene movimientos propios.
2. Tiene saldo propio.
3. No comparte saldo implícitamente.
4. Convertir requiere operación explícita.
5. No se deriva automáticamente de otra presentación.

---

# CONVERTED_TO_BASE

## Definición

Los movimientos de la presentación se convierten a una presentación base.

Ejemplo:

```text
compra:
1 paca x12

inventario base:
12 bolsas
```

## Reglas

1. El factor debe ser exacto.
2. El saldo persistente principal queda en la base.
3. La presentación comercial conserva trazabilidad.
4. La compra conserva la presentación original.
5. La conversión se registra.
6. No se pierde el costo original.
7. Los residuos deben tratarse explícitamente.

---

# DERIVED

## Definición

La disponibilidad de una presentación se calcula desde otra.

Ejemplo:

```text
stock base:
24 unidades

presentación derivada:
caja x6

disponibilidad derivada:
4 cajas
```

## Regla

La presentación derivada:

- no mantiene saldo independiente;
- no duplica inventario;
- depende de una fuente;
- usa factor exacto;
- debe definir política de reserva;
- debe definir tratamiento de residuo.

---

# NON_STOCK

## Definición

La presentación no controla inventario.

Ejemplos:

- servicio;
- domicilio;
- mano de obra;
- recargo;
- producto virtual.

## Regla

No genera:

- saldo;
- lote;
- movimiento físico;
- reserva de inventario.

Puede generar:

- venta;
- precio;
- impuesto;
- costo contable;
- evento comercial.

---

# Restricciones de StockMode

1. Una presentación `DERIVED` no mantiene saldo independiente.
2. Una presentación `NON_STOCK` no recibe inventario.
3. Una presentación `CONVERTED_TO_BASE` requiere base válida.
4. Una presentación `INDEPENDENT` no comparte saldo implícito.
5. Cambiar `stock_mode` con historial requiere migración.
6. No se cambia silenciosamente desde frontend.
7. La política queda versionada.
8. El modo debe ser compatible con el tipo de producto.

---

# Movimientos de inventario

Toda operación debe referenciar:

- `presentation_id`;
- cantidad;
- unidad;
- sucursal;
- ubicación;
- lote cuando aplique;
- costo;
- tipo de movimiento;
- referencia;
- actor;
- fecha;
- idempotency key;
- correlation ID.

## Regla

Aunque el saldo se normalice a una presentación base, debe conservarse la presentación comercial origen.

---

# Tipos de movimiento relacionados

- recepción;
- venta;
- devolución;
- ajuste;
- pérdida;
- transferencia;
- conversión;
- fraccionamiento;
- producción;
- consumo;
- reserva;
- liberación;
- conteo;
- corrección.

---

# Lotes

## Nivel oficial

Un lote se relaciona operativamente con inventario de una presentación.

Debe poder identificar:

- producto;
- variante opcional;
- presentación;
- proveedor;
- fecha de fabricación;
- fecha de vencimiento;
- cantidad;
- costo;
- estado.

## Regla

El lote no pertenece únicamente al producto si existen presentaciones o variantes incompatibles.

## Identidad y unicidad operacional

1. Todo lote tiene UUID v7 global.
2. `presentation_id` es obligatorio.
3. `batch_code` se normaliza y es único dentro de `(tenant_id, company_id, presentation_id)` mientras el lote exista; el proveedor no altera esa identidad.
4. La ubicación y cantidades no forman parte de la identidad del lote; se representan mediante movimientos y saldos por ubicación.
5. Un mismo lote puede tener saldo en varias ubicaciones sin duplicar su identidad.
6. Un sublote conserva referencia al lote origen y no amplía fechas ni cantidades.

---

# Compatibilidad de lote

Una conversión puede:

- conservar el lote;
- crear sublote;
- distribuir cantidades;
- registrar merma.

Nunca puede:

- ampliar vencimiento;
- mezclar lotes sin trazabilidad;
- cambiar producto;
- cambiar variante;
- ocultar merma.

---

# Lote lógico y sublote

## Lote lógico

Representa origen común.

## Sublote

Representa una transformación derivada.

Debe conservar:

- `parent_lot_id`;
- operación;
- factor;
- cantidad;
- fecha;
- actor;
- referencia.

---

# Vencimiento

La fecha de vencimiento:

- se conserva;
- puede acortarse por política;
- no se amplía por conversión;
- queda vinculada al lote resultante.

## Prohibición

Fraccionar una caja no renueva el vencimiento de las unidades.

---

# Conversiones entre presentaciones

## Regla principal

Una conversión solo puede ocurrir entre presentaciones del mismo:

- producto;
- variante, cuando exista;
- tenant;
- empresa;
- dimensión compatible.

## Prohibición

No se permite:

```text
variante naranja
→ variante limón
```

mediante conversión.

Eso sería una transformación de producto, no una conversión de presentación.

---

# UnitConversion

## Atributos conceptuales

- `id`;
- `company_id`;
- `product_id`;
- `variant_id` opcional;
- `source_presentation_id`;
- `target_presentation_id`;
- `factor`;
- `reversible`;
- `requires_authorization`;
- `waste_policy`;
- `cost_policy`;
- `lot_policy`;
- `valid_from`;
- `valid_until`;
- `active`;
- `version`.

---

# Invariante de conversión

Debe cumplirse:

```text
source.product_id = target.product_id
```

y:

```text
source.variant_id = target.variant_id
```

salvo que ambas sean `null`.

## Regla

No se permite convertir:

```text
presentación sin variante
→ presentación de variante
```

ni al contrario.

---

# Factor de conversión

Debe ser:

- positivo;
- exacto;
- dimensionado;
- versionado;
- vigente;
- no ambiguo.

## Ejemplo

```text
1 paca = 12 bolsas
```

```text
factor = 12
```

## Precisión

La precisión depende de la unidad física, no de la moneda.

---

# Conversiones reversibles

Una conversión puede declararse reversible.

Ejemplo:

```text
1 caja x24
↔ 24 unidades
```

## Restricción

Que sea matemáticamente reversible no implica que lo sea operativamente.

Puede bloquearse por:

- empaque abierto;
- pérdida de integridad;
- lote;
- vencimiento;
- control sanitario;
- merma;
- política.

---

# Fraccionamiento

## Definición

Transformación desde una presentación mayor hacia una menor.

Ejemplo:

```text
1 paca x12
→ 12 bolsas
```

## Reglas

1. Genera salida en origen.
2. Genera entrada en destino.
3. Conserva referencia común.
4. Conserva costo total.
5. Registra merma.
6. Conserva lote o crea sublote.
7. Es atómico.
8. Es idempotente.

---

# Agrupación

## Definición

Transformación desde varias unidades menores hacia una presentación mayor.

Ejemplo:

```text
12 bolsas
→ 1 paca
```

## Regla

Solo se permite cuando:

- la política lo autoriza;
- las unidades son compatibles;
- los lotes son compatibles;
- la presentación puede reconstruirse;
- se conserva trazabilidad.

---

# Conversión atómica

La operación completa debe confirmar conjuntamente:

- salida origen;
- entrada destino;
- merma;
- costo;
- lote;
- auditoría;
- eventos.

## Invariante

No puede quedar:

```text
salida confirmada
sin entrada
```

ni:

```text
entrada confirmada
sin salida
```

---

# Merma

La merma debe representarse como un efecto separado.

No se oculta:

- dentro del factor;
- dentro del costo;
- reduciendo silenciosamente destino;
- editando saldo.

## Datos mínimos

- cantidad;
- unidad;
- motivo;
- actor;
- autorización;
- lote;
- costo;
- operación origen.

---

# Costos

## Nivel operativo

El costo debe poder determinarse por presentación y lote.

Puede originarse en:

- compra;
- conversión;
- producción;
- ajuste;
- importación;
- costo estándar.

## Regla

`Product` y `ProductVariant` pueden tener costo de referencia, pero no sustituyen el costo operativo de presentación.

---

# Conservación de costo en conversiones

Debe cumplirse conceptualmente:

```text
source_total_cost
=
target_total_cost
+ waste_cost
+ authorized_adjustment
```

## Prohibición

No se crea o destruye costo silenciosamente.

---

# Distribución de costo

Cuando una presentación se fracciona:

```text
target_unit_cost =
source_total_cost
/
target_quantity
```

Debe usarse decimal exacto.

Los residuos:

- se conservan;
- se asignan determinísticamente;
- se auditan.

---

# Métodos de costo

No se impone un único método global. El modelo debe soportar:

- promedio ponderado;
- FIFO;
- costo específico;
- costo estándar;
- costo por lote.

## Regla

La política de costo se selecciona y versiona por empresa y, cuando corresponda, por presentación. La presentación, el lote y los movimientos deben ofrecer suficiente identidad para aplicar el método vigente sin recalcular documentos históricos. `TECH-002` debe modelar la referencia a la política y los datos de costo necesarios, pero no codificar un método universal.

---

# Compras

## Referencia principal

Una línea de compra debe referenciar:

```text
presentation_id
```

## Snapshot mínimo

- producto;
- variante opcional;
- presentación;
- unidad;
- cantidad;
- factor;
- costo;
- impuesto;
- proveedor;
- código de proveedor;
- lote;
- vencimiento.

---

# Compra y recepción

La presentación comprada puede ser distinta de la base de inventario.

Ejemplo:

```text
se compra:
1 caja x24

se almacena:
24 unidades
```

Debe conservarse:

- presentación comprada;
- cantidad comprada;
- factor usado;
- cantidad recibida;
- presentación de inventario;
- costo total;
- conversión.

---

# Compra parcial

Una recepción parcial debe conservar:

- presentación original;
- cantidad ordenada;
- cantidad recibida;
- cantidad pendiente;
- factor;
- costo;
- lotes;
- diferencias.

---

# Código de proveedor

Puede asignarse a:

- producto;
- variante;
- presentación.

## Regla operativa

Cuando identifica una unidad comprable concreta, debe resolver a presentación.

---

# Devolución a proveedor

Debe usar la presentación original o una conversión explícita.

No se devuelve una cantidad en unidad distinta sin:

- equivalencia;
- trazabilidad;
- autorización;
- ajuste de costo.

---

# Inventario por peso

## Presentación operativa

Productos por peso deben usar presentaciones como:

- gramo;
- kilogramo;
- libra;
- unidad pesada;
- bandeja con peso variable.

## Regla

El peso variable no convierte la variante en presentación.

Ejemplo:

```text
Product:
Pollo

Variant:
pechuga

Presentation:
kilogramo
```

---

# Peso variable

Una presentación puede declarar:

- `variable_quantity = true`;
- dimensión de masa;
- precisión;
- mínimo;
- máximo;
- tara;
- formato de balanza.

## Regla

Cada línea de venta conserva la cantidad real medida.

---

# Productos preparados

Una receta o producto preparado puede:

- consumir presentaciones de ingredientes;
- producir una presentación terminada;
- registrar merma;
- distribuir costo.

## Regla

La transformación entre productos distintos no usa `UnitConversion`.

Debe usar:

- producción;
- receta;
- ensamble;
- transformación especializada.

---

# Productos compuestos

Un combo comercial no debe confundirse con una presentación.

## Ejemplo

```text
hamburguesa + papas + bebida
```

Eso puede ser:

- producto compuesto;
- promoción;
- bundle.

No es una conversión entre presentaciones.

---

# Restricciones de inventario y conversión

1. El saldo pertenece a presentación.
2. La agregación requiere unidad común.
3. Una presentación derivada no duplica stock.
4. Una conversión no cambia producto.
5. Una conversión no cambia variante.
6. El factor debe ser exacto.
7. No se permiten ciclos.
8. La conversión es atómica.
9. La merma es explícita.
10. El costo se conserva.
11. El lote permanece trazable.
12. El vencimiento no se amplía.
13. El código de proveedor no sustituye SKU.
14. La compra conserva presentación original.
15. Las transformaciones entre productos usan otro proceso.

---

# Pricing

## Regla principal

El precio operativo final debe resolver a:

```text
ProductPresentation
```

Puede existir configuración heredable en:

- `Product`;
- `ProductVariant`;

pero el resultado efectivo de venta debe identificar una presentación concreta.

## Motivo

La presentación determina:

- unidad vendida;
- cantidad contenida;
- canal operativo;
- código escaneado;
- inventario afectado;
- impuesto aplicable;
- devolución elegible.

---

# Niveles de definición de precio

Se permiten reglas en:

```text
Product
ProductVariant
ProductPresentation
```

## Interpretación

### Product

Precio general o plantilla.

### ProductVariant

Precio específico para una combinación comercial.

### ProductPresentation

Precio específico de la unidad concreta vendible.

## Resolución

La prioridad conceptual será:

```text
1. ProductPresentation
2. ProductVariant
3. Product
```

sin sustituir las reglas completas de `DEC-003`.

## Regla

El precio heredado debe materializarse en el snapshot de venta.

No se consulta dinámicamente después de completar la operación.

---

# ProductPrice

## Atributos conceptuales

Debe poder referenciar:

- `product_id`;
- `variant_id` opcional;
- `presentation_id` opcional;
- `price_list_id`;
- `branch_id` opcional;
- canal;
- moneda;
- importe;
- vigencia;
- estado;
- versión.

## Integridad

Si existe `presentation_id`:

```text
presentation.product_id = product_id
```

y:

```text
presentation.variant_id = variant_id
```

cuando la presentación pertenece a variante.

---

# Precio específico de presentación

Ejemplo:

```text
Product:
Gaseosa

Variant:
Naranja

Presentations:
400 ml
1,5 L
2,5 L
```

Cada presentación puede tener un precio distinto.

No se deduce automáticamente por factor.

## Prohibición

No se permite asumir:

```text
precio 2 L = precio 1 L × 2
```

sin política explícita.

---

# Precio por peso

Una presentación por peso puede definir:

```text
precio por kilogramo
```

La línea de venta calcula:

```text
line_amount =
measured_quantity
× unit_price
```

## Regla

La cantidad real y la unidad deben conservarse en snapshot.

---

# Promociones

Las promociones deben poder aplicar a:

- producto;
- variante;
- presentación;
- categoría;
- grupo;
- venta.

## Resolución

Una promoción aplicada a producto puede incluir sus presentaciones elegibles.

Una promoción aplicada a variante solo puede incluir presentaciones de esa variante.

Una promoción aplicada a presentación solo afecta esa presentación.

---

# Exclusiones de promoción

Puede excluirse por:

- presentación;
- variante;
- producto;
- canal;
- sucursal;
- unidad;
- tipo;
- stock mode;
- lote;
- vencimiento.

## Regla

La elegibilidad debe resolverse antes de aplicar el descuento.

---

# Impuestos

## Nivel operativo

La clasificación fiscal efectiva debe poder resolverse a `ProductPresentation`.

Puede heredarse desde:

- producto;
- variante;
- categoría.

## Prioridad conceptual

```text
1. ProductPresentation
2. ProductVariant
3. Product
4. Category
```

siempre bajo una política fiscal versionada.

---

# Motivo de clasificación por presentación

Dos presentaciones del mismo producto pueden requerir tratamientos distintos por:

- contenido;
- cantidad;
- empaque;
- canal;
- regulación;
- unidad;
- tipo de comercialización.

## Regla

La herencia fiscal debe quedar explícita en snapshot.

---

# Productos regulados

Una presentación puede exigir:

- registro sanitario;
- lote;
- vencimiento;
- receta;
- control de cantidad;
- edad mínima;
- autorización;
- trazabilidad especial.

## Regla

No toda restricción pertenece al producto maestro.

Puede variar por variante o presentación.

---

# Ventas

## Referencia obligatoria

Toda línea de venta debe persistir:

```text
presentation_id
```

## Snapshot mínimo

- `product_id`;
- `variant_id` opcional;
- `presentation_id`;
- SKU;
- identificador usado;
- nombre;
- atributos;
- unidad;
- cantidad contenida;
- cantidad vendida;
- precio;
- descuentos;
- impuestos;
- costo;
- lote cuando aplique;
- versiones.

---

# Venta de producto simple

Ejemplo:

```text
Product:
Arroz Roa

Presentation:
bolsa 1 kg
```

La línea de venta referencia la presentación.

No referencia únicamente el producto.

---

# Venta con variante

Ejemplo:

```text
Product:
Camiseta

Variant:
azul / talla M

Presentation:
unidad
```

La línea conserva los tres niveles.

---

# Venta por peso

Ejemplo:

```text
Product:
Pollo

Variant:
pechuga

Presentation:
kilogramo

Quantity:
1.375 kg
```

La cantidad decimal pertenece a la línea.

La presentación define unidad y precisión.

---

# Venta de presentación derivada

Si se vende una presentación `DERIVED`:

1. se valida disponibilidad equivalente;
2. se reserva en la fuente;
3. se consume inventario base;
4. se conserva la presentación vendida;
5. se conserva el factor;
6. se evita saldo duplicado.

---

# Venta de presentación CONVERTED_TO_BASE

La venta puede registrarse comercialmente en la presentación escaneada.

El movimiento de inventario puede normalizarse a la base.

Debe conservarse:

- presentación vendida;
- presentación base;
- factor;
- cantidad comercial;
- cantidad de inventario.

---

# Devoluciones

## Regla principal

Una devolución se realiza sobre la presentación original de la línea de venta.

No sobre:

- producto genérico;
- variante genérica;
- presentación actual distinta.

## Snapshot

La devolución usa:

- `presentation_id` original;
- unidad original;
- factor original;
- precio original;
- impuesto original;
- descuentos originales;
- lote original cuando aplique.

---

# Devolución con conversión

Si el artículo se devuelve en otra presentación:

```text
se requiere conversión explícita
```

Ejemplo:

```text
se vendió:
caja x12

se devuelve:
6 unidades
```

Debe modelarse como:

```text
devolución parcial
+ equivalencia autorizada
```

No como edición de la venta original.

---

# Devolución de producto fraccionado

La disposición se decide explícitamente, según política versionada y evaluación autorizada, entre:

- puede reingresar a inventario;
- conserva lote;
- requiere cuarentena;
- se clasifica como merma;
- necesita autorización.

## Reglas

1. La devolución no recompone automáticamente una presentación mayor.
2. Ninguna devolución fraccionada reingresa automáticamente a disponibilidad.
3. Hasta que exista una decisión autorizada, la unidad devuelta queda en cuarentena o fuera del saldo disponible.
4. Reingreso, merma o disposición generan movimientos explícitos y conservan presentación, lote cuando sea trazable, actor, motivo y evidencia.

---

# Reimpresión y documentos

Los documentos comerciales deben mostrar:

- producto;
- variante cuando exista;
- presentación;
- unidad;
- cantidad;
- precio;
- descuentos;
- impuestos;
- código o SKU.

## Regla

La descripción histórica no depende del catálogo actual.

---

# Búsqueda y POS

## Resultado de búsqueda

Cada resultado vendible debe representar una presentación.

Puede mostrar:

```text
Producto
Variante
Presentación
SKU
Precio
Stock
```

## Ejemplo

```text
Camiseta deportiva
Azul / M
Unidad
SKU: CAM-AZ-M-UND
```

---

# Escaneo

Un código escaneado debe resolver:

```text
ProductIdentifier
→ ProductPresentation
```

## Si resuelve a Product

Si existe una única presentación vendible:

```text
puede resolverse automáticamente según política
```

Si existen varias:

```text
debe solicitar selección
```

## Si resuelve a ProductVariant

Si existe una única presentación vendible:

```text
puede resolverse automáticamente según política
```

Si existen varias:

```text
debe solicitar selección
```

---

# Prevención de ambigüedad

No se permite que un mismo código activo resuelva simultáneamente a:

- producto;
- variante;
- presentación diferente.

## Resultado

Debe existir una única resolución operativa dentro de la empresa.

---

# Catálogo visible

## Product

Se utiliza como agrupador principal.

## ProductVariant

Se utiliza como agrupador opcional.

## ProductPresentation

Se utiliza como artículo seleccionable.

---

# Estado y desactivación

## Product

Desactivar un producto impide nuevas operaciones sobre todas sus variantes y presentaciones.

No elimina historial.

## ProductVariant

Desactivar una variante impide nuevas operaciones sobre sus presentaciones.

No desactiva otras variantes.

## ProductPresentation

Desactivar una presentación impide nuevas:

- ventas;
- compras;
- asignaciones;
- conversiones;
- precios futuros;

según política.

No elimina:

- stock histórico;
- movimientos;
- ventas;
- compras;
- códigos históricos.

---

# Desactivación con stock

Una presentación con stock no debe eliminarse.

Puede:

- bloquearse para venta;
- mantenerse para agotamiento;
- transferirse;
- convertirse;
- ajustarse;
- darse de baja.

## Regla

La desactivación no resuelve el stock automáticamente.

---

# Reactivación

La reactivación debe validar:

- producto activo;
- variante activa;
- unidades vigentes;
- códigos;
- precios;
- impuestos;
- conversiones;
- restricciones regulatorias.

---

# Cambios estructurales

Se consideran estructurales:

- cambiar producto padre;
- cambiar variante;
- cambiar unidad;
- cambiar cantidad contenida;
- cambiar base;
- cambiar factor;
- cambiar stock mode;
- cambiar identidad de variante;
- cambiar SKU principal con implicaciones externas.

## Regla

Si existe historial, el cambio puede requerir:

```text
crear nueva entidad
→ migrar relaciones seguras
→ desactivar anterior
```

---

# Eventos de dominio

Deben existir o considerarse:

- `ProductCreated`;
- `ProductUpdated`;
- `ProductDeactivated`;
- `ProductVariantCreated`;
- `ProductVariantUpdated`;
- `ProductVariantDeactivated`;
- `ProductPresentationCreated`;
- `ProductPresentationUpdated`;
- `ProductPresentationDeactivated`;
- `ProductIdentifierAssigned`;
- `ProductIdentifierDeactivated`;
- `ProductPresentationConversionDefined`;
- `InventoryConversionStarted`;
- `InventoryConversionCompleted`.

---

# Auditoría

Toda modificación debe conservar:

- actor;
- empresa;
- dispositivo;
- fecha;
- estado anterior;
- estado nuevo;
- motivo;
- versión esperada;
- correlation ID;
- idempotency key.

---

# Idempotencia

Las operaciones críticas deben usar claves idempotentes:

- crear variante;
- crear presentación;
- asignar identificador;
- definir conversión;
- convertir stock;
- desactivar;
- reactivar;
- migrar.

## Regla

```text
misma clave + mismas entradas
→ mismo resultado
```

```text
misma clave + entradas diferentes
→ conflicto
```

---

# Concurrencia

## Riesgos

- crear variante duplicada;
- crear presentación duplicada;
- asignar SKU duplicado;
- asignar código duplicado;
- modificar factor concurrentemente;
- convertir stock simultáneamente;
- desactivar durante venta;
- cambiar precio durante operación.

## Reglas

1. Se utiliza `expected_version`.
2. La unicidad debe protegerse transaccionalmente.
3. El frontend no decide conflictos.
4. Un lock no sustituye idempotencia.
5. Una respuesta tardía valida el estado actual.
6. Los cambios estructurales requieren versión.

---

# Multiempresa

Todas las entidades deben aislarse por:

- tenant;
- empresa;
- sucursal cuando aplique.

## Reglas

1. Un SKU puede repetirse en empresas distintas si la política lo permite.
2. Un código comercial puede existir en tenants distintos.
3. Una variante no cruza productos de otra empresa.
4. Una presentación no cruza empresas.
5. Una conversión no cruza empresas.
6. Un precio no cruza empresas.
7. Un inventario no cruza empresas.

---

# Operación offline

## Permitido

Puede operar offline con snapshots sincronizados de:

- productos;
- variantes;
- presentaciones;
- códigos;
- unidades;
- conversiones;
- precios;
- impuestos;
- estados.

## Restricción

No se permite offline:

- inventar una relación;
- cambiar factores estructurales sin autorización;
- reutilizar SKU;
- reutilizar código;
- convertir con reglas vencidas;
- vender una presentación no sincronizada;
- resolver ambigüedad arbitrariamente.

---

# Sincronización

Al sincronizar:

1. validar tenant;
2. validar empresa;
3. validar versiones;
4. validar jerarquía;
5. validar unicidad;
6. validar códigos;
7. validar SKU;
8. validar conversiones;
9. detectar conflictos;
10. conservar operaciones locales.

## Regla

No se reparenta una presentación silenciosamente.

---

# Conflictos offline

Tipos:

- variante duplicada;
- presentación duplicada;
- SKU duplicado;
- código duplicado;
- factor distinto;
- presentación desactivada;
- producto desactivado;
- relación inconsistente;
- versión obsoleta.

## Resultados posibles

- `ACCEPTED`;
- `REJECTED`;
- `REVIEW_REQUIRED`;
- `MERGE_REQUIRED`;
- `MIGRATION_REQUIRED`.

---

# Modelo físico conceptual

Sin definir tablas definitivas, el diseño deberá representar como mínimo:

```text
Product
ProductVariant
ProductVariantAttributeValue
ProductPresentation
ProductIdentifier
UnitOfMeasure
UnitConversion
ProductPrice
InventoryMovement
StockBalance
Lot
```

---

# Claves foráneas conceptuales

```text
ProductVariant.product_id
→ Product.id
```

```text
ProductPresentation.product_id
→ Product.id
```

```text
ProductPresentation.variant_id
→ ProductVariant.id
```

```text
ProductIdentifier.presentation_id
→ ProductPresentation.id
```

```text
UnitConversion.source_presentation_id
→ ProductPresentation.id
```

```text
UnitConversion.target_presentation_id
→ ProductPresentation.id
```

---

# Restricciones conceptuales de integridad

1. `ProductPresentation.product_id` es obligatorio.
2. `ProductPresentation.variant_id` es opcional.
3. Si existe variante, debe pertenecer al mismo producto.
4. Una presentación vendible debe estar activa.
5. Una presentación vendible debe tener unidad.
6. `contained_quantity > 0`.
7. Un factor de conversión debe ser positivo.
8. Origen y destino no son iguales.
9. Origen y destino comparten producto.
10. Origen y destino comparten variante.
11. No existen ciclos de conversión.
12. El SKU activo es único en su alcance.
13. Un identificador operativo no es ambiguo.
14. Una variante canónica es única dentro del producto.
15. Una presentación equivalente no se duplica.

---

# Definición de presentación equivalente

Dos presentaciones son equivalentes cuando coinciden en:

- producto;
- variante;
- unidad;
- cantidad contenida;
- base;
- factor;
- stock mode;
- propósito operativo relevante.

## Regla

El nombre visible no define identidad.

Estas dos entradas pueden ser equivalentes:

```text
Caja x12
Caja de 12 unidades
```

Debe existir una clave canónica.

---

# Canonical key de presentación

Ejemplo conceptual:

```text
product=P1
variant=V1
unit=UNIT
contained=12
base=PRES-UNIT
factor=12
stock_mode=DERIVED
```

La clave debe ser:

- normalizada;
- determinista;
- única;
- independiente del idioma visible.

---

# Migración desde el modelo actual

## Problema

El modelo heredado puede mezclar:

- producto;
- variante;
- presentación;
- unidad;
- empaque;
- código;
- stock.

## Estrategia

Cada registro debe clasificarse como:

- `PRODUCT`;
- `VARIANT`;
- `PRESENTATION`;
- `IDENTIFIER`;
- `CONVERSION`;
- `REVIEW_REQUIRED`.

---

# Reglas de clasificación

## Variante probable

Cuando representa:

- color;
- talla;
- sabor;
- concentración;
- modelo;
- material;
- acabado.

## Presentación probable

Cuando representa:

- unidad;
- caja;
- bolsa;
- paquete;
- paca;
- botella;
- peso;
- volumen;
- cantidad contenida.

## Revisión obligatoria

Cuando mezcla:

```text
sabor naranja 400 ml caja x6
```

Debe separarse en:

```text
Variant:
sabor naranja

Presentation:
botella 400 ml

Presentation:
paquete x6 de botella 400 ml
```

---

# Migración de inventario

Cada saldo heredado debe asignarse a una presentación.

No se permite migrar stock únicamente a:

- producto;
- variante.

## Si no existe presentación

Debe crearse una presentación controlada:

```text
LEGACY_DEFAULT_PRESENTATION
```

con evidencia y revisión posterior.

---

# Migración de códigos

Cada código debe clasificarse:

- informativo de producto;
- informativo de variante;
- operativo de presentación.

## Regla

Los códigos usados en ventas históricas deben conservar resolución.

---

# Migración de precios

Cada precio heredado debe asignarse a:

- producto;
- variante;
- presentación;

según evidencia.

## Regla

Si el precio corresponde a una unidad concreta, debe migrarse a presentación.

---

# Migración de ventas

Las ventas históricas deben conservar:

- referencia heredada;
- producto;
- variante inferida;
- presentación inferida;
- snapshot;
- nivel de confianza;
- evidencia.

## Prohibición

No se reescriben ventas cerradas únicamente para ajustarlas al nuevo modelo.

---

# Nivel de confianza de migración

Valores:

- `EXACT`;
- `HIGH`;
- `MEDIUM`;
- `LOW`;
- `UNRESOLVED`.

## Regla

Los casos `LOW` o `UNRESOLVED` requieren revisión.

---

# Compatibilidad temporal

Durante migración puede existir una capa de traducción:

```text
legacy_product_reference
→ presentation_id
```

## Restricción

La capa temporal no se convierte en modelo definitivo.

---

# Consecuencias para CAT-002

`CAT-002` deberá:

- actualizar glosario;
- corregir modelo conceptual;
- alinear casos de uso;
- definir persistencia;
- definir claves;
- definir restricciones;
- definir migración;
- definir pruebas;
- eliminar términos ambiguos.

---

# Consecuencias para TECH-002

`TECH-002` deberá diseñar:

- tablas;
- claves;
- índices;
- restricciones;
- unicidad;
- transacciones;
- migraciones;
- snapshots;
- proyecciones;
- multiempresa;
- sincronización.

Debe impedir físicamente:

- variante de otro producto;
- presentación sin producto;
- conversión cruzada;
- SKU duplicado;
- código ambiguo;
- ciclos;
- doble stock.

---

# Consecuencias para TECH-003

Los contratos API deberán distinguir:

- producto;
- variante;
- presentación;
- identificador;
- conversión;
- artículo vendible.

No debe existir un campo genérico ambiguo:

```text
product_or_variant_or_presentation
```

sin discriminador y validación.

---

# Consecuencias para pricing

`DEC-003` deberá interpretarse así:

- `product_id`: regla general;
- `variant_id`: override de variante;
- `presentation_id`: override operativo final.

La resolución termina en presentación.

---

# Consecuencias para inventario

Toda operación futura debe usar:

```text
presentation_id
```

como identidad operativa.

Las vistas por producto o variante serán proyecciones.

---

# Consecuencias para impuestos

La categoría puede heredarse, pero el snapshot fiscal debe corresponder a la presentación vendida.

---

# Riesgos residuales

1. La migración heredada puede contener combinaciones ambiguas.
2. `OPTIONAL_VARIANTS` puede producir estructuras mixtas complejas.
3. Los códigos existentes pueden no identificar una presentación.
4. Los factores pueden ser inexactos.
5. El stock heredado puede estar duplicado.
6. Los precios pueden estar asociados al nivel incorrecto.
7. Los lotes pueden no conservar presentación.
8. La regulación puede requerir atributos adicionales.
9. El rendimiento debe validarse con catálogos grandes.
10. El diseño físico todavía no está definido.

---

# Invariantes de pricing, ventas y persistencia

1. El precio operativo final resuelve a presentación.
2. La línea de venta referencia presentación.
3. La devolución usa presentación original.
4. El impuesto se calcula para la presentación vendida.
5. El SKU pertenece a presentación.
6. El código operativo resuelve a presentación.
7. La presentación conserva producto.
8. La variante, si existe, pertenece al mismo producto.
9. Una conversión no cruza variante.
10. Una conversión no cruza producto.
11. El snapshot histórico no depende del catálogo actual.
12. Un cambio estructural no reescribe historia.
13. La migración conserva referencias heredadas.
14. Los casos ambiguos requieren revisión.
15. El modelo físico debe proteger las invariantes.

---

# Escenarios de aceptación

## Escenario 1 — Producto simple sin variantes

Datos:

```text
Product:
Arroz

variant_policy:
NO_VARIANTS
```

Presentaciones:

```text
bolsa 500 g
bolsa 1 kg
paca x12
```

Resultado:

- no se crea variante artificial;
- cada presentación pertenece directamente al producto;
- cada presentación tiene SKU propio;
- el inventario pertenece a las presentaciones;
- los precios pueden diferir.

---

## Escenario 2 — Producto con variantes obligatorias

Datos:

```text
Product:
Camiseta

variant_policy:
REQUIRED_VARIANTS
```

Variantes:

```text
azul / M
azul / L
roja / M
```

Resultado:

- ninguna presentación activa puede quedar sin variante;
- cada variante tiene al menos una presentación vendible;
- la presentación mantiene SKU, precio e inventario;
- las variantes no mantienen stock independiente.

---

## Escenario 3 — Variante duplicada

Entradas:

```text
color=azul
talla=M
```

y:

```text
talla=M
color=azul
```

Resultado:

- ambas producen la misma clave canónica;
- la segunda creación se rechaza o devuelve el registro existente;
- no se crean variantes duplicadas.

---

## Escenario 4 — Presentación duplicada

Entradas:

```text
Caja x12
```

y:

```text
Caja de 12 unidades
```

con la misma:

- unidad;
- cantidad contenida;
- presentación base;
- factor;
- stock mode.

Resultado:

- se detecta equivalencia;
- no se crea una segunda presentación;
- el nombre visible no define identidad.

---

## Escenario 5 — Presentación con variante de otro producto

Datos:

```text
presentation.product_id = PRODUCT_A
variant.product_id = PRODUCT_B
```

Resultado:

- se rechaza;
- no se persiste;
- se registra conflicto de integridad.

---

## Escenario 6 — Venta directa de Product

Solicitud:

```text
product_id
sin presentation_id
```

Resultado:

- se rechaza si existen varias presentaciones;
- puede resolverse únicamente mediante una política explícita cuando existe exactamente una presentación vendible;
- la línea final siempre conserva `presentation_id`.

---

## Escenario 7 — Código de barras de presentación

Un EAN identifica:

```text
botella 400 ml
```

Resultado:

- resuelve directamente a `ProductPresentation`;
- carga producto y variante;
- obtiene pricing;
- valida inventario;
- no solicita selección adicional.

---

## Escenario 8 — Código asociado a Product con varias presentaciones

El código apunta al producto general.

Existen:

```text
500 g
1 kg
paca x12
```

Resultado:

- no se selecciona arbitrariamente;
- se solicita una presentación;
- no se completa la venta hasta resolverla.

---

## Escenario 9 — SKU duplicado

Dos presentaciones activas intentan utilizar el mismo SKU dentro de la empresa.

Resultado:

- la segunda operación se rechaza;
- se conserva el SKU original;
- se registra auditoría.

---

## Escenario 10 — Inventario independiente

Presentaciones:

```text
botella 400 ml
botella 1,5 L
```

Ambas:

```text
stock_mode = INDEPENDENT
```

Resultado:

- cada una mantiene movimientos propios;
- no existe conversión implícita;
- sus saldos no se mezclan.

---

## Escenario 11 — Inventario convertido a base

Presentaciones:

```text
paca x12
bolsa individual
```

Configuración:

```text
paca:
CONVERTED_TO_BASE

base:
bolsa individual
```

Resultado:

- comprar una paca conserva la presentación comprada;
- el inventario base aumenta 12 bolsas;
- se registra factor;
- el costo total se conserva;
- no se crea saldo duplicado en paca y bolsa.

---

## Escenario 12 — Presentación derivada

Inventario base:

```text
24 unidades
```

Presentación derivada:

```text
caja x6
```

Resultado:

```text
disponibilidad:
4 cajas
```

La caja:

- no mantiene saldo independiente;
- reserva y consume unidades base;
- conserva presentación comercial en la venta.

---

## Escenario 13 — Conversión entre variantes

Solicitud:

```text
sabor naranja / botella 400 ml
→ sabor limón / botella 400 ml
```

Resultado:

- se rechaza;
- no es una conversión de presentación;
- requiere otro proceso de transformación.

---

## Escenario 14 — Conversión atómica

Conversión:

```text
1 paca
→ 12 bolsas
```

Si falla la entrada destino:

- se revierte la salida origen;
- no queda operación parcial;
- se conserva incidencia;
- un reintento idempotente no duplica movimientos.

---

## Escenario 15 — Conversión con merma

Datos:

```text
origen:
1 bulto de 50 kg

destino:
49,5 kg

merma:
0,5 kg
```

Resultado:

- la merma se registra separadamente;
- el factor no se modifica para ocultarla;
- el costo se distribuye según política;
- la operación queda balanceada.

---

## Escenario 16 — Producto por peso

Datos:

```text
Product:
Pollo

Variant:
pechuga

Presentation:
kilogramo
```

Venta:

```text
quantity = 1.375
```

Resultado:

- la línea conserva 1.375 kg;
- el precio se calcula por kilogramo;
- el inventario disminuye en la cantidad exacta;
- se respeta la precisión física.

---

## Escenario 17 — Presentación NON_STOCK

Datos:

```text
Product:
Servicio de domicilio

Presentation:
servicio

stock_mode:
NON_STOCK
```

Resultado:

- puede venderse;
- puede tener precio e impuesto;
- no genera movimiento de inventario;
- no genera lote.

---

## Escenario 18 — Devolución parcial en otra presentación

Venta original:

```text
1 caja x12
```

Devolución:

```text
6 unidades
```

Resultado:

- no se modifica la venta original;
- se valida equivalencia;
- se registra devolución parcial;
- se conserva factor original;
- se registra la presentación devuelta;
- no se recompone automáticamente una caja.

---

## Escenario 19 — Desactivación con stock

Una presentación activa tiene existencias.

Se solicita desactivación.

Resultado:

- no se elimina;
- se mantiene historial;
- se aplica una política de agotamiento, conversión, transferencia o baja;
- el stock no desaparece.

---

## Escenario 20 — Migración ambigua

Registro heredado:

```text
Gaseosa naranja 400 ml paquete x6
```

Resultado:

```text
Product:
Gaseosa

Variant:
naranja

Presentation:
botella 400 ml

Presentation:
paquete x6
```

Si la evidencia no permite separar con certeza:

```text
REVIEW_REQUIRED
```

---

# Pruebas mínimas

## Unitarias

1. Crear producto sin variantes.
2. Crear producto con variantes.
3. Generar clave canónica de variante.
4. Detectar variante duplicada.
5. Crear presentación directa de producto.
6. Crear presentación dependiente de variante.
7. Rechazar variante de otro producto.
8. Detectar presentación equivalente.
9. Validar cantidad contenida.
10. Validar presentación base.
11. Validar SKU único.
12. Resolver identificador.
13. Detectar código ambiguo.
14. Resolver precio por presentación.
15. Heredar precio de variante.
16. Heredar precio de producto.
17. Resolver impuesto.
18. Validar stock mode.
19. Validar factor.
20. Detectar ciclo de conversión.
21. Rechazar conversión entre variantes.
22. Calcular stock derivado.
23. Normalizar stock a base.
24. Distribuir costo.
25. Registrar merma.
26. Conservar lote.
27. Validar vencimiento.
28. Desactivar presentación.
29. Reactivar presentación.
30. Clasificar migración.

## Integración

1. Crear producto completo.
2. Crear variante y presentación.
3. Asignar SKU.
4. Asignar EAN.
5. Configurar precio.
6. Configurar impuesto.
7. Recibir compra.
8. Crear lote.
9. Convertir presentación.
10. Vender presentación.
11. Vender por peso.
12. Reservar inventario derivado.
13. Devolver presentación.
14. Devolver parcialmente.
15. Reimprimir ticket.
16. Sincronizar catálogo.
17. Resolver conflicto offline.
18. Migrar producto heredado.
19. Auditar cambios.
20. Aislar empresas.

## Concurrencia

1. Dos variantes equivalentes simultáneas.
2. Dos presentaciones equivalentes.
3. Dos asignaciones del mismo SKU.
4. Dos asignaciones del mismo EAN.
5. Dos conversiones sobre el mismo stock.
6. Venta y desactivación concurrentes.
7. Cambio de factor y conversión simultáneos.
8. Reactivación concurrente.
9. Sincronización duplicada.
10. Reintento después de timeout.

## Seguridad

1. Variante de otra empresa.
2. Presentación de otro tenant.
3. Conversión entre empresas.
4. SKU manipulado.
5. Código manipulado.
6. Factor manipulado.
7. Cambio estructural sin permiso.
8. Desactivación sin autorización.
9. Reparentado malicioso.
10. Lectura cruzada de inventario.

## Migración

1. Producto simple.
2. Producto con variantes.
3. Producto con presentaciones.
4. Registro que mezcla variante y presentación.
5. Stock sin presentación.
6. Código asociado al nivel incorrecto.
7. Precio asociado al nivel incorrecto.
8. Venta histórica.
9. Lote heredado.
10. Conversión heredada.
11. SKU duplicado.
12. Caso sin evidencia.
13. Rollback.
14. Reejecución idempotente.
15. Comparación de totales.

---

# Errores funcionales

- `CATALOG_PRODUCT_NOT_FOUND`;
- `CATALOG_PRODUCT_INACTIVE`;
- `CATALOG_VARIANT_NOT_ALLOWED`;
- `CATALOG_VARIANT_REQUIRED`;
- `CATALOG_VARIANT_DUPLICATE`;
- `CATALOG_VARIANT_PRODUCT_MISMATCH`;
- `CATALOG_PRESENTATION_REQUIRED`;
- `CATALOG_PRESENTATION_DUPLICATE`;
- `CATALOG_PRESENTATION_PRODUCT_MISMATCH`;
- `CATALOG_PRESENTATION_VARIANT_MISMATCH`;
- `CATALOG_PRESENTATION_INACTIVE`;
- `CATALOG_PRESENTATION_NOT_SELLABLE`;
- `CATALOG_PRESENTATION_NOT_PURCHASABLE`;
- `CATALOG_SKU_DUPLICATE`;
- `CATALOG_IDENTIFIER_DUPLICATE`;
- `CATALOG_IDENTIFIER_AMBIGUOUS`;
- `CATALOG_UNIT_INCOMPATIBLE`;
- `CATALOG_CONVERSION_FACTOR_INVALID`;
- `CATALOG_CONVERSION_CYCLE`;
- `CATALOG_CONVERSION_PRODUCT_MISMATCH`;
- `CATALOG_CONVERSION_VARIANT_MISMATCH`;
- `CATALOG_STOCK_MODE_INVALID`;
- `CATALOG_STRUCTURAL_CHANGE_REQUIRES_MIGRATION`;
- `CATALOG_OFFLINE_VERSION_CONFLICT`;
- `CATALOG_MIGRATION_REVIEW_REQUIRED`.

---

# Criterios de aceptación

`DEC-004` se considera cerrada cuando:

1. `Product` tiene una definición definitiva.
2. `ProductVariant` tiene una definición definitiva.
3. `ProductPresentation` tiene una definición definitiva.
4. variante y presentación no se usan como sinónimos.
5. las variantes son opcionales.
6. las presentaciones son obligatorias para vender.
7. existe una política de variantes.
8. están definidas estructuras sin variante.
9. están definidas estructuras con variante.
10. están restringidas estructuras mixtas.
11. están definidas las cardinalidades.
12. está definida la consistencia producto-variante-presentación.
13. está definido `SellableItem`.
14. la línea de venta referencia presentación.
15. está definido el SKU operativo.
16. están definidos identificadores.
17. está definida la resolución de códigos.
18. está definido el inventario por presentación.
19. están definidos los `StockMode`.
20. están definidas conversiones.
21. están prohibidas conversiones entre variantes.
22. están definidos lotes.
23. está definido el vencimiento.
24. está definida la merma.
25. está definida la conservación de costo.
26. están definidas compras.
27. están definidas ventas.
28. están definidas devoluciones.
29. está definido pricing por presentación.
30. está definida la herencia de precios.
31. está definida la clasificación fiscal.
32. está definida la operación offline.
33. está definida la sincronización.
34. está definida la idempotencia.
35. está definida la concurrencia.
36. está definida la auditoría.
37. está definida la migración.
38. están definidos niveles de confianza.
39. están definidos escenarios.
40. están definidas pruebas.
41. están definidos errores.
42. existe coherencia con casos de catálogo.
43. existe coherencia con `DEC-003`.
44. están definidas consecuencias para `CAT-002`.
45. están definidas consecuencias para `TECH-002`.
46. el backlog adjunta evidencia verificable.

---

# Alineaciones documentales exigidas

El contrato conceptual exigió las alineaciones siguientes. Ya están aplicadas en los documentos indicados; `CAT-002` conserva como trabajo `READY` únicamente el diseño de persistencia física.

## `docs/architecture/conceptual-data-model.md`

Debe:

- corregir la definición de `ProductVariant`;
- agregar `ProductPresentation`;
- agregar `presentation_id` a precios;
- actualizar inventario;
- actualizar códigos;
- actualizar cardinalidades.

## `docs/domain/glossary.md`

Debe:

- corregir `Variante`;
- agregar `Presentación`;
- corregir código de barras;
- aclarar artículo vendible;
- aclarar SKU.

## `docs/domain/commercial-engine.md`

Debe:

- eliminar `variant_id opcional` ambiguo sin política;
- incorporar `variant_policy`;
- reforzar SKU por presentación;
- reforzar inventario por presentación;
- prohibir conversiones entre variantes.

## `docs/domain/event-catalog.md`

Debe incorporar o formalizar:

- `ProductVariantCreated`;
- `ProductVariantUpdated`;
- `ProductVariantDeactivated`;
- `ProductPresentationCreated`;
- `ProductPresentationUpdated`;
- `ProductPresentationDeactivated`;
- `ProductIdentifierAssigned`;
- `ProductPresentationConversionDefined`.

## Casos de uso

Deben alinearse:

- `UC-CAT-001`;
- `UC-CAT-002`;
- `UC-CAT-003`;
- `UC-CAT-004`;
- `UC-CAT-005`;
- `UC-CAT-006`.

---

# Alternativas descartadas

## Product y ProductVariant como mismo concepto

Descartado porque:

- mezcla identidad maestra y combinación de atributos;
- dificulta búsqueda;
- duplica datos comunes;
- complica migración;
- crea inconsistencias.

## ProductVariant como presentación

Descartado porque:

- mezcla color con caja;
- mezcla talla con unidad;
- mezcla sabor con botella;
- impide conversiones claras;
- confunde stock y pricing.

## Inventario en Product

Descartado porque:

- no distingue unidades;
- no distingue empaques;
- no distingue variantes;
- produce doble contabilización.

## Inventario en ProductVariant

Descartado porque:

- no distingue presentaciones;
- no permite caja y unidad;
- no soporta compra y venta diferentes.

## Presentación obligatoriamente asociada a variante

Descartado porque muchos productos simples no requieren variantes.

## Variante artificial predeterminada para todo producto

Descartado como regla general porque:

- añade entidades sin significado comercial;
- complica consultas;
- confunde usuarios;
- no aporta valor en productos simples.

Puede usarse únicamente durante migraciones temporales y controladas.

---

# Consecuencias positivas

1. Identidad operativa clara.
2. Inventario consistente.
3. Pricing determinista.
4. Códigos sin ambigüedad.
5. Soporte de empaques.
6. Soporte de variantes reales.
7. Soporte de productos simples.
8. Mejor trazabilidad.
9. Mejor migración.
10. Mejor diseño físico.
11. Mejor soporte offline.
12. Mejor capacidad de auditoría.
13. Mejor manejo de devoluciones.
14. Mejor soporte regulatorio.
15. Menos lógica condicional ambigua.

---

# Costos y consecuencias negativas

1. Más entidades.
2. Más claves foráneas.
3. Migración más compleja.
4. Mayor disciplina en catálogo.
5. Más validaciones.
6. Mayor complejidad de sincronización.
7. Necesidad de snapshots completos.
8. Necesidad de adaptar frontend.
9. Necesidad de revisar datos heredados.
10. Necesidad de pruebas de integridad.

Estas consecuencias se aceptan porque evitan ambigüedades estructurales más costosas en producción.

---

# Alcance deliberadamente posterior

Esta decisión no cierra:

- tablas físicas;
- índices;
- particionamiento;
- diseño concreto de atributos;
- búsquedas;
- integración GS1;
- configuración concreta de políticas de costo por empresa o presentación;
- optimización y particionado físico de lotes;
- reglas regulatorias por país;
- `DEC-005`;
- decisiones posteriores que amplíen regulación o integraciones sin contradecir `DEC-006`, `DEC-007` y `DEC-008` ya cerradas.

---

# Restricciones para diseño físico

`TECH-002` no podrá:

- almacenar stock operativo en `Product`;
- almacenar stock operativo en `ProductVariant`;
- omitir `ProductPresentation`;
- permitir presentaciones de variantes ajenas;
- permitir conversiones entre productos;
- permitir conversiones entre variantes;
- permitir SKU activo duplicado;
- permitir identificadores operativos ambiguos;
- permitir factores no positivos;
- permitir ciclos de conversión;
- reescribir historia comercial.

---

# Invariantes globales de DEC-004

1. `Product` es identidad maestra.
2. `ProductVariant` es combinación de atributos.
3. `ProductPresentation` es unidad operativa.
4. Toda venta resuelve a presentación.
5. Toda compra resuelve a presentación.
6. Todo inventario resuelve a presentación.
7. Todo lote operativo resuelve a presentación.
8. Todo SKU operativo pertenece a presentación.
9. Todo código de venta resuelve a presentación.
10. Una presentación pertenece a un producto.
11. Una presentación puede pertenecer a una variante.
12. La variante debe pertenecer al mismo producto.
13. Una conversión no cambia producto.
14. Una conversión no cambia variante.
15. Una presentación derivada no duplica inventario.
16. Una presentación `NON_STOCK` no genera saldo.
17. Una variante no representa empaque.
18. Una presentación no representa atributo comercial.
19. La historia no se modifica destructivamente.
20. Toda migración ambigua requiere revisión.
21. Todo cambio estructural conserva versión.
22. Toda operación crítica es idempotente.
23. Toda entidad queda aislada por empresa.
24. Todo conflicto queda explícito.
25. El modelo físico debe proteger estas invariantes.

---

# Estado del documento

Estado: `DONE`

Puede pasar a `DONE` cuando:

- se valide la estructura;
- se validen cercas Markdown;
- se revisen encabezados;
- se confirme coherencia con catálogo;
- se confirme coherencia con inventario;
- se confirme coherencia con pricing;
- se confirme coherencia con ventas;
- se confirme coherencia con compras;
- se confirme coherencia con migración;
- no existan contradicciones críticas;
- el backlog adjunte esta evidencia;
- `DEC-004` se mueva a decisiones cerradas.
