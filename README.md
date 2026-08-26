# POS Platform

Plataforma POS modular, multi-tenant y local-first orientada a operaciones comerciales reales.

POS Platform busca proporcionar un núcleo comercial reutilizable para distintos tipos de negocio, con límites de dominio explícitos, operación por empresa y sucursal, seguridad contextual y continuidad operativa ante interrupciones de conectividad.

> **Estado actual:** el proyecto está en desarrollo. La Fase 0 de fundación de producto, arquitectura y dominio está cerrada como trabajo documental y la Fase 1 de fundación técnica ejecutable está en progreso. Existen la fundación física PostgreSQL de migrations 001/002 y tooling revisado para preparar MAT-003, pero el runtime objetivo Electron/React/NestJS todavía no está implementado. El sistema no debe considerarse terminado ni listo para producción.

## Objetivo del proyecto

La plataforma está diseñada para soportar progresivamente:

- múltiples tenants, empresas y sucursales;
- identidad global de usuario, pertenencias, roles y permisos contextuales;
- catálogo, variantes, presentaciones, precios, promociones e impuestos;
- inventario, lotes, compras y proveedores;
- ventas, caja, pagos, devoluciones y conciliación;
- operación local-first, sincronización y recuperación;
- dispositivos, periféricos, licenciamiento y modalidades de despliegue;
- onboarding, auditoría, administración, soporte e integraciones.

Estas capacidades forman parte del alcance y de los contratos documentales en distintos niveles de madurez. No equivalen a módulos físicos terminados. Ningún runtime de aplicación está materializado todavía y no debe inventarse uno a partir de implementaciones externas o anteriores.

## Estado del proyecto

El [backlog maestro](docs/product/backlog.md) es la fuente de verdad para estados, prioridades, dependencias y evidencia.

| Etapa | Estado en el backlog | Alcance real |
|---|---|---|
| Fase 0 — Fundación de producto, arquitectura y dominio | `DONE` | Visión, alcance, arquitectura, ADR, modelo conceptual, reglas, seguridad, estrategia de pruebas, migración y casos de uso críticos documentados. |
| Fase 1 — Fundación técnica ejecutable | `IN_PROGRESS` | `TECH-002` está `DONE`; migrations 001/002 permanecen `MATERIALIZED / TESTED / IMMUTABLE`. El tooling de `MAT-003-PREFLIGHT` y de canonical-role readiness está `MATERIALIZED / REVIEWED`; canonical-role readiness está `APPLIED / REVIEWED` únicamente en `LOCAL_CANONICAL_INTEGRATION`. El preflight canónico quedó `EXECUTED / PASS / REVIEWED`, con cero mutaciones durables; SQL/descriptor 003 están ausentes y migration 003 no está materializada. TARGET no es un producto ejecutable completo; `SEC-G01` a `SEC-G10` siguen `PLANNED / NOT_EVALUATED`. |
| Núcleo funcional posterior | No implementado | Las épicas de implementación permanecen principalmente `PLANNED`; algunos trabajos de diseño están `READY`. |
| Capacidades especializadas | Contrato parcial; implementación posterior | Facturación electrónica ya tiene arquitectura neutral y caso de uso, pero no implementación productiva. Domicilios y especializaciones regulatorias permanecen posteriores. |

`DONE` en Fase 0 significa que existe evidencia documental verificable. No significa que la capacidad correspondiente esté implementada como software objetivo.

## Fundación completada en Fase 0

La fundación documental define:

