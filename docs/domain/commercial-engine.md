# Motor comercial

## Objetivo

Definir el comportamiento común de productos, presentaciones, unidades, códigos, precios, descuentos, promociones, impuestos y redondeo para todos los tipos de comercio soportados.

El motor debe ser configurable. No se crearán implementaciones separadas para avícolas, tiendas, supermercados, droguerías, ferreterías o almacenes de variedades.

---

# 1. Modelo de producto

## Product

Representa el artículo comercial maestro.

Ejemplos:

- Arroz Roa.
- Pechuga de pollo.
- Tomate chonto.
- Acetaminofén.
- Pintura blanca.
- Camiseta básica.

Atributos conceptuales:

- id;
- company_id;
- internal_code;
- name;
- description;
- category_id;
- brand_id opcional;
- product_type;
- variant_policy;
- stock_controlled;
- lot_controlled;
- expiration_controlled;
- serial_controlled;
- active.

## ProductType

Valores iniciales:

- STANDARD;
- WEIGHTED;
- SERVICE;
- COMPOSITE;
- PREPARED;
- RETURNABLE;
- REGULATED.

### STANDARD

Producto vendido por cantidades discretas.

### WEIGHTED

Producto vendido por peso, volumen, longitud o área.

### SERVICE

No descuenta inventario salvo configuración explícita.

### COMPOSITE

Producto compuesto por otros productos.

### PREPARED

Producto fabricado o preparado mediante receta o proceso.

### RETURNABLE

Tiene envase, canasta o elemento retornable.

### REGULATED

Requiere atributos o controles especiales, como productos de droguería.

---

# 2. Variantes y presentaciones

## ProductVariant

Representa una variante comercial del producto.

Ejemplos:

- color;
- talla;
- sabor;
- concentración;
- modelo;
- tamaño.

## ProductPresentation

Representa la forma concreta de compra, almacenamiento o venta.

Ejemplo:

Producto:
Arroz Roa.

Presentaciones:

- bolsa de 500 g;
- bolsa de 1 kg;
- paca de 12 bolsas de 1 kg.

Atributos conceptuales:

- id;
- product_id;
- variant_id opcional;
- name;
- internal_sku;
- base_unit_id;
- contained_quantity;
- base_presentation_id opcional;
- conversion_factor opcional;
- sales_enabled;
- purchasing_enabled;
- inventory_enabled;
- breakable;
- stock_mode;
- active.

Reglas de integridad:

1. Toda presentación pertenece a un producto.
2. Si existe `variant_id`, la variante debe pertenecer al mismo producto.
3. El SKU operativo principal pertenece a la presentación.
4. Toda presentación vendible debe resolver una unidad física o de servicio válida.
5. `contained_quantity` debe ser positiva.
6. Una presentación derivada no mantiene saldo independiente.
7. Los cambios estructurales con historial requieren migración.

## StockMode

- INDEPENDENT;
- CONVERTED_TO_BASE;
- DERIVED;
- NON_STOCK.

### INDEPENDENT

La presentación mantiene inventario propio.

### CONVERTED_TO_BASE

Las existencias se convierten a una unidad base.

### DERIVED

El saldo se calcula a partir de otra presentación.

### NON_STOCK

No controla inventario.

## Regla

No se permitirá configurar presentaciones con factores circulares o ambiguos.

---

# 3. Códigos e identificación

## ProductIdentifier

Un producto, variante o presentación puede tener varios identificadores:

- código interno;
- EAN-8;
- EAN-13;
- UPC;
- código de proveedor;
- PLU;
- código generado por balanza;
- QR interno;
- código manual.

Atributos conceptuales:

- id;
- company_id;
- product_id;
- variant_id opcional;
- presentation_id opcional;
- identifier_type;
- value;
- is_primary;
- active.

## Reglas

