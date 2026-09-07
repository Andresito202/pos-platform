# Auditoría de conformidad con el stack objetivo

## Qué es esto y por qué existe

El propietario mantiene una lámina impresa —**STACK OBJETIVO DEFINIDO**,
ADR-005 / DEC-010— con el stack al que apunta el proyecto. Este documento
contrasta **punto por punto** esa lámina contra el árbol real de `main`, con el
comando que lo comprueba.

No sustituye al [tablero](./tablero-materializacion.md). El tablero mide
**capacidades del producto**; esto mide **conformidad con el stack técnico
elegido**. Son dos preguntas distintas: se puede tener un stack completo y un
producto vacío, y al revés.

La regla que la propia lámina imprime al pie se aplica aquí sin excepción:

> **Documentado no significa implementado. Compilar no significa seguro. Sin
> pruebas y evidencia no hay PASS.**

## Cómo se puntúa

| Marca | Valor | Significa |
|---|---:|---|
| ✅ | 2 | existe en `main` y hay comando que lo comprueba |
| ⚠️ | 1 | existe una parte, y la fila dice cuál falta |
| ❌ | 0 | **cero**: no existe ni declarado ni implementado |

`❌` aquí no es «pendiente»: es que el barrido devolvió cero resultados.

## Evidencia de partida

**Inventario completo de dependencias externas del monorepo — 22 paquetes:**

```
@playwright/test  @testing-library/react  @types/better-sqlite3  @types/node
@types/pg  @types/react  @types/react-dom  @vitejs/plugin-react
better-sqlite3  electron  jsdom  kysely  nx  pg  playwright  react
react-dom  tsx  typescript  vite  vitest  zod
```

Todo lo que la lámina nombra y no está en esa lista **no existe en el proyecto**.
Eso descarta de entrada: NestJS, Fastify, Testcontainers, k6, OpenTelemetry,
cualquier linter, `electron-builder` y cualquier cliente de object storage.

---

## Resultado por sección

### POS de escritorio — 100 % (10/10)

| Punto | | Evidencia |
|---|:-:|---|
| Electron | ✅ | `electron@44.1.1`, `apps/pos-desktop/src/main.ts` |
| React + Vite | ✅ | `react@19.1.0`, `vite@6.4.3`, `apps/pos-desktop/renderer/` |
| TypeScript strict | ✅ | `tsconfig.base.json`, `pnpm typecheck` PASS |
| preload allowlisted | ✅ | `src/ipc-allowlist.ts` + prueba de lista exacta |
| renderer aislado | ✅ | `src/window-security.ts` |

**El stack está completo y la aplicación está casi vacía, y son dos hechos
distintos.** El renderer entero son **107 líneas** —`App.tsx` 12,
`OperationPanel.tsx` 72, `StatusPanel.tsx` 17— y expone **tres** llamadas:
`runtime.status.get`, `operation.result.get` y `operation.confirm`.

Un barrido de `sale`, `payment`, `cash` y `customer` sobre
`apps/pos-desktop/renderer/src` devuelve **ninguna mención**. Las trece
operaciones comerciales tienen contrato, handler y prueba de extremo a extremo
contra el canal, y **ninguna llega a una pantalla**.

### PWA — 0 % (0/2)

❌ No existe. Sin `manifest.webmanifest`, sin service worker, sin aplicación
separada. La lámina la describe como panel central o laboratorio con datos
sintéticos; no hay nada de eso.

### Backend central — 0 % (0/10)

| Punto | | Evidencia |
|---|:-:|---|
| Node.js LTS | ❌ | no hay aplicación central que ejecutar |
| NestJS + Fastify | ❌ | **cero declaraciones y cero importaciones** |
| TypeScript strict | ❌ | sin código que comprobar |
| Monolito modular | ❌ | `packages/database-postgres/src` está **vacío** |
| Workers idempotentes | ❌ | cero |

Es la sección más grande sin materializar y la que bloquea el bloque D del
tablero. Coincide con la deuda `D-4`.

### Servicio local POS — 64 % (9/14)

