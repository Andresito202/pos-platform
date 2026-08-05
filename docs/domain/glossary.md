# Glosario del dominio

## Plataforma

Sistema completo administrado por el proveedor del software.

## Tenant

Unidad de aislamiento comercial y técnico. Representa a un cliente de la plataforma.

## Empresa

Negocio legal o comercial perteneciente a un tenant.

## Sucursal

Ubicación física u operativa de una empresa.

## Caja registradora

Punto operativo donde se inicia un turno, se registran ventas y se controla efectivo.

## Turno de caja

Periodo comprendido entre la apertura y el cierre de una caja por un usuario.

## Usuario

Persona autenticada que opera dentro de una empresa o de la plataforma.

## Rol

Conjunto de permisos asignados a un usuario.

## Dispositivo

Equipo autorizado para ejecutar el POS o acceder a una aplicación.

## Producto

Entidad comercial que representa el artículo lógico compartido por la empresa.

## Variante

Combinación opcional de atributos comerciales de un producto, como sabor, color, talla, concentración o modelo.

Una variante no representa empaques, cantidades ni unidades de venta.

## Presentación

Forma concreta en la que un producto o una variante se compra, almacena, transforma o vende.

Toda venta, precio, inventario, lote y movimiento operativo resuelve finalmente a una presentación.

## Código de barras

Identificador escaneable asociado a un producto, variante o presentación.

Los códigos utilizados operacionalmente deben resolver finalmente a una presentación.

## Unidad de medida

Unidad física utilizada para comprar, almacenar, transformar o vender una presentación.

## Precio

Valor de venta aplicable según empresa, sucursal, canal, lista o vigencia.

## Inventario

Existencias disponibles de productos por sucursal y ubicación.

## Lote

Grupo de existencias de un producto con origen, costo, fecha y vencimiento comunes.

## Movimiento de inventario

Registro inmutable que incrementa o disminuye existencias.

## Kardex

Historial ordenado de movimientos de inventario.

## Compra

Operación de adquisición de mercancía a un proveedor.

## Recepción

Confirmación física de mercancía recibida.

## Venta

Transacción comercial confirmada con uno o varios productos y pagos.

## Venta suspendida

Venta aún no confirmada que puede recuperarse posteriormente.

## Devolución

Operación que revierte total o parcialmente una venta confirmada.

## Anulación

Reversión autorizada de una operación completa, manteniendo trazabilidad.

## Pago

Registro de dinero recibido mediante efectivo, tarjeta, transferencia, QR, crédito u otro método.

## Pago mixto

Venta pagada mediante más de un método.

## Base de caja

Efectivo inicial entregado al cajero para dar cambio.

## Efectivo esperado

Valor calculado a partir de la base, ventas, ingresos, egresos, retiros y devoluciones.

## Licencia

Autorización firmada para usar determinadas funciones, dispositivos y modalidades.

## Feature flag

Control que habilita o deshabilita una capacidad sin cambiar el código desplegado.

## Modalidad híbrida

POS local con sincronización y servicios centrales cuando hay Internet.

## Modalidad local perpetua

POS instalado localmente con licencia permanente para una versión contratada.

## Domicilio

Pedido preparado y entregado fuera del establecimiento.

## Domiciliario

Usuario encargado de transportar y entregar pedidos asignados.

## PIN de entrega

Código temporal de un solo uso que valida la recepción de un domicilio.

## Auditoría

Registro inmutable de acciones relevantes, responsables, fechas y cambios.

## Snapshot

Copia de datos comerciales o fiscales conservada tal como existía al confirmar una operación.

## Idempotencia

Propiedad que impide duplicar una operación cuando una solicitud se repite.

## Outbox

Registro persistente de eventos pendientes de publicación o sincronización.
