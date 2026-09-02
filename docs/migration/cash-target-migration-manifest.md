# CASH — manifiesto exacto de materialización física

## 1. Estado, autoridad y límite

Estado: `CASH-MANIFEST-V1 / MANIFEST-ONLY / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Este documento es el contrato de alcance para la futura materialización física del bounded context `Cash Register / Cash`. No contiene DDL, SQL, código Kysely, migration runner, seeds, adapters, credenciales ni cambios de runtime. Su existencia no autoriza ejecutar una migration ni cambia `GO_AUTHORIZED`.

El manifest se redacta después de `CASH CROSS-FUNCTIONAL REVIEW: PASS` del Bloque 10. El único MAJOR detectado en esa revisión fue la autorización ausente de `CloseCashShiftUseCase`; quedó corregido y probado antes de este documento.

La autoridad funcional y física permanece en las fuentes normativas existentes. Este manifest no las reemplaza:

- `docs/architecture/physical-model/cash-counting-schema.md` — contrato físico de Cash;
- `docs/architecture/physical-model/physical-conventions.md` — convenciones PostgreSQL/SQLite;
- `docs/architecture/physical-model/traceability.md` — admisión y trazabilidad física;
- `docs/security/permission-matrix.md` — autorización por rol;
- `docs/use-cases/cash/UC-CASH-001-open-register.md`;
- `docs/use-cases/cash/UC-CASH-002-close-register.md`;
- `docs/use-cases/cash/UC-CASH-003-cash-operations.md`;
- `docs/architecture/data-ownership.md`;
- `docs/adr/DEC-002-payment-compensation-policy.md`;
- `docs/adr/DEC-007-local-first-data-authority.md`.

Reglas de interpretación:

`DOCUMENTED != IMPLEMENTED`, `PASS != DDL AUTHORIZATION`, `MANIFEST != SQL`, `IMPLEMENTED != MATERIALIZED`, `MATERIALIZED != PRODUCTION_READY`.

## 2. Corte exacto

La futura materialización de Cash se limita al bounded context propietario de caja. No debe incorporar tablas, columnas o constraints pertenecientes a Catalog, Inventory, Sales, Payments, Fiscal/Electronic Invoicing, Authentication/Identity, Devices/Licensing, Sync o Audit como sustitutos de sus owners.

Cash puede referenciar contratos de otros bounded contexts mediante sus claves y fronteras aprobadas, pero no adquiere ownership de sus tablas.

No se define aquí un número de migration. La secuencia de migrations es una decisión de gobernanza posterior y debe respetar las migrations 001/002/003 ya existentes e inmutables.

## 3. Objetos físicos incluidos

### 3.1 Schema

| Object | Owner | Included | Decision |
|---|---|---:|---|
| `cash` | Cash Register | Sí | único schema físico propio de Cash |

El nombre lógico y físico de las tablas puede seguir la convención vigente del contrato físico (`cash.<table>` / `cash_<table>` según dialecto). La elección concreta de naming por dialecto pertenece a la materialización y no puede alterar semántica ni ownership.

### 3.2 Tablas

| Order | Table | Purpose | Authority | Tenant scoped | Included |
|---:|---|---|---|---:|---:|
| 1 | `cash_registers` | identidad y configuración de caja física | central master replicada | Sí | Sí |
| 2 | `cash_shifts` | ciclo de apertura/cierre del turno | local authoritative synced | Sí | Sí |
| 3 | `cash_movements` | hechos financieros de efectivo | local authoritative synced | Sí | Sí |
| 4 | `cash_counts` | evidencia de arqueos | local authoritative synced | Sí | Sí |
| 5 | `cash_count_denominations` | desglose inmutable del conteo | local authoritative synced | Sí | Sí |
| 6 | `cash_difference_reviews` | tratamiento de diferencias | dual con política explícita | Sí | Sí |
| 7 | `cash_difference_review_actions` | historial append-only de decisiones | misma autoridad que Review | Sí | Sí |

`ExpectedCash` no es una tabla ni un importe mutable: es un cálculo derivado de movimientos `POSTED` hasta un corte explícito. No se materializa como segunda autoridad.

No se incluyen tablas auxiliares genéricas de permisos, auditoría, outbox, sync, users, memberships, devices, licensing ni configuración de dominio que pertenezcan a otros owners.

## 4. Dependencias y fronteras

### 4.1 Dependencias externas consumidas

Cash requiere, según el contrato vigente, referencias a:

- Tenant;
- Company;
- Branch;
- Device/installation cuando corresponda;
- actor/identity cuando corresponda;
- autorización y asignaciones de rol;
- Audit;
- Outbox/Sync para la entrega de hechos.

Estas dependencias no se recrean dentro de Cash.

### 4.2 Regla de ownership

Cash no escribe directamente tablas internas de otro módulo. Toda relación física hacia otro owner debe respetar las candidate keys y scopes definidos por el modelo físico central. Una FK no transfiere ownership.

## 5. Identidad, scope y aislamiento

Toda fila tenant-scoped debe conservar `tenant_id`, y las relaciones con Company, Branch, CashRegister y CashShift deben impedir combinaciones cross-tenant y cross-branch.

Las relaciones relevantes deben usar claves compuestas o candidate keys que preserven el scope contractual; no se aceptan UUID libres que permitan asociar un recurso de otro tenant o sucursal.

PostgreSQL debe aplicar RLS cuando corresponda. SQLite debe preservar la misma semántica mediante el único escritor local y las transacciones definidas por las convenciones físicas.

El ID enviado por el cliente nunca constituye autoridad de scope por sí solo.

## 6. CashRegister

`cash_registers` materializa la identidad de la caja y su configuración mínima.

Contrato relevante:

- `id` UUID v7;
- `tenant_id`, `company_id`, `branch_id`;
- `code`, `code_normalized`, `name`;
- `currency_code`;
- `status` (`ACTIVE` / `RETIRED`);
- `created_at`, `retired_at`;
- `version`.

Invariantes físicas:

- pertenencia inequívoca a Branch;
- `UNIQUE (tenant_id, company_id, branch_id, code_normalized)`;
- no delete en cascada que destruya historia financiera;
- currency inmutable mientras existan turnos asociados.

## 7. CashShift

`cash_shifts` materializa el ciclo operativo `OPEN -> CLOSING -> CLOSED`.

Debe conservar las identidades de scope, caja, dispositivo y actor, además de apertura/cierre, business date, timezone, moneda, idempotencia, checksum, secuencia y versionamiento definidos por el contrato físico.

Invariantes no negociables:

1. exactamente un `OPENING_FLOAT` `POSTED` por turno;
2. no más de un turno incompatible por tenant, branch, cash register y device según la regla de UC-CASH-001;
3. `OPEN -> CLOSING -> CLOSED` como secuencia normal;
4. un turno `CLOSED` es inmutable;
5. `expected_version`/`version` protege cada mutación;
6. apertura y cierre tienen idempotency key y request checksum independientes;
7. un cierre exitoso tiene exactamente un `CashCount` de tipo `CLOSING` completado.

La protección contra concurrencia no puede depender solo de un pre-check de aplicación.

## 8. CashMovement

`cash_movements` materializa hechos de efectivo y sus transiciones.

Tipos respaldados por el contrato actual:

`OPENING_FLOAT`, `CASH_SALE`, `CASH_PAYMENT`, `CHANGE_GIVEN`, `CASH_REFUND`, `CASH_REVERSAL_COMPENSATION`, `CASH_WITHDRAWAL`, `CASH_DEPOSIT`, `COURIER_COLLECTION`, `CASH_EXPENSE`, `CASH_ADJUSTMENT_POSITIVE`, `CASH_ADJUSTMENT_NEGATIVE`, `TRANSFER_TO_SAFE`, `TRANSFER_FROM_SAFE`, `CLOSING_TRANSFER`, `OTHER_AUTHORIZED`.

Estados respaldados:

`CREATED`, `PENDING_APPROVAL`, `APPROVED`, `POSTED`, `REJECTED`, `FAILED`, `CANCELLED`.

Invariantes:

- `amount > 0`; dirección expresa `IN`/`OUT`;
- moneda igual a CashShift/CashRegister;
- `UNIQUE (tenant_id, cash_shift_id, shift_sequence)`;
- `UNIQUE (tenant_id, origin_device_id, idempotency_key)`;
- un movimiento `POSTED` no se edita ni elimina;
- compensaciones referencian el movimiento original y nunca lo sobrescriben;
- solo movimientos `POSTED` participan en ExpectedCash;
- las transiciones requieren autorización, versionado, auditoría y outbox cuando el contrato lo exige.

Todos los importes usan precisión lógica `(19,6)`. PostgreSQL usa `numeric(19,6)`; SQLite conserva decimal canónico como texto conforme a `physical-conventions.md`. No se usa `REAL` ni `number` JavaScript como autoridad monetaria.

## 9. CashCount y denominaciones

`cash_counts` es un agregado independiente. Permite múltiples arqueos parciales y conserva la evidencia de corte, esperado, contado, diferencia, política y checksum del cálculo.

`cash_count_denominations` conserva el desglose inmutable cuando se utiliza.

Invariantes:

- denominaciones suman exactamente `counted_amount` cuando se proporcionan;
- un cierre tiene un único conteo `CLOSING` `COMPLETED`;
- el conteo conserva el corte de movimientos y la versión de cálculo utilizada;
- la evidencia histórica no se sobrescribe destructivamente.

## 10. CashDifferenceReview

`cash_difference_reviews` y `cash_difference_review_actions` materializan el tratamiento explícito de diferencias.

Una diferencia no genera automáticamente un movimiento financiero. El review conserva la decisión y sus acciones append-only.

Cuando la política vigente exige autorización adicional, segregación de funciones, motivo o auditoría, la persistencia debe conservar la evidencia suficiente para reproducir la decisión.

No se inventa en este manifest una `CashPolicyVersion` inexistente en el runtime actual. Si una futura materialización exige versionado de política, debe existir primero un contrato normativo explícito; no se crea una autoridad implícita durante DDL.

## 11. Autorización

La autorización de Cash es una precondición de aplicación y no se sustituye por una FK o constraint física.

Para `Cerrar caja propia`, la matriz de permisos declara `Sí` para exactamente:

- `OWNER`;
- `GENERAL_ADMIN`;
- `BRANCH_MANAGER`;
- `SUPERVISOR`;
- `CASHIER`.

No se agrega ningún rol.

La autorización debe evaluar actor, rol activo y scope. Un `DEVICE` no obtiene permiso por el mero hecho de pertenecer al mismo scope. Un `USER` sin asignación o con un rol no listado es rechazado.

El cierre debe comprobar autorización antes del lookup de idempotencia para evitar que un actor no autorizado aprenda el estado de un cierre mediante replay.

## 12. Idempotencia, versionamiento y concurrencia

Apertura y cierre conservan claves y checksums independientes.

Misma idempotency key + mismo contenido debe resolver al mismo resultado. Misma key + contenido incompatible debe producir conflicto conforme al contrato de idempotencia.

`expected_version` protege las mutaciones de turno. La concurrencia no se resuelve mediante last-write-wins.

Un retry legítimo no crea un segundo CashCount, movimiento financiero o evento equivalente.

El orden de validaciones de aplicación permanece parte del contrato de seguridad; el DDL no puede obligar a consultar una clave de idempotencia antes de autorización cuando eso provoque una fuga de estado.

## 13. Transacciones y eventos

Las operaciones críticas deben preservar la frontera transaccional establecida por los use cases.

Para apertura: validación de scope/permiso, conflicto de turno, creación de turno, movimiento de apertura, auditoría, resultado idempotente y outbox pertenecen a una sola frontera transaccional lógica.

Para cierre: lock/versionado, corte, CashCount, denominaciones, ExpectedCash, diferencia/review cuando corresponda, cierre, auditoría, resultado idempotente y outbox pertenecen a una sola frontera transaccional lógica.

Eventos relevantes del contrato actual incluyen:

- `CashShiftOpened`;
- `CashMovementPosted`;
- `CashCountCompleted`;
- `CashDifferenceDetected` cuando aplique;
- `CashShiftClosed`.

Los eventos no sustituyen las entidades fuente.

## 14. PostgreSQL / SQLite

La materialización debe mantener semántica equivalente, no fingir un schema físico idéntico.

PostgreSQL:

- `numeric(19,6)` para importes;
- UUID v7 conforme a las convenciones;
- RLS donde corresponda;
- constraints/FKs/índices parciales para invariantes que requieran enforcement del motor;
- ownership y grants separados conforme a las convenciones.

SQLite:

- decimal canónico como texto;
- único writer del POS Local Service;
- invariantes de concurrencia que no puedan expresarse idénticamente deben verificarse dentro de la transacción `BEGIN IMMEDIATE` y mediante las pruebas requeridas.

No se crea una falsa equivalencia entre PostgreSQL y SQLite.

## 15. Índices y constraints

La futura migration debe incluir únicamente índices y constraints que respalden query paths o invariantes demostrados por las fuentes normativas.

Quedan prohibidos índices especulativos, columnas duplicadas de identidad, current-pointer redundantes y constraints que cambien la semántica del dominio.

En particular:

- la protección de turno incompatible debe ser resistente a concurrencia;
- el unique de `shift_sequence` debe preservar tenant + shift;
- la idempotencia de movimiento debe preservar tenant + device + key;
- el cierre debe impedir más de un conteo `CLOSING` completado por turno;
- las FKs deben conservar tenant/branch scope cuando la relación lo requiera.

## 16. Exclusiones explícitas

Este manifest NO autoriza ni incluye:

- ninguna migration SQL concreta;
- cambios a `001_central_foundation`;
- cambios a `002_external_integrations_foundation`;
- cambios a `003_fiscal_electronic_invoicing_foundation`;
- `GO_AUTHORIZED` para Cash;
- aplicación contra PostgreSQL o SQLite;
- creación de `CashPolicyVersion` sin contrato previo;
- materialización de Catalog, Inventory, Sales, Payments o Fiscal;
- creación de User/Session/Role dentro de Cash;
- adapters o APIs HTTP;
- UI POS;
- hardware;
- seeds comerciales;
- provider integrations.

## 17. Gates previos a materialización

La materialización futura requiere, como mínimo:

1. `CASH-MANIFEST-V1` revisado y aprobado formalmente;
2. trazabilidad de cada tabla/constraint al contrato físico vigente;
3. revisión de dependencias contra migrations 001/002/003 inmutables;
4. descriptor exacto de migration, checksum y rollback definidos en una tarea posterior;
5. estrategia PostgreSQL y SQLite separada;
6. pruebas de invariantes, RLS/scope y concurrencia correspondientes;
7. autorización explícita de gobernanza para iniciar SQL.

Hasta que esos gates se satisfagan, el estado permanece `NOT_FOR_SQL_MATERIALIZATION`.

## 18. Evidencia de entrada

Bloque 10 cerró la revisión transversal de Cash con:

- Domain `104/104 PASS`;
- Application `88/88 PASS`;
- typecheck `PASS` en 7 paquetes;
- Architecture `13/13 PASS` más `ARCH-003 boundary validation PASS`;
- autorización de cierre protegida para USER + rol autorizado y rechazada para USER sin rol, rol no listado, DEVICE, tenant escape y branch escape;
- replay no autorizado rechazado antes de revelar `ALREADY_CLOSED`.

El commit de entrada de este manifest es `3c66f422315e56672ace6451290c15f3f36cb209`.

## 19. Decisión

`CASH CROSS-FUNCTIONAL REVIEW = PASS`.

`CASH MANIFEST = PRESENT / REVIEW_REQUIRED`.

`DDL AUTHORIZATION = NOT GRANTED`.

El siguiente gate debe revisar este manifest contra las fuentes normativas y contra los precedentes de migration 001/002/003. Solo una aprobación explícita posterior puede convertir este contrato documental en autorización de materialización.