| Punto | | Evidencia |
|---|:-:|---|
| Windows Service | ⚠️ | `main.ts` exige Windows y CI valida en `windows-2022`, pero **no hay host de servicio instalable** (ni `nssm`, ni `winsw`, ni unidad de servicio) |
| Node.js + TypeScript | ✅ | `apps/pos-local-service/` |
| Único escritor de SQLite | ✅ | lock de escritor único en `local-database.ts` |
| Dominio y casos de uso locales | ✅ | `src/{sales,cash,payments,customers,session,authorization}/` |
| Hardware e impresión | ❌ | **cero** |
| Sincronización y recuperación | ⚠️ | outbox, checkpoint y dead-letter existen y se prueban; **no hay cliente HTTP saliente** (`D-2`) |
| Backup y actualización | ⚠️ | backup y restauración existen y CI los valida en Windows; **actualización no existe** |

### Datos — 83 % (15/18)

| Punto | | Evidencia |
|---|:-:|---|
| PostgreSQL 16 administrado | ⚠️ | migraciones 001–003 probadas en CI contra PostgreSQL **16.14** real; **ninguna instancia desplegada** |
| RLS tenant-aware | ✅ | en las migraciones, con verificación en CI |
| Kysely + pg | ✅ | `tools/target-migrations/src/database.ts` |
| SQLite/WAL | ✅ | `local-database.ts` |
| Kysely + better-sqlite3 | ✅ | mismo archivo |
| SyncOperation · Outbox · Checkpoint | ✅ | `durable-sync-store.ts` · `MIGRATION_004` |
| Inbox central en PostgreSQL | ❌ | no hay central |

### Arquitectura — 89 % (16/18)

| Punto | | Evidencia |
|---|:-:|---|
| Monolito modular | ✅ | 13 proyectos, boundaries verificados en CI |
| Clean Architecture | ⚠️ | `DEC-017` congeló `domain`/`application` a autorización y sesión; **las reglas de negocio viven en el runtime**, no en una capa de dominio |
| Puertos y adaptadores | ✅ | `packages/fiscal-adapters/src/ports/` |
| Domain / Application / Infrastructure | ⚠️ | las tres carpetas existen; la separación no se sostiene fuera de autorización |
| Multi-tenant · Multi-company | ✅ | clave compuesta por tenant en todas las tablas |
| Local-first | ✅ | SQLite es autoridad hasta sincronizar |
| Ownership por dominio | ✅ | `module-boundaries.json` con `frozenSourceAreas` |
| Sin microservicios prematuros | ✅ | ninguno |

### Monorepo y contratos — 90 % (9/10)

Todo ✅ salvo **contratos API/IPC versionados** ⚠️: el IPC está versionado y
probado (225 pruebas de contrato); **no existe contrato de API** porque no
existe API.

### Infraestructura — 21 % (3/14)

| Punto | | Evidencia |
|---|:-:|---|
| Docker | ❌ | **ningún `Dockerfile` ni `docker-compose` en el repositorio** |
| GitHub Actions | ✅ | tres workflows |
| PostgreSQL administrado | ❌ | no desplegado |
| Object Storage S3 | ❌ | cero |
| Workers | ❌ | cero |
| Backups y restauración | ⚠️ | local sí y probado; central no |
| Infraestructura portable | ❌ | sin IaC de ningún tipo |

### Calidad — 61 % (11/18)

| Punto | | Evidencia |
|---|:-:|---|
| Vitest | ✅ | 915 pruebas |
| Playwright | ⚠️ | declarado y con `playwright.config.ts`; **cero ficheros `.spec.ts`** |
| Testcontainers | ❌ | **cero**. CI usa *service containers* de GitHub, que no es lo mismo |
| k6 | ❌ | **cero**. No hay prueba de carga de ningún tipo |
| Lint | ❌ | **no hay linter en el monorepo**: ni ESLint, ni Biome, ni oxlint, ni script `lint` |
| Typecheck | ✅ | `pnpm typecheck` PASS en 13 proyectos |
| Pruebas PostgreSQL | ✅ | contra 16.14 en CI |
| Pruebas SQLite/WAL | ✅ | `test:migrations:sqlite` + runtime |
| Pruebas cross-tenant | ✅ | en `sale`, `payment`, `master-snapshot`, `sync-contracts`, `authorization` |

