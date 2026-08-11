# Mapa de módulos

## Fundación

- Identity.
- Tenants.
- Companies.
- Branches.
- Authorization.
- Devices.
- Licensing.
- Audit.
- Configuration.

## Núcleo comercial

- Catalog.
- Categories.
- Product Codes.
- Units.
- Pricing.
- Inventory.
- Lots.
- Purchasing.
- Suppliers.
- Sales.
- Payments.
- Cash Register.
- Customers.
- Reporting.

## Operación extendida

- Orders.
- Delivery.
- Couriers.
- Notifications.
- Hardware.
- Support.
- Subscriptions.
- Electronic Invoicing.

`Electronic Invoicing` es propietario de conexiones fiscales, documentos electrónicos, intentos, estados normalizados, artefactos y conciliación. No es propietario de ventas, pricing, impuestos calculados, pagos, caja ni inventario.

## Componentes de ejecución

Los siguientes son componentes de despliegue y no nuevos dominios:

- POS Desktop;
- POS Local Service;
- API central;
- workers;
- panel web;
- PostgreSQL central;
- SQLite local;
- object storage.

Un módulo puede ejecutarse en más de un componente mediante puertos y contratos sin ceder propiedad de sus datos.

## Regla de propiedad

Cada módulo es propietario de sus datos y reglas.

Un módulo no modificará directamente las tablas internas de otro módulo.

`Identity` es propietario de la identidad global `User`; `Tenants` es propietario de `TenantMembership`; `Authorization` es propietario de roles, permisos y `UserRoleAssignment`.

`Electronic Invoicing` consume snapshots de `Sales`, `Pricing` y `Tax`; una respuesta fiscal no modifica directamente esos módulos.