- jerarquía `Platform -> Tenant -> Company -> Branch` y aislamiento multi-tenant;
- identidad global `User`, pertenencia mediante `TenantMembership` y alcance mediante `UserRoleAssignment`;
- autorización RBAC combinada con políticas ABAC, permisos atómicos y segregación de funciones;
- límites y propiedad de datos de los módulos de plataforma y del núcleo comercial;
- catálogo con `Product`, `ProductVariant` y `ProductPresentation`;
- inventario basado en movimientos, reservas, lotes, vencimientos, FEFO/FIFO y compensaciones;
- pricing determinista y versionado, impuestos, redondeo y snapshots históricos;
- ciclos separados para ventas, caja, pagos, refunds, reversals, liquidación y conciliación;
- onboarding de tenant, empresa inicial, sucursal, propietario y configuración mínima;
- identidad y ciclo de vida de dispositivos, licencias, activaciones y derechos verificables;
- operación local-first con outbox, inbox, checkpoints, reintentos, idempotencia y conflictos explícitos;
- auditoría, recuperación, pruebas negativas, invariantes, concurrencia y resiliencia esperada.
- stack objetivo TypeScript/NestJS/Electron/React con PostgreSQL central y SQLite/WAL local;
- POS Local Service como único escritor de SQLite y propietario de hardware, impresión y sincronización;
- infraestructura pagada para staging con datos sensibles, piloto y producción;
- modalidades productivas `HYBRID` y `LOCAL_PERPETUAL` sin dependencia permanente de Internet;
- contrato general de integraciones separado del perfil fiscal, con matriz documental SIIGO/FACTUS/ALEGRA y HKA/Odoo futuros;
- gestión de secretos, firma, soporte temporal y certificación honesta de hardware.

## Principios arquitectónicos

- **Monolito modular y monorepo:** una sola base de código inicial, con módulos propietarios de sus datos y reglas.
- **Multi-tenancy por diseño:** el contexto efectivo se deriva de identidad, pertenencia, sesión y alcance autorizado; no se confía en un `tenant_id` libre enviado por el cliente.
- **Local-first con autoridad explícita:** cada dominio define quién puede confirmar o modificar un dato durante operación conectada u offline.
- **Seguridad en backend:** ocultar controles en la interfaz no constituye autorización; permisos, alcance y contexto se validan nuevamente en el backend.
- **Idempotencia e identidad global:** las operaciones críticas y sus reintentos conservan identidad, checksum, versión y claves idempotentes.
- **Determinismo y snapshots:** precios, impuestos, redondeos y hechos históricos se resuelven con reglas versionadas y evidencia inmutable.
- **Trazabilidad y aislamiento:** ventas, pagos, caja, inventario, sincronización y cambios sensibles conservan actor, tenant, correlación y auditoría.
- **Recuperación sin sobrescritura silenciosa:** movimientos y hechos críticos son append-only; las proyecciones no sustituyen su fuente.
- **Conflictos visibles:** no se usa `last-write-wins` como política genérica ni el reloj local como autoridad global.
- **Runtime físico explícito:** Electron presenta la UI; POS Local Service ejecuta dominio, SQLite, hardware y recuperación.
- **Producción pagada:** recursos gratuitos se limitan a desarrollo, CI, sandbox o demos sin datos reales.
- **Proveedores mediante adaptadores:** Factus, Siigo, datáfonos y hardware no definen entidades del dominio.

Las decisiones normativas están registradas en [docs/adr](docs/adr/).

## Estado de capacidades

| Capacidad | Contrato o diseño | Implementación física objetivo |
|---|---|---|
| Tenancy, empresas, sucursales e identidad global | Definido en Fase 0 | Pendiente |
| RBAC, ABAC, permisos y auditoría | Definido en Fase 0 | Pendiente |
| Catálogo, pricing, promociones e impuestos | Definido en Fase 0 | Pendiente |
| Inventario, ventas, caja y pagos | Casos de uso e invariantes definidos | Pendiente |
| Dispositivos y licenciamiento | Contratos y decisiones definidos | Pendiente |
| Local-first y sincronización | Autoridad, idempotencia, conflictos y recuperación definidos | Pendiente |
| Runtime Electron y servicio local | Stack, procesos, IPC y seguridad definidos | Pendiente |
| Facturación electrónica | Arquitectura neutral y `UC-EINV-001` definidos | Pendiente; sin certificación ni proveedor productivo habilitado |
| Integraciones externas | `ExternalIntegration`, capabilities, mappings, ownership, discovery, dispatch, webhook, rate limits y evidencia materializados en migration 002 | `MAT-002-MATERIALIZATION = PASS`; 16 tablas PostgreSQL centrales, 12 RLS/FORCE, SQLite NONE y dispatch solo `NON_FISCAL`; sin adapters reales/verificados |
| Hardware | Contratos y matriz de certificación definidos | Todos los modelos permanecen `UNTESTED` |
| Infraestructura productiva | Entornos y controles pagados definidos en `DEC-009` | Pendiente de implementación y benchmark |
| CI y validación automática de la arquitectura objetivo | Estrategia definida | Pendiente |
| Domicilios e integraciones especializadas | Alcance previsto o diferido | Pendiente y fuera del primer núcleo |

