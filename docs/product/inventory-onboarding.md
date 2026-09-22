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

`catalog.item.import`, en lotes de hasta **500 artículos**. Cada fila lleva:

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

La existencia inicial entra como `OPENING_COUNT` —un conteo de apertura—, no
como una compra que nadie hizo.

### 4 · Lo que llega después de la carga

| Situación | Operación |
|---|---|
| Llega mercancía del proveedor | `inventory.stock.receive` (`PURCHASE_RECEIPT`) |
| Llega mercancía con lote y vencimiento | `inventory.lot.receive` |
| Se rompió, se dañó o se venció | `inventory.stock.adjust` (`SHRINKAGE`) |
| El conteo no cuadra | `inventory.stock.adjust` (`ADJUSTMENT_POSITIVE` / `NEGATIVE`) |
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

- **Pantalla de carga.** `catalog.item.import` se invoca por el canal; no hay
  una pantalla que lea el fichero del comerciante. Hoy la carga la hace quien
  instala, no el comerciante.
- **Compras y proveedores.** No existe `Supplier` ni documento de compra: se
  puede dar entrada a mercancía, pero **no reconciliarla contra la factura del
  proveedor**, porque no hay modelo de costo.
- **Consumo de lotes por venta.** Se declara la tanda y se ve qué vence, pero
  la venta **no consume por FEFO** ni deja rastro de qué lote salió. Para un
  retiro sanitario eso es la mitad que falta.
- **Balanza.** El peso se teclea.

## Historial

| Fecha | Qué cambió |
|---|---|
| 2026-09-22 | Primera redacción, tras medir que alimentar el catálogo costaba tres operaciones por artículo y no existía ninguna ruta masiva. Se añade `catalog.item.import` |