**La ausencia de linter es la más sorprendente de la lámina**, porque es la más
barata de corregir y la única que no depende de ningún bloque anterior.

### Observabilidad — 60 % (6/10)

| Punto | | Evidencia |
|---|:-:|---|
| OpenTelemetry | ❌ | **cero**, ni dependencia ni importación |
| Logs estructurados | ✅ | `packages/observability/` |
| Métricas y trazas | ❌ | cero |
| Correlation ID | ✅ | en todo el canal, el outbox y la auditoría |
| Audit separado de logs | ✅ | `local_operation_audit` append-only con triggers |

### Hardware — 0 % (0/16)

Báscula, lector, impresora, cajón, datáfono, pantalla cliente, integración por
puertos y adaptadores, y modelos certificados: **los ocho en cero**.

Es coherente con lo que la propia lámina anota —«modelos comerciales aún no
certificados»— pero conviene decirlo entero: **no existe ni la abstracción**.

### Seguridad — 68 % (15/22)

| Punto | | Evidencia |
|---|:-:|---|
| `SEC-G01..SEC-G10` | ❌ | `PLANNED / NOT_EVALUATED`, tal como la lámina declara |
| PoC PostgreSQL RLS 30/30 | ✅ | en las migraciones, verificado en CI |
| FK tenant-aware + RLS | ✅ | idem |
| Autenticación y sesión revocable | ✅ | SSA firmada, `MIGRATION_007` |
| RBAC + ABAC | ⚠️ | **RBAC sí; ABAC cero.** Ver abajo |
| MFA y reautenticación | ❌ | **cero** |
| Device trust y licencias firmadas | ⚠️ | materializado y probado; **`main.ts` no lo instancia** |
| Idempotencia y replay protection | ✅ | `runtime_operations`, checksum de payload |
| Auditoría append-only | ✅ | triggers que rechazan UPDATE y DELETE |
| Gestión de secretos y claves | ⚠️ | DPAPI materializado; **no conectado al runtime** |
| Security release gate fail-closed | ✅ | auditoría de vulnerabilidades fail-closed en CI |

---

## Administración, roles y super-administrador — 20 % (4/20)

Esta sección no está en la lámina y la añade el propietario. Es la que peor sale
y conviene no suavizarla.

### Lo documentado

`docs/security/permission-matrix.md` declara **14 roles** y **126 permisos
atómicos**:

```
PLATFORM_OWNER  BILLING_ADMIN  SUPPORT_AGENT  SECURITY_ADMIN
OWNER  GENERAL_ADMIN  BRANCH_MANAGER  SUPERVISOR  CASHIER
INVENTORY_OPERATOR  PURCHASING_OPERATOR  PREPARATION_OPERATOR
COURIER  CUSTOMER
```

`PLATFORM_OWNER` es el super-administrador: crear tenant, crear empresa,
activar y suspender licencia, revocar dispositivo, crear acceso temporal de
soporte.

### Lo implementado

| Capacidad | | Evidencia |
|---|:-:|---|
| Motor de permisos RBAC | ✅ | `packages/domain/src/authorization/decision.ts`, falla cerrado, 5 condiciones |
| Snapshot de autorización firmado y revocable | ✅ | `MIGRATION_006`, verificación de firma |
| Catálogo de roles como entidad | ❌ | **no hay tabla de roles.** El barrido de `role_name`, `role_code`, `roles_` y `CREATE TABLE *role*` devuelve cero |
| Asignar o revocar un rol | ❌ | cero casos de uso |
| Alta de tenant, empresa o sucursal | ❌ | cero |
| Alta y gestión de usuarios | ❌ | cero |
| Panel de administración (interfaz) | ❌ | cero |
| Panel de super-administrador | ❌ | cero |
| Licencias: activar, suspender, cambiar plan | ❌ | cero |
| ABAC | ❌ | **cero.** El barrido de `ABAC`, `attributeCondition`, `riskLevel` y `reauthenticat` no devuelve una sola línea |

