# ADR-005: Stack tecnológico objetivo

## Estado

Aceptado.

## Contexto

El repositorio todavía no materializa el runtime de aplicación. Antes de crear el modelo físico restante y el esqueleto ejecutable es necesario mantener un stack único, multiempresa, local-first, modular y reproducible.

Antes de crear el nuevo modelo físico, las migraciones objetivo y el esqueleto ejecutable es necesario fijar un stack único, mantenible y reproducible. La elección debe soportar:

- POS de escritorio para Windows;
- operación local sin Internet;
- acceso controlado a hardware;
- API central modular;
- panel web;
- contratos compartidos;
- PostgreSQL central y SQLite local;
- procesos asíncronos;
- pruebas por dialecto;
- instaladores y actualizaciones firmadas;
- despliegue portable entre proveedores de infraestructura.

## Decisión

La arquitectura objetivo utilizará TypeScript estricto de extremo a extremo, con Node.js LTS como runtime de los procesos de aplicación.

| Área | Tecnología objetivo | Alcance |
|---|---|---|
| Lenguaje | TypeScript en modo estricto | Aplicaciones y paquetes nuevos |
| Runtime | Node.js LTS | API central, workers y servicio local |
| Gestor de paquetes | pnpm | Instalación reproducible mediante lockfile |
| Monorepo | pnpm workspaces y Nx | Grafo de tareas, caché y límites de dependencia |
| API central | NestJS con adaptador Fastify | Monolito modular y API HTTP |
| POS de escritorio | Electron, React y Vite | Interfaz instalada para operación física |
| Panel del propietario | React y Vite | Aplicación web central; PWA únicamente cuando su alcance no controle hardware ni autoridad local |
| PWA de laboratorio | React y Vite; `IndexedDB`, `sql.js` o SQLite/WASM solo como almacenamiento de prueba | Ensayos con datos sintéticos y descartables; nunca runtime POS ni persistencia productiva |
| Servicio local | Node.js y TypeScript | Dominio local, SQLite, hardware, impresión, sincronización, backup y actualización |
| Contratos | TypeScript y Zod | Validación en runtime y tipos compartidos |
| Persistencia central | PostgreSQL 16 | Autoridad central según `DEC-007` |
| Persistencia local | SQLite en modo WAL | Autoridad operacional de cada nodo local según `DEC-007` |
| Acceso a datos | Kysely | Consultas tipadas y control explícito por dialecto |
| Driver PostgreSQL | `pg` | Conectividad central |
| Driver SQLite | `better-sqlite3` | Acceso local síncrono dentro de un único proceso propietario |
| Pruebas unitarias e integración | Vitest | Dominio, aplicación, contratos y adaptadores |
| Pruebas E2E | Playwright | POS y panel web |
| Bases de integración | Testcontainers | PostgreSQL real y dependencias reproducibles |
| Carga | k6 | Capacidad de API, sincronización y operaciones centrales |
| Observabilidad | OpenTelemetry | Trazas, métricas y correlación sin sustituir auditoría |
| Contenedores | Docker | API, workers, CI y entornos centrales |
| CI | GitHub Actions | Calidad, seguridad, migraciones y artefactos |
| Objetos | API compatible con S3 | XML, PDF, exports y artefactos que no pertenecen a tablas transaccionales |

## Versionado

1. Las versiones exactas se fijarán al crear el esqueleto mediante manifiestos, lockfile e imágenes reproducibles.
2. Node.js deberá permanecer en una línea LTS soportada.
3. No se usarán rangos abiertos ni versiones flotantes en dependencias críticas o imágenes productivas.
4. Las actualizaciones mayores de runtime, framework, Electron, drivers o motor de datos requieren pruebas de migración, compatibilidad y rollback.
5. Una librería sin mantenimiento activo, licencia compatible o procedimiento de actualización no entra al producto.
6. El lockfile es obligatorio y se valida en CI.

## Estructura objetivo del monorepo

```text
apps/
  api/                 API central NestJS
  worker/              procesos asíncronos centrales
  pos-desktop/         proceso principal y renderer Electron
  pos-local-service/   autoridad local, hardware y sincronización
  owner-web/           panel web del propietario
packages/
  domain/              reglas de dominio sin dependencias de framework
  application/         casos de uso y puertos
  contracts/           schemas Zod, errores y contratos versionados
  database-core/       tipos y utilidades compartidas sin ocultar dialectos
  database-postgres/   migraciones y adaptadores PostgreSQL
  database-sqlite/     migraciones y adaptadores SQLite/WAL
  observability/       correlación, métricas y trazas
  testing/             builders y fixtures sintéticos
```

La estructura puede crecer por módulos dentro de estos límites, pero no se crearán repositorios separados por tipo de comercio ni una segunda base de código para `LOCAL_PERPETUAL`.

## Reglas de dependencia

