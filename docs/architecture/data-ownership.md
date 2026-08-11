# Propiedad de datos por módulo

| Módulo | Datos propietarios |
|---|---|
| Identity | Identidad global User, perfil, credenciales, sesiones, factores y recuperación |
| Tenants | Clientes contractuales, aislamiento y TenantMembership |
| Companies | Identidad legal, comercial y branding |
| Branches | Sucursales, horarios, cobertura y ubicación |
| Authorization | Roles, permisos, políticas y UserRoleAssignment |
| Devices | Equipos, terminales, versiones y revocación |
| Licensing | Licencias, planes, módulos y límites |
| Catalog | Productos, categorías, variantes y códigos |
| Pricing | Listas, precios, vigencias e historial |
| Inventory | Stock, lotes, movimientos y reservas |
| Purchasing | GoodsReceipt, líneas y asignaciones de lote; futuras PurchaseOrder, SupplierDocument y devoluciones cuando sus casos de uso se habiliten |
| Suppliers | Proveedores |
| Sales | Ventas, detalles, devoluciones comerciales SaleReturn y anulaciones SaleCancellation |
| Payments | Métodos, grupos, pagos, intentos, asignaciones, refunds, reversals, settlement, conciliación y chargebacks |
| Cash Register | CashRegister, CashShift, CashMovement, CashCount, denominaciones, revisiones de diferencia y cierres |
| Customers | Clientes comerciales y crédito |
| Orders | Pedidos y estados |
| Delivery | Despacho, seguimiento y entrega |
| Couriers | Domiciliarios, turnos y recaudos |
| Reporting | Vistas de lectura y agregados |
| Notifications | Correos, SMS, push y alertas |
| Hardware | Perfiles, adaptadores y periféricos |
| Electronic Invoicing | Conexiones fiscales, rangos conocidos, documentos electrónicos, intentos, estados de proveedor, artefactos e incidencias fiscales |
| Audit | Eventos sensibles e historial |
| Support | Tickets, diagnóstico y accesos temporales |

## Reglas

1. Un módulo no modifica directamente las tablas internas de otro.
2. Las operaciones cruzadas utilizan casos de uso, contratos o eventos.
3. Reporting no es fuente de verdad.
4. Audit no debe depender de la eliminación o modificación de eventos históricos.
5. Payments no permite que Delivery confirme por sí mismo un pago.
6. Inventory es la única autoridad para existencias y reservas.
7. Licensing es la única autoridad para módulos habilitados.
8. Identity autentica; Tenants demuestra pertenencia; Authorization decide permisos y alcance.
9. Sales no modifica estados de Payment y Payments no reescribe Sale.
10. Electronic Invoicing consume snapshots comerciales y fiscales; no recalcula ni sobrescribe Sale, Pricing, Tax, Payments, Cash Register o Inventory.
11. Una nota o ajuste electrónico es un documento nuevo relacionado, no una mutación destructiva del documento aceptado.
12. Credenciales y certificados se referencian desde el almacén definido por SEC-004; no son propiedad de tablas de negocio.
13. Purchasing confirma la recepción física, pero Inventory es la única autoridad que crea movimientos y deriva saldos; una recepción nunca modifica StockBalance por fuera del contrato de Inventory.
14. Payment cubre cobros de ventas, pedidos y cuentas por cobrar. Pagos a proveedores pertenecen a una capacidad financiera futura y no reutilizan ese agregado.
