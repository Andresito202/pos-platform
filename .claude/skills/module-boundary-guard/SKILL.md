---
name: module-boundary-guard
description: Usar antes de generar o modificar código que toque tablas, servicios o tipos de más de un bounded context en pos-platform (Catalog, Sales, Inventory, Payments, etc).
---
# Guardia de límites de módulo

pos-platform tiene ownership explícito por bounded context (ver docs/architecture/module-map.md
y docs/architecture/data-ownership.md). Antes de escribir código:

1. Identifica a qué módulo pertenece el cambio (Identity, Sales, Inventory, Payments, Tax, etc).
2. Si el cambio necesita datos de OTRO módulo, usa el contrato/adapter expuesto por ese módulo —
   nunca un JOIN directo ni escritura directa a sus tablas.
3. `Categories`, `Product Codes`, `Units`, `Lots` son subcapacidades de owners existentes, no
   bounded contexts nuevos — no les crees su propio módulo.
4. Si el cambio requiere cruzar el límite de forma legítima, decláralo explícitamente y propone
   el contrato entre módulos en vez de saltártelo silenciosamente.
5. **Esto es ejecutable, no una convención:** `pnpm architecture:check` valida
   capas declaradas, protocolo `workspace:`, imports relativos entre proyectos,
   dependencias externas prohibidas por capa y las áreas congeladas de
   `DEC-017` §4.2. Córrelo antes de decir que el cambio respeta los límites.