1. Un identificador activo no puede apuntar a dos artículos vendibles dentro de la misma empresa.
2. Un producto, variante o presentación puede tener varios códigos.
3. El código del proveedor no sustituye el código interno.
4. Todo código utilizado para venta, compra o inventario debe resolver finalmente a una `ProductPresentation`.
5. Si un código apunta a producto o variante y existen varias presentaciones vendibles, se requiere selección explícita.
6. El lector debe resolver el código sin que el cajero seleccione manualmente el tipo de identificador.
7. Los códigos de balanza pueden contener producto, presentación, peso o precio según el formato configurado.
8. El lote y el vencimiento no se asumirán desde un código comercial ordinario.
9. Un mismo código activo no puede resolver a presentaciones distintas dentro de la empresa.

---

# 4. Unidades de medida

## Dimensiones iniciales

- COUNT;
- MASS;
- VOLUME;
- LENGTH;
- AREA;
- PACKAGING;
- TIME;
- SERVICE.

## Unidades iniciales

### Conteo

- unidad;
- par;
- docena.

### Masa

- miligramo;
- gramo;
- kilogramo;
- libra.

### Volumen

- mililitro;
- litro.

### Longitud

- centímetro;
- metro.

### Área

- metro cuadrado.

### Empaque

- bolsa;
- paquete;
- caja;
- paca;
- bulto;
- canasta;
- rollo.

## Regla dimensional

Solo se permitirán conversiones compatibles.

Ejemplos válidos:

- kilogramo a gramo;
- caja a unidad mediante factor comercial configurado.

Ejemplos inválidos:

- litro a kilogramo sin una regla específica del producto;
- unidad a metro sin equivalencia explícita.

---

# 5. Conversiones y fraccionamiento

## UnitConversion

Atributos conceptuales:

- product_id;
- source_presentation_id;
- target_presentation_id;
- factor;
- reversible;
- requires_authorization;
- valid_from;
- valid_until.

Ejemplo:

1 paca = 12 bolsas.

## Transformación de inventario

Abrir una presentación debe generar:

- salida de la presentación origen;
- entrada de la presentación destino;
- referencia común;
- usuario;
- sucursal;
- fecha;
- posible merma;
- auditoría.

## Reglas

1. La conversión no modifica inventario silenciosamente.
2. El factor debe ser positivo.
3. La transformación debe ser atómica.
4. La merma debe registrarse separadamente.
5. El costo total debe conservarse o distribuirse según política.
6. No se permitirán conversiones retrospectivas sobre movimientos cerrados.
7. Origen y destino deben pertenecer al mismo producto.
8. Origen y destino deben pertenecer a la misma variante, o ambos carecer de variante.
9. No se permiten conversiones entre una presentación sin variante y otra asociada a variante.
10. No se permiten ciclos de conversión.
11. La operación debe conservar presentación origen, presentación destino, factor y versión.

---

# 6. Motor de precios

## PriceList

Ejemplos:

- precio minorista;
- precio mayorista;
- precio de domicilio;
- precio para clientes preferenciales.

Atributos conceptuales:

- id;
- company_id;
- name;
- currency;
- priority;
- active.

## ProductPrice

Puede aplicar a:

- producto;
- variante;
- presentación;
- sucursal;
- canal;
- lista de precios;
- grupo de clientes;
- rango de cantidad;
- fecha y horario.

Atributos conceptuales:

- id;
- price_list_id;
- product_id;
- variant_id opcional;
- presentation_id opcional;
- branch_id opcional;
- sales_channel opcional;
- customer_group_id opcional;
- minimum_quantity opcional;
- amount;
- valid_from;
- valid_until;
- status.

## Prioridad inicial de resolución

1. Precio contractual específico del cliente.
2. Precio promocional válido.
3. Precio por grupo de clientes.
4. Precio por volumen.
5. Precio por canal.
6. Precio por sucursal.
7. Precio de lista predeterminado.
8. Precio base del producto.

La prioridad definitiva deberá ser configurable y probada para evitar ambigüedad.

## Reglas

