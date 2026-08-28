# Límites modulares ejecutables

## Estado y alcance

ARCH-003 materializa el grafo mínimo de paquetes definido por ADR-005 y convierte sus reglas de dependencia en un gate ejecutable. Este corte no crea aplicaciones, runtime, contratos Zod, controladores, adaptadores productivos ni lógica de negocio.

El workspace queda compuesto por Nx, pnpm y los siguientes paquetes privados vacíos:

| Paquete | Capa | Alcance |
|---|---|---|
| `@pos-platform/domain` | `domain` | Reglas puras de dominio futuras |
| `@pos-platform/application` | `application` | Casos de uso y puertos futuros |
| `@pos-platform/contracts` | `contracts` | Contratos versionados futuros; su contenido pertenece a TECH-003 |
| `@pos-platform/database-core` | `database-core` | Tipos y utilidades comunes sin ocultar dialectos |
| `@pos-platform/database-postgres` | `adapter` | Persistencia PostgreSQL central |
| `@pos-platform/database-sqlite` | `adapter` | Persistencia SQLite local |
| `@pos-platform/observability` | `observability` | Correlación, métricas y trazas futuras |
| `@pos-platform/testing` | `testing` | Builders y fixtures sintéticos futuros |

`apps/*` queda incluido como ubicación de workspace para una fase posterior, pero ARCH-003 no crea `api`, `worker`, `pos-desktop`, `pos-local-service` ni `owner-web`.

`tools/target-migrations` permanece como tooling TARGET ya integrado y no se reclasifica como package de runtime. Continúa gobernado por sus gates de migración, no por la matriz de capas de aplicaciones.

## Matriz de dependencias

| Origen | Capas internas permitidas |
|---|---|
| `domain` | Ninguna |
| `application` | `domain`, `contracts` |
| `contracts` | Ninguna |
| `database-core` | `domain`, `contracts` |
| `adapter` | `domain`, `application`, `contracts`, `database-core`, `observability` |
| `observability` | `contracts` |
| `testing` | Todas las capas declaradas |

La matriz expresa dirección de dependencias, no autorización para implementar contenido antes de su gate. Un import interno también debe estar declarado en el `package.json` del paquete consumidor con protocolo `workspace:`.

## Controles ejecutables

`pnpm architecture:check` ejecuta mediante Nx:

1. pruebas negativas del validador;
2. validación de todos los paquetes del workspace;
3. identidad exacta entre política, `package.json`, `project.json`, roots y tags Nx;
4. dependencias de capas;
5. rechazo de imports relativos que atraviesen fronteras entre proyectos de `apps/*` o `packages/*`;
6. imports `@pos-platform/*` no declarados;
7. dependencias internas declaradas o importadas que violen la matriz de capas;
8. protocolo `workspace:` obligatorio para toda dependencia interna, aun antes de existir imports;
9. imports externos sin dependencia directa declarada, evitando phantom dependencies;
10. frameworks o drivers prohibidos tanto en imports como en manifests de capas puras;
11. descubrimiento automático de manifests del workspace para que nuevos proyectos no escapen de policy CI.

La política canónica está en `tools/architecture/module-boundaries.json`. El gate falla cerrado si aparece un package en `apps/*` o `packages/*` que no esté gobernado por esa política.

## Reglas de ownership preservadas

Los bounded contexts continúan definidos por `module-map.md` y `data-ownership.md`. Los ocho packages son capas técnicas compartidas; no sustituyen ni fusionan los owners de negocio.

No se permiten packages independientes para `Categories`, `Product Codes`, `Units` o `Lots`: siguen perteneciendo a `Catalog` o `Inventory` según el mapa autoritativo.

## Límites del control

- El análisis cubre imports estáticos, exports, `require()` y `import()` con specifier literal.
- Un specifier calculado no es un mecanismo autorizado para evadir el grafo y deberá ser rechazado en review.
- Las restricciones de renderer Electron, hardware y procesos se activarán cuando esos proyectos sean autorizados y añadidos a la política.
- TECH-003 debe materializar contratos y paths reales antes de que una aplicación pueda depender de ellos.
- Este gate no demuestra seguridad runtime, aislamiento tenant, deploy ni operación productiva.

## Evolución

Cualquier proyecto nuevo requiere en el mismo cambio:

1. ownership y capa explícitos;
2. entrada en la política;
3. tags Nx exactos;
4. dependencias `workspace:` explícitas;
5. `projectType` y tags Nx coherentes con la política;
6. prueba negativa para una frontera nueva;
7. CI y review exact-head.