1. `domain` no depende de NestJS, Electron, React, Kysely ni drivers.
2. `application` depende de `domain` y de puertos propios, no de adaptadores concretos.
3. Los adaptadores dependen de los puertos; los casos de uso no dependen de proveedores externos.
4. El renderer de Electron no importa drivers de base de datos, secretos ni librerías de hardware.
5. El panel web no contiene autoridad transaccional local.
6. La API HTTP no contiene reglas de negocio dentro de controladores.
7. PostgreSQL y SQLite comparten contrato lógico cuando corresponda, pero conservan migraciones físicas separadas.
8. Una restricción no expresable de igual forma en ambos dialectos debe probarse en cada adaptador y volver a validarse centralmente conforme a `DEC-007`.
9. Los módulos no acceden directamente a tablas internas de otro módulo.
10. La extracción futura de un módulo a servicio independiente requiere evidencia de carga, aislamiento u operación; no se hará preventivamente.

## Procesos asíncronos

La primera versión no exige un broker externo para confirmar ventas ni para conservar integridad. Utilizará:

- outbox e inbox persistentes;
- workers idempotentes;
- reintentos con backoff;
- dead letter y revisión explícita;
- locks y concurrencia compatibles con cada dialecto.

Un broker podrá añadirse cuando exista una necesidad demostrada. Nunca será requisito para confirmar una venta local.

## Persistencia y migraciones

1. Kysely no convierte un esquema físico en una abstracción indistinta entre dialectos.
2. PostgreSQL y SQLite tendrán migraciones, pruebas y optimizaciones separadas.
3. El dinero no se almacena como `REAL` en SQLite.
4. Las migrations TARGET solo operan sobre sus artifacts, descriptors y ledger aprobados.
5. Cualquier importación de datos desde sistemas externos utiliza jobs, mappings, cuarentena y reconciliación separados del schema migration.

## PWA

Una PWA puede utilizarse para:

- laboratorio de UX;
- simulación de hardware;
- pruebas de contratos;
- panel administrativo central cuando sea apropiado.

Si el laboratorio necesita persistencia en navegador, puede usar `IndexedDB`, `sql.js` o una variante SQLite/WASM exclusivamente con datos sintéticos y descartables. Esa persistencia no implementa autoridad local, recuperación, backup, outbox productivo ni compatibilidad certificada con SQLite del POS Local Service.

Una PWA no será autoridad productiva de SQLite, caja, inventario, impresión, balanza, cajón, outbox, licencias ni actualizaciones del nodo físico.

## Infraestructura

1. Desarrollo, CI y sandbox pueden usar recursos locales, efímeros o gratuitos sin datos reales.
2. Staging, piloto y producción con datos reales usarán infraestructura pagada.
3. La aplicación central será stateless respecto al filesystem del contenedor.
4. PostgreSQL productivo será administrado, pagado, respaldado y monitorizado.
5. Los objetos persistentes se almacenarán fuera del filesystem efímero.
6. El stack no dependerá de APIs propietarias de Render para conservar portabilidad.

## Alternativas descartadas

### Adoptar una implementación previa o externa como arquitectura objetivo

Se descarta porque ninguna implementación ajena a los contratos TARGET acredita los límites modulares, contratos multi-tenant, runtime local, sincronización ni modelo físico ya decididos. Cualquier importación futura debe tratarse como una integración de datos separada y expresamente autorizada.

### PWA como POS físico definitivo

Se descarta porque no ofrece la frontera operativa requerida para SQLite autoritativo, hardware, impresión persistente, servicio de Windows, actualizaciones firmadas y recuperación controlada.

### Microservicios desde el inicio

Se descarta por costo operativo y porque las transacciones del núcleo se benefician del monolito modular. La asincronía necesaria se resuelve inicialmente con outbox, inbox y workers.

### Una sola migración para PostgreSQL y SQLite

Se descarta porque produciría equivalencias falsas entre dialectos y ocultaría restricciones, tipos, locks e índices diferentes.

## Consecuencias

- `TECH-002` diseñará las migraciones objetivo con Kysely y suites separadas por dialecto.
- `DEC-010` cierra la topología exacta de procesos Electron y servicio local.
- `ARCH-004` define los contratos entre procesos y adaptadores.
- `docs/testing/testing-strategy.md` define exclusivamente suites y gates de la arquitectura objetivo.
- Una implementación externa o anterior nunca se adopta como TARGET por copia, rename o compatibilidad aparente.
- Ninguna parte de este ADR afirma que el stack objetivo ya esté implementado.

## Criterios de aceptación

La decisión se considera aplicable cuando:

1. backlog, README y estrategia de pruebas distinguen contratos TARGET de cualquier implementación externa;
2. el nuevo esqueleto usa TypeScript estricto, pnpm y Nx;
3. existen límites verificables entre dominio, aplicación y adaptadores;
4. PostgreSQL y SQLite tienen migraciones y pruebas separadas;
5. Electron renderer no accede directamente a base de datos ni hardware;
6. CI valida lockfile, tipos, lint, pruebas, migraciones, dependencias y licencias;
7. los artefactos centrales pueden desplegarse en contenedores sin filesystem persistente local;
8. ninguna configuración gratuita se presenta como producción.
