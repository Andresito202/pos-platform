---
name: nx-module-scaffold
description: Usar al crear un módulo o capacidad nueva en pos-platform. La arquitectura canónica la fija DEC-017 y NO es la que decía la versión anterior de este skill.
---
# Dónde vive un módulo nuevo (arquitectura canónica)

> **Corrección 2026-09-06.** La versión anterior decía que el stack era «NestJS +
> Fastify + Kysely» y que «`apps/` y `packages/` del TARGET aún no existen en el
> repo». Ambas afirmaciones son **falsas**: no hay una sola dependencia de
> NestJS ni de Fastify en el workspace, y existen 13 proyectos. Seguir ese
> skill llevaba a proponer una arquitectura que `DEC-017` archivó.

## Lo que manda

`docs/adr/DEC-017-canonical-runtime-architecture.md` §4. Léelo antes de crear nada.

1. **Las reglas de negocio viven en `apps/pos-local-service/src/<módulo>/`**,
   junto a su persistencia SQLite. Un store puede contener reglas junto a su
   SQL: no se exige separar dominio puro.
2. **`packages/domain` y `packages/application` NO se amplían.** Conservan sólo
   autorización y sesión. Esto no es una convención: `pnpm architecture:check`
   falla si aparece un área nueva bajo su `src/`, por `frozenSourceAreas` en
   `tools/architecture/module-boundaries.json`.
3. Un **puerto** se crea sólo cuando una escritura cruza la frontera de otro
   módulo, y **lo define el consumidor** para que el proveedor no lo importe.
   Precedente normativo: `CashPort` (`DEC-016` §10).
4. No se crean puertos para aislar la base de datos: hay un motor de
   persistencia por plano y aislarlo no compra nada verificable.

## Antes de escribir la primera línea

- Búscalo en `docs/governance/materialization-state.md`. Si la columna
  «Código en main» tiene una ruta, **ya existe**.
- Para `Catalog` o `Inventory`: `DEC-018` obliga a leer antes la rama
  `wip/local-catalog-inventory-payment-20260906`, que es la especificación más
  detallada que existe de ambos. Reimplementar sin leerla es el fallo que ya
  costó trabajo dos veces.
- Un paquete nuevo se registra en `module-boundaries.json` **en el mismo
  cambio**, con `package.json`, `project.json` y sus tags exactos, o
  `architecture:check` falla.
