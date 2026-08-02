# Propiedad de datos por módulo

| Módulo | Datos propietarios |
|---|---|
| Identity | Credenciales, sesiones, factores, recuperación |
| Tenants | Clientes contractuales y aislamiento |
| Companies | Identidad legal, comercial y branding |
| Branches | Sucursales, horarios, cobertura y ubicación |
| Users | Perfil y asignaciones de usuarios |
| Authorization | Roles, permisos y políticas |
| Devices | Equipos, terminales, versiones y revocación |
| Licensing | Licencias, planes, módulos y límites |
| Catalog | Productos, categorías, variantes y códigos |
| Pricing | Listas, precios, vigencias e historial |
| Inventory | Stock, lotes, movimientos y reservas |
| Purchasing | Compras, órdenes, recepciones y devoluciones |
| Suppliers | Proveedores |
| Sales | Ventas, detalles, devoluciones y anulaciones |
| Payments | Métodos, pagos, confirmaciones y conciliación |
| Cash Register | Turnos, base, movimientos y cierres |
| Customers | Clientes comerciales y crédito |
| Orders | Pedidos y estados |
| Delivery | Despacho, seguimiento y entrega |
| Couriers | Domiciliarios, turnos y recaudos |
| Reporting | Vistas de lectura y agregados |
| Notifications | Correos, SMS, push y alertas |
| Hardware | Perfiles, adaptadores y periféricos |
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
