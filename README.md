# POS Platform

Plataforma POS modular, multi-tenant y local-first orientada a operaciones comerciales reales.

POS Platform busca proporcionar un núcleo comercial reutilizable para distintos tipos de negocio, con límites de dominio explícitos, operación por empresa y sucursal, seguridad contextual y continuidad operativa ante interrupciones de conectividad.

> **Estado actual:** el proyecto está en desarrollo. La Fase 0 de fundación de producto, arquitectura y dominio está cerrada como trabajo documental. La siguiente etapa es la Fase 1, fundación técnica ejecutable. La arquitectura objetivo todavía no está implementada y el sistema no debe considerarse terminado ni listo para producción.

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

Estas capacidades forman parte del alcance y de los contratos documentales en distintos niveles de madurez. No equivalen a módulos físicos terminados. El código ejecutable presente corresponde a una línea base heredada que se auditará y migrará de forma incremental.

## Estado del proyecto

El [backlog maestro](docs/product/backlog.md) es la fuente de verdad para estados, prioridades, dependencias y evidencia.

| Etapa | Estado en el backlog | Alcance real |
|---|---|---|
| Fase 0 — Fundación de producto, arquitectura y dominio | `DONE` | Visión, alcance, arquitectura, ADR, modelo conceptual, reglas, seguridad, estrategia de pruebas, migración y casos de uso críticos documentados. |
| Fase 1 — Fundación técnica ejecutable | `PLANNED` | Esqueleto modular, modelo físico, migraciones, seguridad, CI, primer corte vertical y base local-first pendientes de implementación. `TECH-002` está `READY` como entrada de la fase. |
| Núcleo funcional posterior | No implementado | Las épicas de implementación permanecen principalmente `PLANNED`; algunos trabajos de diseño están `READY`. |
| Capacidades especializadas | `DEFERRED` o fuera del primer núcleo | Domicilios, facturación electrónica, integraciones fiscales avanzadas y especialización regulatoria, entre otras. |

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

Las decisiones normativas están registradas en [docs/adr](docs/adr/).

## Estado de capacidades

| Capacidad | Contrato o diseño | Implementación física objetivo |
|---|---|---|
| Tenancy, empresas, sucursales e identidad global | Definido en Fase 0 | Pendiente |
| RBAC, ABAC, permisos y auditoría | Definido en Fase 0 | Pendiente; el legado solo contiene roles simples |
| Catálogo, pricing, promociones e impuestos | Definido en Fase 0 | Pendiente; existe una implementación heredada no equivalente |
| Inventario, ventas, caja y pagos | Casos de uso e invariantes definidos | Pendiente; existe una implementación heredada monoempresa |
| Dispositivos y licenciamiento | Contratos y decisiones definidos | Pendiente |
| Local-first y sincronización | Autoridad, idempotencia, conflictos y recuperación definidos | Pendiente |
| CI y validación automática de la arquitectura objetivo | Estrategia definida | Pendiente |
| Domicilios e integraciones especializadas | Alcance previsto o diferido | Pendiente y fuera del primer núcleo |

## Arquitectura documental

| Ruta | Propósito |
|---|---|
| [`docs/product`](docs/product/) | Visión, alcance, roles, requisitos no funcionales y backlog maestro. |
| [`docs/architecture`](docs/architecture/) | Contexto, módulos, tenancy, seguridad, despliegue, propiedad y modelo conceptual de datos. |
| [`docs/adr`](docs/adr/) | Decisiones arquitectónicas y políticas normativas aceptadas. |
| [`docs/domain`](docs/domain/) | Glosario, reglas, eventos, motor comercial y modelos de estado. |
| [`docs/security`](docs/security/) | Matriz de permisos, políticas RBAC/ABAC y pruebas negativas esperadas. |
| [`docs/testing`](docs/testing/) | Estrategia de pruebas para integridad, seguridad, concurrencia, offline y recuperación. |
| [`docs/migration`](docs/migration/) | Clasificación y estrategia para migrar la línea base heredada. |
| [`docs/use-cases`](docs/use-cases/) | Contratos funcionales, flujos alternos, invariantes y pruebas mínimas por capacidad. |

## Estructura actual del repositorio

