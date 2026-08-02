# Reglas de negocio

## Empresas y aislamiento

RN-001. Todo dato operativo debe pertenecer a un tenant y a una empresa.

RN-002. Ningún usuario puede consultar o modificar información de otro tenant.

RN-003. Los datos de una sucursal solo pueden consultarse desde otra sucursal cuando el rol y la política de la empresa lo permitan.

RN-004. El contexto de tenant, empresa y sucursal debe validarse en backend.

## Usuarios y seguridad

RN-005. Los permisos no dependen de botones ocultos en frontend.

RN-006. Los cambios críticos requieren reautenticación y segundo factor cuando corresponda.

RN-007. El cajero no puede modificar configuración fiscal, QR de recaudo, licencias, permisos ni costos.

RN-008. Las cuentas administrativas no pueden compartirse.

RN-009. Toda acción sensible debe quedar auditada.

## Productos y precios

RN-010. Un producto puede tener varios códigos de barras.

RN-011. El precio aplicado a una venta debe conservarse como snapshot.

RN-012. Un cambio posterior de precio no modifica ventas ya confirmadas.

RN-013. El cajero no puede cambiar libremente el precio.

RN-014. Los precios deben manejar vigencia e historial.

RN-015. El dinero no debe manejarse con punto flotante binario.

## Inventario

RN-016. El stock no se modifica directamente; cambia mediante movimientos.

RN-017. Cada movimiento debe tener tipo, cantidad, origen, responsable y fecha.

RN-018. Los productos perecederos deben consumirse mediante FEFO cuando exista vencimiento.

RN-019. Los productos sin vencimiento pueden usar FIFO u otra política configurada.

RN-020. Los productos vencidos no pueden venderse salvo una excepción explícita, autorizada y auditada.

RN-021. Los ajustes manuales requieren motivo.

RN-022. Las existencias se controlan por sucursal.

## Ventas

RN-023. Una venta confirmada no se elimina físicamente.

RN-024. Una venta se corrige mediante anulación o devolución.

RN-025. La confirmación de venta debe registrar de forma atómica venta, detalles, pagos, inventario, caja y auditoría.

RN-026. Repetir una solicitud de confirmación no debe crear ventas duplicadas.

RN-027. La impresión fallida no debe eliminar ni revertir una venta confirmada.

RN-028. La facturación electrónica no debe bloquear ni perder la venta comercial.

RN-029. Una venta en efectivo requiere una caja abierta, salvo configuración explícita autorizada.

RN-030. La base inicial de caja no constituye una venta.

## Caja

RN-031. Una caja abierta debe estar asociada a sucursal, terminal, usuario y turno.

RN-032. Un usuario no puede tener dos turnos de caja abiertos en la misma terminal.

RN-033. El cierre conserva valor esperado, valor contado, diferencia y observación.

RN-034. Los cierres no se eliminan.

RN-035. Toda apertura manual de cajón debe auditarse.

RN-036. Los pagos no efectivos no incrementan el efectivo físico esperado.

## Compras

RN-037. Una compra recibida debe generar inventario y movimientos.

RN-038. Anular una compra no puede retirar mercancía ya vendida sin validación.

RN-039. El precio de venta no cambia automáticamente por una nueva compra.

RN-040. El costo histórico debe conservarse.

## Domicilios

RN-041. Un pedido aceptado debe reservar inventario.

RN-042. Un pedido cancelado debe liberar la reserva.

RN-043. El domiciliario no puede modificar QR, cuentas ni medios de recaudo.

RN-044. Una captura de pantalla no confirma un pago.

RN-045. El QR estático mostrado debe pertenecer al negocio o sucursal.

RN-046. La entrega requiere PIN válido de un solo uso.

RN-047. El seguimiento GPS solo estará activo durante el pedido.

RN-048. Las ventas por domicilio y punto físico deben conservar su canal de origen.

## Licencias

RN-049. Las modalidades HYBRID y LOCAL_PERPETUAL comparten la misma base de código.

RN-050. La suspensión por falta de pago debe aplicar avisos y periodo de gracia.

RN-051. No se eliminan datos por falta de pago.

RN-052. El módulo de domicilios se controla mediante licencia y validación backend.

RN-053. La licencia local perpetua no incluye automáticamente actualizaciones mayores.

## Comprobantes

RN-054. Los datos impresos deben corresponder a la empresa y sucursal de la venta.

RN-055. Una reimpresión debe reproducir el snapshot original.

RN-056. CUFE, QR fiscal y resolución solo se imprimen cuando existen datos válidos de integración fiscal.

RN-057. La reimpresión debe quedar auditada.
