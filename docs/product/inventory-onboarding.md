# Cómo se alimenta el inventario de un POS

De la entrega del equipo a la primera venta facturada.

> **Qué es este documento.** La secuencia real y medida, no la deseable. Cada
> paso dice con qué operación se hace y qué pasa si se salta. Lo que todavía
> no existe está marcado y **no se presenta como disponible**.

## La pregunta que contesta

Un POS no se estrena porque le falte motor. Se estrena o no según tenga **por
dónde meter la mercancía**. Medido el 2026-09-22: poner *un* artículo vendible
y facturable cuesta tres operaciones —crear el artículo, declarar sus códigos
DIAN, dar entrada a la existencia—. Un minimercado tiene entre dos y cinco mil
referencias: son diez o quince mil capturas antes de vender la primera
gaseosa.

Por eso la carga inicial es una capacidad, no un detalle de operación.

## Orden real

### 1 · El equipo queda operativo

Antes de hablar de mercancía, el equipo tiene que tener **sesión**. Sin ella
el POS arranca y rechaza toda operación, que es el comportamiento correcto.

La secuencia de aprovisionamiento está en
[`tools/provisioning/README.md`](../../tools/provisioning/README.md) §Orden de
puesta en marcha. Resumen: se publica el bundle de confianza, se firma el
artefacto del operador y el servicio arranca apuntando a los dos.

Señal de que quedó: `security.operator_session → PROVISIONED`.

### 2 · Se abre el turno de caja

`cash.shift.open`. Ninguna venta existe fuera de un turno: es lo que permite
cuadrar al cerrar.

### 3 · Carga inicial del catálogo

**Desde la pantalla «Carga inicial del catálogo»**, que es el primer panel del
POS después de la sesión. El comerciante:

1. exporta su hoja de Excel como CSV y la elige, **o** copia las celdas y las
   pega —las dos cosas funcionan: Excel en español exporta con `;` y copiar
   celdas produce tabuladores, y se aceptan ambos—;
2. pulsa **Revisar**, que **no envía nada**: dice cuántas líneas están listas y
   cuáles tienen un problema, con el número de línea de su hoja;
3. pulsa **Cargar**. Las líneas con error se omiten y se dice cuántas.

Por debajo, la pantalla envía `catalog.item.import` en lotes de hasta **500
artículos** y traduce cada rechazo a la línea del fichero. Cada fila lleva:

| Campo | Obligatorio | Qué pasa si falta |
|---|---|---|
| `code`, `name`, `presentation_name` | sí | — |
| `unit_code`, `unit_precision` | sí | gobierna qué cantidad se puede vender |
| `barcode` | no | sin él, el artículo se busca por nombre y no por lector |
| `price_amount` | sí | — |
| `initial_quantity` | **no** | la ficha existe y el artículo «todavía no llegó». Es distinto de «se agotó», y por eso no se obliga a declarar cero |
| `fiscal` | **no** | el artículo **se vende y no se factura**: la emisión lo rechaza |

**La carga no es todo o nada.** Cada fila es atómica en sí misma y devuelve su
desenlace con su índice. Tres mil filas y la 1.742 con un código repetido: las
2.999 buenas entran y el operador corrige una línea, no el fichero.

`COMPLETED` **no significa «todas entraron»**: significa que el lote se
procesó entero. `rejected` dice cuáles no y por qué.

**Lo que la pantalla no adivina, a propósito:**

- `3.200` se rechaza. En Colombia puede ser tres mil doscientos o tres coma
  dos, y un precio mil veces menor no lo avisa nadie hasta que la caja no
  cuadra. El mensaje dice qué escribir: `3200` o `3,2`.
- Existencia inicial en cero se rechaza: se deja vacía. Cero haría
  indistinguible «todavía no llegó» de «se agotó».
- Los cinco códigos DIAN van todos o ninguno.
- Un código repetido dentro del fichero se señala con las dos líneas.

**Recargar la misma hoja no duplica nada**: cada artículo ya cargado responde
`CODE_ALREADY_REGISTERED` y su existencia no se vuelve a sumar, porque la fila
se detiene antes de llegar a ella.

La existencia inicial entra como `OPENING_COUNT` —un conteo de apertura—, no
como una compra que nadie hizo.

### 4 · Lo que llega después de la carga

| Situación | Operación |
|---|---|
| Llega mercancía del proveedor | `inventory.stock.receive` (`PURCHASE_RECEIPT`) |
| Llega mercancía con lote y vencimiento | `inventory.lot.receive` — pantalla «Lotes y vencimientos». Un código ya usado —en esta sucursal o en otra— con otras fechas es `LOT_CODE_CONFLICT`, y la pantalla dice con qué fechas existe ya |
| Qué vence esta semana en todo el negocio | `inventory.lot.expiring` — pantalla «Lotes y vencimientos», «Ver lo que vence»: tandas con existencia vencidas o a 7 días o menos, con el nombre del producto |
| Ver qué tanda vence primero | `inventory.lot.list` — misma pantalla, en orden FEFO; avisa las tandas que vencen en **7 días o menos** y las vencidas que quedan por sacar |
| El proveedor avisa de una tanda defectuosa | `inventory.lot.trace` — misma pantalla: qué ventas y mermas se la llevaron, y cada venta se abre con su recibo |
| Se rompió o se dañó | `inventory.stock.adjust` (`SHRINKAGE`); sale del lote que se nombre, o por FEFO si no se nombra |
| Se venció | `inventory.stock.adjust` (`SHRINKAGE`, motivo `EXPIRED`) **con el lote vencido nombrado**: sin lote se rechaza (`LOT_REQUIRED`), porque la venta nunca elige un lote vencido y es la única vía por la que sale |
| El conteo no cuadra | `inventory.stock.adjust` (`ADJUSTMENT_POSITIVE` / `NEGATIVE`); con lote nombrado, corrige esa tanda. Un ajuste positivo sólo suma a una tanda **que ya existe**: una nueva se recibe con sus fechas |
| Se abre una paca y se vende por unidad | `catalog.conversion.declare` + `inventory.conversion.apply` |
| Un artículo se vende en dos formatos | `catalog.presentation.add` |