## Arquitectura documental

| Ruta | Propósito |
|---|---|
| [`docs/product`](docs/product/) | Visión, alcance, roles, requisitos no funcionales y backlog maestro. |
| [`docs/architecture`](docs/architecture/) | Contexto, módulos, tenancy, seguridad, despliegue, propiedad y modelo conceptual de datos. |
| [`docs/adr`](docs/adr/) | Decisiones arquitectónicas y políticas normativas aceptadas. |
| [`docs/domain`](docs/domain/) | Glosario, reglas, eventos, motor comercial y modelos de estado. |
| [`docs/security`](docs/security/) | Permisos, políticas RBAC/ABAC, secretos, claves, soporte controlado y pruebas negativas. |
| [`docs/hardware`](docs/hardware/) | Matriz de equipos, adaptadores, evidencia y certificación. |
| [`docs/testing`](docs/testing/) | Estrategia de pruebas para integridad, seguridad, concurrencia, offline y recuperación. |
| [`docs/migration`](docs/migration/) | Manifests, orden, integridad y estrategia de migrations TARGET. |
| [`docs/use-cases`](docs/use-cases/) | Contratos funcionales, flujos alternos, invariantes y pruebas mínimas por capacidad. |

## Estructura actual del repositorio

```text
pos-platform/
|-- docs/                 # Fuente de verdad documental de POS Platform
|-- poc/                  # Laboratorios aislados de modelo físico y RLS
|-- tools/target-migrations/ # Harness TARGET, migrations 001/002 y tooling MAT-003
|-- package.json          # Comandos del workspace TARGET
|-- pnpm-workspace.yaml   # Workspace limitado actualmente a tools/*
|-- pnpm-lock.yaml        # Dependencias reproducibles del tooling TARGET
|-- tsconfig.base.json    # Configuración TypeScript compartida
|-- .gitattributes        # UTF-8, LF y tratamiento de binarios
`-- .editorconfig         # Convenciones de edición reproducibles
```

`apps/` y `packages/` todavía no existen. Tampoco existen paquetes físicos que materialicen el runtime o los módulos de aplicación de la arquitectura objetivo.

## Stack objetivo aprobado

La selección normativa está cerrada en [`ADR-005`](docs/adr/ADR-005-target-technology-stack.md):

| Capa | Tecnología objetivo | Estado físico |
|---|---|---|
| Lenguaje y monorepo | TypeScript estricto, pnpm workspaces y Nx | Harness pnpm/TypeScript parcial; Nx y monorepo de aplicación pendientes |
| API central | NestJS con Fastify, monolito modular | Pendiente |
| POS productivo | Electron, React y Vite | Pendiente |
| PWA del POS | React/Vite con `IndexedDB`, `sql.js` o SQLite/WASM solo para laboratorio sintético | Prohibida como runtime o persistencia productiva |
| Servicio local | Node.js/TypeScript como servicio de Windows | Pendiente |
| Persistencia | PostgreSQL 16 central y SQLite/WAL local | Migrations 001/002 materializadas, probadas e inmutables; SQLite actual limitado al ledger local; siguientes cortes requieren manifest y autorización aditivos |
| Acceso a datos | Kysely con migraciones separadas por dialecto | Materializado solo en el harness de migrations 001/002; repositorios de aplicación pendientes |
| Contratos | TypeScript y Zod | Pendiente |
| Pruebas | Vitest, Playwright, Testcontainers y k6 | Vitest materializado en el harness de migraciones; resto pendiente |
| Observabilidad | OpenTelemetry | Pendiente |
| Infraestructura | Docker, object storage compatible con S3 y proveedor central pagado | Pendiente |

Las versiones exactas se fijarán mediante manifiestos, lockfile, imágenes y CI al crear el esqueleto. Este cuadro representa decisiones, no una implementación existente.

La persistencia objetivo utiliza un modelo lógico compartido con migraciones físicas separadas por dialecto y Kysely únicamente como executor. Véanse `ADR-005`, `DEC-007`, `docs/migration/first-target-migration-manifest.md`, `docs/migration/second-target-migration-manifest.md` y `docs/migration/third-target-migration-manifest.md`. Migrations 001/002 están `MATERIALIZED / TESTED / IMMUTABLE`; migration 002 limita el dispatch a `NON_FISCAL`. El manifest de `INT-006` conserva nueve tablas fiscales, FK discriminada y habilitación atómica, pero SQL/descriptor 003 continúan ausentes. El tooling ejecutable de `MAT-003-PREFLIGHT` y canonical-role readiness está `MATERIALIZED / REVIEWED`; de forma separada, canonical-role readiness quedó `APPLIED / REVIEWED` y el preflight canónico `EXECUTED / PASS / REVIEWED` en `LOCAL_CANONICAL_INTEGRATION`. La ejecución fue read-only y produjo cero mutaciones durables; ninguna migration implementa adapters ni verifica providers.

El repositorio contiene el harness TARGET pnpm/TypeScript de migrations 001/002, el preflight MAT-003 y el lifecycle de canonical-role readiness. Todavía no contiene el runtime objetivo, `pyproject.toml`, pipeline de CI ni un archivo de licencia.

## Desarrollo local

La arquitectura objetivo de POS Platform aún no puede iniciarse de extremo a extremo. El repositorio permite validar únicamente el tooling TARGET materializado:

```powershell
pnpm typecheck
pnpm test:migrations:sqlite
```

Las pruebas PostgreSQL, preflight, role-readiness y cualquier operación de infraestructura requieren sus propios entornos y autorizaciones. Ninguna de estas capacidades acredita todavía un runtime de aplicación completo.

## Secuencia técnica inmediata

La validación fresca, preparación del ambiente, canonical-role readiness, ejecución/revisión del preflight canónico y revisión externa del checkpoint operacional sanitizado cerraron `PASS`. El checkpoint fue committed como `c255b75eeef0aebc2eb9dfec68eb32072ab88a64` (`docs: checkpoint canonical MAT-003 preflight`) y pushed normalmente; el working tree quedó `CLEAN` y el upstream `0 behind / 0 ahead`.

Context7 fue evaluado como ayuda opcional. Fue configurado externamente con una versión fijada y sin secretos, pero su validación runtime falló durante el handshake. Se determinó que no era necesario para continuar y fue retirado mediante rollback controlado. Un proceso nuevo de Codex sin Context7 terminó correctamente. Los estados finales son `CONTEXT7 = EVALUATED / NOT_REQUIRED / REMOVED` y `CODEX_RUNTIME_WITHOUT_CONTEXT7 = PASS`. Context7 ya no constituye gate, dependencia ni requisito del proyecto. Cuando se requiera información técnica actualizada, se consultarán directamente fuentes oficiales mediante las capacidades disponibles.

La reconciliación documental de Context7 ya forma parte de `cb1dafdc987104a5fdc75034de833df157cbfe67`; su stage, commit y push no son pasos pendientes. El commit `892c3fa9b60ef5150c9a80b5b9c334acdb6b3310` versionó la separación del runtime y la documentación operativa anterior, y `0cb94778adff48aa72e57a2c7fe3c9cffc16dbce` reconcilió su estado documental. La PR #3 fue revisada y fusionada mediante merge normal en `7c5fcbd5fc243efa75b013cd17f5e22ec1be3978`; `architecture/physical-model` ya incorpora la limpieza. La PR #2 es la única ruta autorizable desde `architecture/physical-model` hacia `main`; su estado y HEAD vigentes en GitHub son la evidencia operacional de esa transición.

La secuencia técnica vigente continúa así:

1. revisión independiente del diff completo entre `main` y el HEAD vigente de `architecture/physical-model`;
2. remediación y nueva revisión si aparecen findings;
3. únicamente después de revisión `PASS`, transición de la PR #2 desde `DRAFT` a ready;
4. integración de la PR #2 en `main` únicamente mediante autorización expresa y con el HEAD revisado;
5. verificación posterior del commit integrado, cierre de la PR y relación entre ramas;
6. reanudación separada del contrato SQL 003 sobre el baseline canónico limpio.

En `architecture/physical-model` y en la rama de limpieza, `SQL 003` permanece `ABSENT`, `descriptor 003` permanece `ABSENT`, el ledger entry count para migration 003 permanece en `0`, el fiscal schema permanece `ABSENT` y migration 003 permanece `NOT_MATERIALIZED`. De forma separada, `wip/sql003-contract-gap-20260825` conserva en `dd07f9d429df7b9a2c6dcacaffa39df737cffbbf` planificación y materialización preliminar no canónica, aislada y bloqueada hasta cerrar su contrato y revisión; no está autorizada para merge ni cherry-pick completo. Su existencia no promueve el estado canónico de migration 003. Diseño, remediación, pruebas, revisión y aplicación canónica de SQL 003 conservan gates y autorizaciones separados. `SIIGO`, `FACTUS` y `ALEGRA` permanecen `DESIGNED / NOT_EVALUATED`; `SEC-G01..SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.