1. El precio aplicado se guarda como snapshot en la venta.
2. Los cambios de precio requieren vigencia e historial.
3. No se sobrescribe el precio anterior sin trazabilidad.
4. Una compra nueva no cambia automáticamente el precio de venta.
5. El cajero no puede editar precios libremente.
6. Si dos precios tienen la misma prioridad y vigencia, la configuración se considera inválida.
7. Un precio no puede ser negativo.
8. El precio cero requiere permiso o tipo de producto compatible.
9. La resolución conceptual prioriza presentación, variante y producto.
10. El precio operativo final debe corresponder a una `ProductPresentation`.
11. Un precio heredado desde producto o variante debe materializarse en el snapshot de la presentación vendida.
12. No se deduce automáticamente el precio de una presentación a partir de su factor de conversión.

---

# 7. Costos

## Políticas iniciales

- FIFO;
- FEFO;
- WEIGHTED_AVERAGE;
- SPECIFIC_COST;
- STANDARD_COST.

## Reglas

1. La política de salida física puede diferir de la política contable de costo.
2. FEFO prioriza vencimiento para productos perecederos.
3. FIFO prioriza antigüedad de ingreso.
4. El costo histórico de una venta debe conservarse.
5. Un cambio posterior de costo no altera ventas cerradas.
6. El costo no debe ser visible para el cajero salvo permiso explícito.

---

# 8. Descuentos

## Discount

Puede ser:

- manual;
- por porcentaje;
- por valor fijo;
- por autorización;
- comercial;
- promocional;
- fidelización;
- compensación.

## Alcance

- ítem;
- grupo de ítems;
- subtotal;
- total;
- cliente;
- categoría.

## Reglas

1. Todo descuento debe registrar tipo y origen.
2. Un descuento manual debe respetar el límite del usuario.
3. Superar el límite requiere autorización.
4. El descuento no puede volver negativo un ítem.
5. Los descuentos deben conservarse en el snapshot.
6. El redondeo no es un descuento.
7. Las promociones deben diferenciarse de descuentos manuales.
8. La autorización debe registrar aprobador, fecha y motivo.

---

# 9. Promociones

## Promotion

Atributos conceptuales:

- id;
- company_id;
- name;
- status;
- priority;
- valid_from;
- valid_until;
- days_of_week;
- start_time;
- end_time;
- sales_channels;
- branch_scope;
- customer_scope;
- stack_policy.

## Tipos iniciales

- PERCENTAGE_OFF;
- FIXED_AMOUNT_OFF;
- FIXED_PRICE;
- BUY_X_PAY_Y;
- BUY_X_GET_Y;
- SECOND_UNIT_DISCOUNT;
- BUNDLE_PRICE;
- MINIMUM_PURCHASE_DISCOUNT;
- CATEGORY_DISCOUNT;
- CUSTOMER_GROUP_DISCOUNT.

## Ejemplos

- Lleve 3 y pague 2.
- Segundo producto al 50 %.
- Combo pollo y gaseosa.
- Compra superior a $100.000 con descuento.
- Precio especial para cliente mayorista.
- Promoción solo en domicilio.
- Promoción por horario.

## StackPolicy

- EXCLUSIVE;
- STACKABLE;
- BEST_PRICE;
- PRIORITY_ORDER.

## Reglas

1. La promoción no modifica el precio maestro.
2. Se debe conservar qué regla produjo el beneficio.
3. Las promociones vencidas no aplican.
4. Una promoción no debe aplicarse dos veces por reintento.
5. Las combinaciones incompatibles deben rechazarse.
6. El motor debe poder explicar el cálculo.
7. El cajero no puede alterar manualmente la regla aplicada.
8. El sistema debe calcular primero la elegibilidad y después el beneficio.
9. El cálculo debe ser determinista.
10. Los impuestos deben calcularse según la base legal aplicable después de descuentos autorizados.

---

# 10. Impuestos

## TaxCategory

Estados conceptuales:

- EXCLUDED;
- EXEMPT;
- TAXED;
- NOT_APPLICABLE.

## TaxRate

Atributos conceptuales:

- jurisdiction;
- tax_code;
- percentage;
- included_in_price;
- valid_from;
- valid_until.

## Reglas

