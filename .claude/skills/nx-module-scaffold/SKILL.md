---
name: nx-module-scaffold
description: Usar al crear un nuevo módulo/bounded context o app dentro del workspace Nx de pos-platform, siguiendo la arquitectura TARGET.
---
# Scaffold de módulo Nx (arquitectura TARGET)

Antes de generar un nuevo módulo:
1. Confirma que el módulo está en la lista canónica (Fundación: Identity, Tenants, Companies,
   Branches, Authorization, Devices, Licensing, Audit, Sync · Núcleo comercial: Catalog, Pricing,
   Tax, Inventory, Purchasing, Suppliers, Sales, Payments, Cash Register, Customers, Reporting ·
   Operación extendida: Orders, Delivery, Couriers, Notifications, Hardware, Support,
   Subscriptions, External Integrations, Electronic Invoicing). No inventes módulos nuevos sin
   que el usuario lo confirme explícitamente.
2. Sigue el stack TARGET: NestJS + Fastify (API central), Kysely (acceso a datos), Zod (contratos
   runtime).
3. `apps/` y `packages/` del TARGET aún no existen en el repo — si es el primer módulo real,
   dilo explícitamente en vez de asumir que ya hay convenciones establecidas para copiar.
4. Registra el nuevo módulo en docs/architecture/module-map.md como parte del mismo cambio,
   no como tarea pendiente separada.