```text
pos-platform/
|-- backend/              # API, modelos, schemas, migración y tests del legado
|-- database/seeds/       # Datos de demostración heredados
|-- docs/                 # Fundación documental de POS Platform y documentación histórica
|-- frontend/             # Frontend multipágina heredado
|-- infra/                # Docker Compose de la línea base actual
|-- .env.example          # Variables del entorno heredado
|-- Dockerfile            # Imagen integrada actual
|-- render.yaml           # Blueprint de despliegue heredado
|-- iniciar.bat           # Inicio local de la línea base en Windows
`-- detener.bat           # Detención local en Windows
```

No existen todavía paquetes físicos separados que materialicen los módulos de la arquitectura objetivo.

## Stack técnico verificado

El stack siguiente describe lo que está físicamente presente, no una selección definitiva para toda la arquitectura objetivo.

| Capa | Tecnología verificada | Situación |
|---|---|---|
| Backend | Python 3.12 en las imágenes, FastAPI, Uvicorn, SQLAlchemy 2, Pydantic 2 y Alembic | Línea base heredada |
| Persistencia | PostgreSQL 16 en Docker Compose; SQLite en memoria para tests | Línea base heredada |
| Seguridad | JWT con `python-jose`, bcrypt y roles simples por endpoint | Línea base heredada; no implementa aún el modelo RBAC/ABAC objetivo |
| Frontend | HTML, CSS, JavaScript y Bootstrap 5 cargado por CDN | Línea base heredada prevista para reemplazo |
| Infraestructura | Docker, Docker Compose y Render Blueprint | Configuración heredada; no acredita un despliegue objetivo |
| Pruebas presentes | Pytest, HTTPX y `TestClient` | Suite del legado, no cobertura de la arquitectura objetivo |

El repositorio no contiene actualmente `package.json`, `pyproject.toml`, pipeline de CI ni un archivo de licencia.

## Desarrollo local

La arquitectura objetivo de POS Platform aún no puede iniciarse de extremo a extremo. Los siguientes comandos levantan y prueban únicamente la línea base heredada.

### Línea base con Docker Compose

En PowerShell:

```powershell
Copy-Item .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

En Windows también existen los scripts:

```powershell
.\iniciar.bat
.\detener.bat
```

La configuración actual expone la aplicación y la documentación OpenAPI en `http://localhost:8000` y `http://localhost:8000/docs`. Sus variables, datos de demostración e identidad visual todavía pertenecen al legado y no deben trasladarse sin revisión al modelo objetivo.

### Tests existentes

```powershell
Set-Location backend
python -m pytest tests -q
```

La suite heredada fue ejecutada durante la auditoría de este README: 27 pruebas pasaron, con advertencias de deprecación de la dependencia JWT. Este resultado no valida multi-tenancy, RBAC/ABAC, licenciamiento, sincronización ni operación local-first.

## Roadmap inmediato

La Fase 1 debe convertir los contratos documentales en una fundación ejecutable:

1. crear el esqueleto modular y reglas verificables de dependencia;
2. diseñar e implementar el modelo físico nuevo sin reescribir silenciosamente la migración heredada;
3. añadir migraciones, restricciones, índices y fronteras transaccionales;
4. implementar aislamiento multi-tenant, identidad, sesiones revocables y autorización backend;
5. establecer CI con lint, tipos, pruebas, seguridad y validación de migraciones;
6. entregar un primer corte vertical autenticado, auditable e idempotente;
7. demostrar la base local-first con identificadores globales, outbox, reintentos y recuperación sin duplicación.

El detalle y las dependencias se mantienen en [docs/product/backlog.md](docs/product/backlog.md).

## Calidad y seguridad

La estrategia objetivo exige pruebas unitarias, de integración, contrato y extremo a extremo, además de escenarios negativos de permisos, aislamiento entre tenants, concurrencia, reintentos, recuperación y operación offline. Estos son requisitos documentados para la implementación futura; no se presentan como cobertura ya disponible.

Las reglas de seguridad requieren autorización en backend, mínimo privilegio, RBAC/ABAC, segregación de funciones, reautenticación para cambios sensibles, auditoría append-only y aislamiento por tenant, empresa y sucursal. La implementación heredada no satisface todavía este modelo completo.

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
- [Reglas de negocio](docs/domain/business-rules.md)
- [Matriz de permisos](docs/security/permission-matrix.md)
- [Estrategia de pruebas](docs/testing/testing-strategy.md)
- [Estrategia de migración de la línea base](docs/migration/avicola-baseline-migration.md)

POS Platform está en desarrollo activo. El repositorio no publica todavía una licencia de uso.