1. Los impuestos deben manejar vigencia.
2. Una venta conserva snapshot tributario.
3. Los cambios tributarios no alteran documentos históricos.
4. No se codificarán porcentajes directamente en la interfaz.
5. El motor debe permitir impuestos incluidos o adicionados.
6. La configuración fiscal deberá validarse antes de habilitar facturación electrónica.
7. No se imprimirán datos fiscales simulados.

---

# 11. Redondeo monetario para Colombia

## Moneda

- código: COP;
- moneda visible: peso colombiano;
- precisión interna de cálculo: 6 decimales;
- precisión documental normalizada: 2 decimales;
- precios comerciales usuales: pesos enteros.

## Políticas

- NONE;
- NEAREST_50;
- UP_TO_50;
- DOWN_TO_50;
- NEAREST_100;
- UP_TO_100;
- DOWN_TO_100.

## Configuración predeterminada

La empresa define una política comercial versionada para la venta. La política no cambia según el medio de pago seleccionado después de congelar el total.

## Campos conceptuales

- fiscal_total_amount;
- rounding_policy_version;
- commercial_rounding_adjustment;
- payable_amount.

## Reglas

1. El redondeo se aplica una sola vez al total final.
2. No se redondea cada línea.
3. No se modifica el precio unitario.
4. No se registra como descuento.
5. El ajuste debe ser visible y auditable.
6. Todos los medios cubren el mismo `payable_amount` congelado.
7. Los cálculos internos pueden conservar fracciones de peso producidas por cantidades, impuestos o prorrateos.
8. El total fiscal y el total pagadero deberán conciliarse según la normativa e integración aplicable.
9. Una venta con pago mixto no redondea componentes individuales.
10. El motor no puede producir una diferencia de pagos sin registrar.

## Ejemplo

Producto por peso:

0,735 kg × $5.500/kg = $4.042,50.

Total comercial:

- fiscal_total_amount: $4.042,50;
- commercial_rounding_adjustment: $7,50;
- payable_amount: $4.050.

Pago electrónico:

El valor se ajusta al peso exacto definido por la política de cobro electrónico y conciliación.

---

# 12. Orden de cálculo de una venta

Orden conceptual inicial:

1. Resolver producto, variante y presentación.
2. Convertir cantidad a unidad requerida.
3. Resolver precio vigente.
4. Calcular importe bruto por línea.
5. Determinar promociones elegibles.
6. Aplicar promociones según prioridad y compatibilidad.
7. Aplicar descuentos manuales autorizados.
8. Calcular base tributaria.
9. Calcular impuestos.
10. Consolidar total calculado.
11. Aplicar una vez la política comercial y obtener `payable_amount`.
12. Validar suma de pagos.
13. Guardar snapshots.
14. Confirmar transacción.

## Regla

El orden definitivo debe implementarse como una canalización explícita, versionada y cubierta por pruebas.

---

# 13. Productos por peso

## Entrada de peso

El peso puede provenir de:

- balanza conectada;
- código emitido por balanza;
- entrada manual;
- producto preempacado.

## Reglas

1. La unidad y precisión deben estar definidas.
2. El precio se calcula sobre la cantidad real.
3. La entrada manual puede requerir permiso.
4. El peso negativo o cero se rechaza.
5. El valor leído debe estabilizarse según el adaptador.
6. El sistema debe conservar cantidad, unidad, precio por unidad y total.
7. No debe depender de una marca específica de balanza.

---

# 14. Especialización por comercio

## Tiendas y supermercados

- códigos de barras;
- presentaciones;
- precios por volumen;
- promociones;
- crédito;
- venta rápida.

## Avícolas y carnicerías

- peso;
- lotes;
- FEFO;
- transformación;
- despiece;
- merma.

## Fruver

- peso;
- catálogo visual;
- productos perecederos;
- merma.

## Droguerías

- variantes por concentración y presentación;
- lotes;
- vencimientos;
- atributos regulatorios;
- restricciones especiales.

## Ferreterías

- longitud;
- masa;
- volumen;
- conversiones;
- precios por cantidad.