## Calidad y seguridad

La estrategia objetivo exige pruebas unitarias, de integración, contrato y extremo a extremo, además de escenarios negativos de permisos, aislamiento entre tenants, concurrencia, reintentos, recuperación y operación offline. Estos son requisitos documentados para la implementación futura; no se presentan como cobertura ya disponible.

Las reglas de seguridad requieren autorización en backend, mínimo privilegio, RBAC/ABAC, segregación de funciones, reautenticación para cambios sensibles, auditoría append-only y aislamiento por tenant, empresa y sucursal. La implementación de este modelo continúa pendiente.

## Documentación principal

- [Visión del producto](docs/product/vision.md)
- [Alcance inicial](docs/product/scope.md)
- [Backlog maestro](docs/product/backlog.md)
- [Requisitos no funcionales](docs/product/non-functional-requirements.md)
- [Contexto del sistema](docs/architecture/system-context.md)
- [Mapa de módulos](docs/architecture/module-map.md)
- [Modelo multiempresa](docs/architecture/tenant-model.md)
- [Modelo conceptual de datos](docs/architecture/conceptual-data-model.md)
- [Modelo de seguridad](docs/architecture/security-model.md)
- [Stack tecnológico objetivo](docs/adr/ADR-005-target-technology-stack.md)
- [Runtime productivo del POS](docs/adr/DEC-010-pos-runtime.md)
- [Línea base operacional](docs/adr/DEC-009-operational-production-baseline.md)
- [Contratos de integración](docs/architecture/integration-contracts.md)
- [Documentos electrónicos](docs/architecture/electronic-invoicing.md)
- [Matriz de hardware](docs/hardware/support-matrix.md)
- [Secretos, claves y soporte](docs/security/secret-key-and-support-management.md)
- [Reglas de negocio](docs/domain/business-rules.md)
- [Matriz de permisos](docs/security/permission-matrix.md)
- [Estrategia de pruebas](docs/testing/testing-strategy.md)

POS Platform está en desarrollo activo. El repositorio no publica todavía una licencia de uso.
