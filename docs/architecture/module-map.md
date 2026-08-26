# Mapa de módulos

## Propósito

Este documento define los bounded contexts y módulos propietarios de POS Platform. La granularidad aquí es normativa para futuros límites de paquetes, imports y ownership.

Un nombre de subcapacidad no crea automáticamente un módulo independiente. La propiedad detallada de datos se mantiene en `docs/architecture/data-ownership.md`.

## Fundación de plataforma

- `Identity`
- `Tenants`
- `Companies`
- `Branches`
- `Authorization`
- `Devices`
- `Licensing`
- `Audit`
- `Sync`

## Núcleo comercial

- `Catalog`
- `Pricing`
- `Tax`
- `Inventory`
- `Purchasing`
- `Suppliers`
- `Sales`
- `Payments`
- `Cash Register`
- `Customers`
- `Reporting`

### Subcapacidades que no son módulos independientes

Las siguientes capacidades pertenecen a un owner ya definido y no crean un bounded context paralelo:

- `Categories` -> `Catalog`;
- `Product Codes` / identifiers -> `Catalog`;
- `Units` / unidades de medida y conversiones -> `Catalog`;
- `Lots` -> `Inventory`.

Si en el futuro una subcapacidad requiere extracción, deberá existir evidencia de carga, ownership u operación que justifique una decisión arquitectónica nueva. No se divide preventivamente el monolito modular.

## Operación extendida

- `Orders`
- `Delivery`
- `Couriers`
- `Notifications`
- `Hardware`
- `Support`
- `Subscriptions`
- `External Integrations`
- `Electronic Invoicing`

### External Integrations

`External Integrations` es el owner de:

- `ProviderRegistry`;
- `ExternalIntegration`;
- referencias de credenciales generales;
- capabilities y declaraciones;
- discovery;
- mappings externos;
- ownership central↔provider;
- dispatch externo;
- rate limiting;
- webhook receipts;
- evidencia de verificación.

No posee `Sale`, `Payment`, `Product`, `Customer`, `Tax`, `Inventory` ni el resultado legal de un documento electrónico.

Migration 002 materializa su foundation central y mantiene `IntegrationDispatch` limitado físicamente a `NON_FISCAL` hasta que una migration fiscal posterior sea autorizada y materializada.

### Electronic Invoicing

`Electronic Invoicing` es propietario de conexiones/perfiles fiscales, configuraciones de emisión, documentos electrónicos, intentos fiscales, artefactos, incidencias y conciliación fiscal.

No es propietario de ventas, pricing, impuestos calculados, pagos, caja ni inventario.

`FiscalConnection` extiende una `ExternalIntegration` fiscalmente elegible; no duplica account identity, credenciales generales, environment, health o capabilities generales.

La migration 003 continúa `NOT_MATERIALIZED`. Cualquier contradicción contractual detectada en SQL003 bloquea su materialización hasta reconciliación autoritativa.

## Componentes de ejecución

Los siguientes son componentes de despliegue y no dominios adicionales:

- POS Desktop;
- POS Local Service;
- API central;
- workers;
- panel web;
- PostgreSQL central;
- SQLite local;
- object storage;
- `ConfigurationDistribution`.

`ConfigurationDistribution` es infraestructura de transporte de referencias, versiones y snapshots. No posee configuración de negocio y no autoriza una entidad global `Configuration`.

Un módulo puede ejecutarse en más de un componente mediante puertos y contratos sin transferir la propiedad de sus datos.

## Reglas de propiedad

1. Cada módulo posee sus reglas y sus datos autoritativos.
2. Un módulo no modifica directamente tablas internas de otro módulo.
3. Las operaciones cruzadas usan casos de uso, puertos, contratos o eventos explícitos.
4. `Identity` posee `User`; `Tenants` posee `TenantMembership`; `Authorization` posee roles, permisos, políticas y `UserRoleAssignment`.
5. `Inventory` es la única autoridad para movimientos, existencias, reservas y lotes.
6. `Pricing` posee listas, precios, promociones, descuentos y redondeo comercial; consume resultados de `Tax` sin adquirir ownership tributario.
7. `Tax` posee reglas, clasificación, tasas, vigencias y resultados tributarios.
8. `Sales` no modifica estados internos de `Payments`; `Payments` no reescribe `Sale`.
9. `Electronic Invoicing` consume snapshots de `Sales`, `Pricing` y `Tax`; no recalcula ni sobrescribe esos dominios.
10. `Sync` posee coordinación, outbox/inbox, checkpoints, conflictos, reviews y dead letters; no adquiere ownership del hecho de negocio transportado.
11. `Reporting` nunca es fuente de verdad transaccional.
12. No existe un módulo global `Configuration`; cada dominio posee sus configuraciones/versiones y la infraestructura solo las distribuye.
13. Un provider externo nunca define columnas provider-specific dentro de entidades canónicas de negocio.

## Regla para ARCH-003 y el monorepo

Los futuros límites Nx/packages deben derivarse de este mapa y de `data-ownership.md`. No se crean packages separados para `Categories`, `Product Codes`, `Units` o `Lots` como si fueran dominios propietarios distintos.

Si `module-map.md`, `data-ownership.md`, un ADR o un contrato físico difieren en ownership, la implementación se detiene y se reconcilia primero la contradicción.
