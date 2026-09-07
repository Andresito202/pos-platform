# Qué comercios puede atender hoy el POS

## Para qué existe este documento

`business-types.md` declara a qué comercios apunta el producto. Este documento
cruza esa lista contra lo que hay en `main`, con la evidencia de cada fila.

Es el cruce que faltaba: la lista de comercios es una **intención de producto**,
y hasta ahora nadie había comprobado cuáles de esas operaciones el POS puede
ejecutar de verdad.

La respuesta corta, y conviene leerla antes que la tabla:

> **Hoy el POS todavía no puede atender a ninguno de los comercios
> prioritarios.** El catálogo real ya está (2026-09-07); faltan **inventario** e
> **interfaz de caja**, y esas dos las necesitan todos.

Los comercios de **venta por peso** tienen además un bloqueo propio, y es el
hallazgo que más importa de este cruce.

## Lo que todos necesitan y no existe

| Pieza | Estado | Evidencia |
|---|---|---|
| **Catálogo real** | ✅ | `MIGRATION_014` · `catalog_product` / `catalog_presentation` / `catalog_price` · alcanzable por el canal |
| **Inventario** | ❌ | ninguna tabla ni caso de uso |
| **Interfaz de caja** | ❌ | el renderer expone tres llamadas técnicas y **ninguna comercial** |
| **Lector de código de barras** | ⚠️ | el catálogo resuelve **código → artículo** (`catalog.item.find`) y garantiza que un código identifica una sola presentación; falta el periférico que lo lea |
| Venta, cobro, caja y adquiriente | ✅ | `Sales`, `Cash`, `Payments`, `Customers` en `main`, probados |
| Impuesto por línea | ✅ | `catalog_fiscal_attribute` · `MIGRATION_013` |

**Actualización del 2026-09-07:** el catálogo real ya existe y el lector tiene a
qué preguntar. Quedan **inventario** e **interfaz de caja**; mientras esas dos
sigan en ❌, el tipo de comercio sigue siendo irrelevante y **ninguno puede
vender** — un cajero no tiene pantalla desde la que hacerlo.

## Comercios prioritarios, uno por uno

| Comercio | Además de lo común, necesita | Estado |
|---|---|---|
| Tienda de barrio | código de barras, presentaciones, crédito | ❌ los tres |
| Minimercado | ídem + compras | ❌ |
| Supermercado pequeño/mediano | ídem + promociones, multisucursal | ❌ promociones · el ámbito multisucursal **sí** existe en el modelo |
| Perecederos y **venta por peso** | balanza, lotes, vencimientos, merma | ❌ los cuatro · **más el bloqueo fiscal de abajo** |
| Carnicería | ídem + despiece, transformación, trazabilidad | ❌ |
| Fruver | ídem + catálogo visual, alertas | ❌ |
| Cacharrería y variedades | referencias, colores, tallas, precio mayorista/minorista | ❌ |
| Papelería | código de barras, inventario | ❌ |
| Depósito de bebidas · licorera | presentaciones, envase retornable | ❌ envase · presentaciones existen en el esquema |

## El bloqueo propio de la venta por peso

Cuatro de los diez comercios prioritarios venden por peso: perecederos,
carnicerías, fruver y parte de los minimercados. Ahí hay **dos** problemas
distintos, y sólo uno estaba registrado.

### 1. Seis decimales no se pueden facturar — `D-14`

El POS lleva el dinero y las cantidades en escala 6. La documentación de emisión
de FACTUS es explícita: **todos los numéricos viajan con máximo dos decimales**.

Una báscula produce `0.333333` kg. Ese valor **no se puede transmitir con
fidelidad**, y `toProviderDecimal` se niega a redondearlo en vez de emitir una
factura que no coincide con lo pesado y cobrado.

**Consecuencia concreta:** una carnicería que pese 333 gramos con seis decimales
de precisión puede vender y cobrar, y **no puede facturar electrónicamente esa
venta**. La decisión de qué hacer —redondear la cantidad antes de vender,
declarar la unidad con menos precisión, o rechazar la venta— es de negocio, no
de programa, y hay que tomarla antes de vender a una carnicería.

### 2. La precisión de la unidad ahora sí gobierna

`unit_precision` existía en el catálogo, se arrastraba hasta el snapshot de la
línea y **no comprobaba nada**. Se podía vender `0.000001` de una botella y
cobrarlo; comprobado con sonda contra el contrato antes de escribir la regla.

Ahora `CreateSaleUseCase` rechaza con `QUANTITY_PRECISION_EXCEEDED` la cantidad
que no cabe en la precisión declarada, **antes** de multiplicarla por ningún
precio. Eso protege los dos extremos del catálogo de comercios:

- **tienda, licorera, papelería** venden unidades discretas (`unit_precision`
  0): media unidad es un error de captura, no una venta;
- **carnicería y fruver** venden por peso (`unit_precision` 3): tres decimales
  son legítimos y seis no —y seis, además, no se facturan—.

Declarar la unidad de peso con `unit_precision` 2 hace que `D-14` deje de morder
esa presentación: la cantidad ya no puede tener más decimales de los que el
proveedor acepta. **Es la mitigación disponible hoy**, y es una decisión de
configuración del comercio, no un cambio de código.

## La regla de interfaz todavía no se puede cumplir

`business-types.md` cierra con: «cada negocio verá únicamente las funciones,
categorías y módulos relevantes para su operación».

Eso exige un perfil de comercio que module la interfaz, y **no existe ni el
perfil ni la interfaz**. Se registra aquí para que no se dé por hecho al diseñar
las pantallas: la regla es una decisión ya tomada que la interfaz tendrá que
respetar desde el primer día, no un añadido posterior.

## Orden que se deriva de este cruce

No es una lista de deseos: es el orden en que los bloqueos se desbloquean entre sí.

1. **Catálogo real** con presentaciones, códigos de barras y unidades. Sin él no
   hay comercio que atender, y ya existen los atributos fiscales que colgarán
   de él.
2. **Interfaz de caja.** Trece operaciones construidas y probadas esperan
   pantalla.
3. **Inventario.** Lo exigen todos los prioritarios salvo la venta pura de
   servicios.
4. **Decisión de negocio sobre `D-14`** antes de vender a una carnicería o un
   fruver.
5. **Balanza y lector**, que son los dos periféricos que aparecen en más
   comercios de la lista.

## Historial

| Fecha | Qué se cruzó |
|---|---|
| 2026-09-07 | primer cruce; `unit_precision` pasa a gobernar la cantidad; se documenta el bloqueo fiscal de la venta por peso |
| 2026-09-07 | catálogo real materializado: la primera de las tres piezas comunes deja de faltar |