## Cacharrerías y ropa

- variantes;
- colores;
- tallas;
- referencias;
- inventario por combinación.

## Regla

La especialización se implementa mediante configuración, módulos y atributos; no mediante copias del código.

---

# 15. Operación local-first del motor comercial

El motor comercial podrá operar con reglas sincronizadas localmente cuando el servidor central no esté disponible.

La política normativa de autoridad, versionado, conflictos, outbox, inbox y recuperación se define en:

- `docs/adr/DEC-007-local-first-data-authority.md`.

## Autoridad

1. El servidor central es autoritativo para catálogo, pricing, promociones, impuestos y configuración comercial.
2. El dispositivo utiliza únicamente versiones previamente sincronizadas.
3. El dispositivo no inventa reglas globales.
4. El reloj local no determina vigencia definitiva.
5. Una regla comercial no se sobrescribe mediante `last-write-wins`.

## Venta offline

Toda operación comercial offline deberá conservar como mínimo:

- versión del pipeline de pricing;
- versión de catálogo;
- versión de presentación;
- reglas promocionales aplicadas;
- tarifas fiscales aplicadas;
- política de redondeo;
- checksum de configuración;
- fecha local;
- estado de calidad del reloj;
- dispositivo;
- actor;
- snapshot resultante.

## Reglas

1. Una venta completada conserva el snapshot comercial original.
2. Una sincronización posterior no recalcula la venta con reglas nuevas.
3. Una promoción no se aplica nuevamente durante un reintento.
4. Un cambio central de precio no modifica ventas históricas.
5. Un cambio de impuesto no modifica snapshots tributarios anteriores.
6. Una versión vencida puede bloquear la operación o enviarla a revisión.
7. Una discrepancia entre reglas locales y centrales no se oculta.
8. Toda corrección posterior utiliza una operación nueva.
9. La misma operación conserva `operation_id` e `idempotency_key`.
10. Un payload diferente requiere una identidad nueva.
11. Un conflicto de versión no sobrescribe automáticamente el estado central.
12. El resultado local y su operación de sincronización deben persistirse atómicamente.
13. Una respuesta tardía conserva correlación con la operación original.
14. El frontend puede previsualizar, pero no constituye autoridad comercial.
15. Las proyecciones comerciales no sustituyen los hechos ni snapshots originales.

## Restricciones offline

Una operación deberá bloquearse o pasar a `REVIEW_REQUIRED` cuando:

- la versión comercial no sea soportada;
- la política fiscal haya expirado;
- el checksum no coincida;
- el dispositivo esté revocado;
- el reloj sea no confiable para una operación sensible;
- falte una presentación requerida;
- la regla aplicada no pueda demostrarse;
- exista un conflicto que afecte impuestos, total o elegibilidad.

# 16. Invariantes críticas

1. Un código activo identifica un único artículo vendible dentro de una empresa.
2. Toda venta conserva el precio realmente aplicado.
3. Toda promoción aplicada es explicable y auditable.
4. Ningún cambio posterior modifica ventas históricas.
5. El inventario cambia mediante movimientos.
6. Toda conversión conserva trazabilidad y costo.
7. El redondeo no altera productos ni impuestos silenciosamente.
8. Los cálculos monetarios utilizan Decimal.
9. El motor debe producir el mismo resultado con la misma entrada y versión de reglas.
10. La lógica crítica reside en backend o núcleo local confiable, no exclusivamente en la interfaz.

## Precisión operativa adicional para COP

1. Los cálculos internos conservan seis decimales.
2. La normalización fiscal o documental reduce precisión únicamente en la etapa versionada correspondiente.
3. `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` se aplica al total documental, no a un medio.
4. En pagos mixtos no se redondea ningún componente.
5. La suma de pagos confirmados debe coincidir exactamente con `payable_amount`, salvo sobrepago o cambio registrados explícitamente.
6. `cash_received` y `change_amount` pertenecen a caja y no modifican el total comercial.
7. No se mostrarán centavos al usuario final salvo en vistas técnicas o de auditoría.