### Los tres hechos que hay que entender

**1. Sólo hay 10 permisos implementados de 126 documentados.**

```
CASH_SHIFT_OPEN  CASH_SHIFT_CLOSE  SALES_SALE_CREATE
PAYMENTS_PAYMENT_REGISTER  PAYMENTS_PAYMENT_CANCEL  PAYMENTS_PAYMENT_READ
PAYMENTS_TRANSFER_REPORT  PAYMENTS_TRANSFER_CONFIRM
CUSTOMERS_CUSTOMER_REGISTER  CUSTOMERS_CUSTOMER_READ
```

**Los diez son de caja, venta, pago y cliente. Ninguno es de administración.**

**2. Los roles no existen como dato: viajan dentro de un blob firmado.**

El motor no consulta roles: recibe `RoleAssignment[]` que salen de
`claims_json`, un JSON firmado que emite la plataforma central. **La plataforma
central no existe.** Hoy el snapshot sólo lo produce el arnés de pruebas.

Consecuencia práctica: **no hay forma de dar de alta un usuario ni de asignarle
un rol desde el producto.** Ni el super-administrador puede.

**3. La matriz exige ABAC de forma explícita y no hay ninguno.**

Cita literal de `permission-matrix.md` §Operaciones financieras:

> «Cada celda exige el permiso atómico correspondiente y evaluación ABAC de
> tenant, company, branch, **importe**, estado, fuente, sesión, dispositivo y
> **riesgo**. `Reforzado` incluye motivo y auditoría append-only y puede exigir
> **reautenticación**, **MFA** y segregación de funciones según política.»

Nada de importe, riesgo, reautenticación ni MFA está implementado. Hoy, quien
tenga `PAYMENTS_PAYMENT_CANCEL` puede anular **cualquier** importe sin segundo
factor y sin motivo. Es la brecha de seguridad más grande entre lo documentado y
lo construido.

---

## Totales

| Sección | Puntos | % |
|---|---:|---:|
| POS de escritorio | 10/10 | **100 %** |
| Monorepo y contratos | 9/10 | **90 %** |
| Arquitectura | 16/18 | **89 %** |
| Datos | 15/18 | **83 %** |
| Seguridad | 15/22 | **68 %** |
| Servicio local POS | 9/14 | **64 %** |
| Calidad | 11/18 | **61 %** |
| Observabilidad | 6/10 | **60 %** |
| Infraestructura | 3/14 | **21 %** |
| Administración y roles | 4/20 | **20 %** |
| PWA | 0/2 | **0 %** |
| Backend central | 0/10 | **0 %** |
| Hardware | 0/16 | **0 %** |
| **CONFORMIDAD GLOBAL** | **98/182** | **54 %** |

91 puntos de stack evaluados. Media simple sobre puntos, no sobre secciones:
ponderar por sección haría que la PWA —un punto— pesara igual que Seguridad
—once—.

## Qué cambiar y por qué

En orden de coste creciente, y sólo lo que **no depende** de un bloque que aún
no existe:

1. **Un linter.** Cero dependencias previas, corrige la única fila de Calidad
   que no espera a nadie.
2. **Especificaciones Playwright.** La configuración ya está; faltan los
   ficheros. Cubriría de paso que la interfaz no llega a lo comercial.
3. **Conectar lo que ya está probado y desconectado**: ciclo de seguridad local
   y adquisición de snapshot. `main.ts` instancia cinco componentes y ninguno es
   ésos. Sube dos filas de Seguridad sin escribir lógica nueva.
4. **Pantallas comerciales.** Trece operaciones con handler y prueba, y ninguna
   con interfaz. Es el mayor desfase entre lo construido y lo usable.
5. **Cliente HTTP saliente** (`D-2`). Desbloquea la mitad de Datos y de
   Servicio local.
6. **Backend central.** El bloque más grande, y del que dependen administración,
   roles, licencias y el inbox.

## Historial

| Fecha | Conformidad | Qué movió |
|---|---:|---|
| 2026-09-07 | **54 %** | primera auditoría; línea base sobre `3f01c02` |