Recibir y ajustar son **permisos distintos** a propósito: recibir es rutina,
ajustar es corregir la verdad, y es la vía por la que se roba en un POS.

### 5 · Vender y facturar

`sale.create` → `payment.register.*` → `fiscal.document.issue`.

El inventario baja **al completarse el cobro**, no al crear la venta.

## Qué hace falta para que la factura sea legal

| Requisito | Estado |
|---|---|
| Códigos DIAN por artículo (`catalog.fiscal.attribute.set` o el campo `fiscal` de la carga) | ✅ |
| Rango de numeración autorizado | ✅ esquema; se sincroniza con el proveedor |
| Adquiriente identificado | ✅ |
| **Adquiriente genérico («consumidor final»)** | ❌ `D-13`. **Una venta de mostrador anónima no se puede emitir**, y en un minimercado es la mayoría |
| **Unidad de medida real para productos por peso** | ❌ `D-37`. Sólo está verificado el código `94` = «Unidad». Un artículo por peso factura declarando unidades |

Las dos carencias son **fuente documental de la DIAN**, no trabajo de motor.
Mientras sigan abiertas, un comercio por peso vende bien y factura mal — que
es peor que no facturar.

## Lo que todavía no existe, dicho sin adornos

- **Compras y proveedores.** No existe `Supplier` ni documento de compra: se
  puede dar entrada a mercancía, pero **no reconciliarla contra la factura del
  proveedor**, porque no hay modelo de costo.
- **La venta de mostrador no tiene comprador.** «Compradores del lote» da
  nombre, teléfono y correo de quien la venta nombró; las ventas anónimas se
  cuentan, pero no hay a quién llamar. Si el comercio quiere poder avisar en un
  retiro, tiene que nombrar al cliente al vender —el campo existe en la
  pantalla de venta—. Eso es decisión del comercio, no del software.
- **La factura puede nombrar a otro adquiriente** (`D-40`). El rastro sigue al
  cliente de la venta, no al de la factura.
- **Abrir una paca: las unidades heredan su tanda** (desde el 2026-09-26,
  `MIGRATION_029`), con el mismo código y las mismas fechas, y el rastro va de
  la paca a sus unidades y de vuelta. Dos casos entran **sin lote**, a
  propósito: si en las unidades ya existe ese código recibido por otra vía
  —fusionarlos mezclaría dos tandas— y si el reparto entre dos tandas no da
  exacto. Los dos son medibles: existencia menos suma de lotes.
- **Existencia sin lote.** Si entró mercancía por `inventory.stock.receive` y
  luego se vende más de lo que cubren los lotes, lo que falta queda sin asignar
  a lote. No se inventa de qué tanda salió.
- **Balanza.** El peso se teclea.

## Historial

| Fecha | Qué cambió |
|---|---|
| 2026-09-26 | La misma tanda en dos sucursales tiene que traer las mismas fechas; si no, `LOT_CODE_CONFLICT` (decisión del propietario). |
| 2026-09-26 | «Vence esta semana»: la vista de todo el negocio, nombrada por Catálogo. |
| 2026-09-26 | «Próximo a vencer» = 7 días (decisión del propietario). La lista de lotes marca `NEAR_EXPIRY` y avisa. |
| 2026-09-26 | El ajuste positivo suma a una tanda existente nombrándola, y el libro del lote registra también sus entradas (`MIGRATION_030`): el rastro muestra cada recepción, remesa, herencia y ajuste con su motivo. Una remesa sobre una tanda agotada la reactiva. |
| 2026-09-26 | Las unidades de una paca abierta heredan su tanda; el rastro y «Compradores del lote» bajan de la paca a sus unidades. |
| 2026-09-26 | Del lote a la persona: el recibo dice qué cliente nombró la venta, y «Compradores del lote» da la lista de un retiro con contacto, anónimos contados y lo ilegible declarado. |
| 2026-09-26 | Rastro de lote (`inventory.lot.trace`) y pantalla «Lotes y vencimientos»: recibir, ver en orden FEFO y rastrear hasta el recibo. |
| 2026-09-26 | Merma, ajuste negativo, traslado y apertura de paca también bajan del lote. La merma por vencimiento exige el lote. El código de lote pasa a ser único **por sucursal** (`MIGRATION_028`): antes, recibir la misma tanda en dos sucursales sumaba a la de la otra. |
| 2026-09-26 | La venta consume lotes por FEFO y deja rastro (`MIGRATION_027`). Se sustituye «consumo de lotes por venta» por lo que de verdad sigue faltando en lotes. |
| 2026-09-26 | La carga tiene pantalla. Se retira de «lo que todavía no existe». |
| 2026-09-22 | Primera redacción, tras medir que alimentar el catálogo costaba tres operaciones por artículo y no existía ninguna ruta masiva. Se añade `catalog.item.import` |
