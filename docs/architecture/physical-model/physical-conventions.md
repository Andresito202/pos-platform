# TECH-002A: convenciones físicas PostgreSQL y SQLite

## Estado

`APPROVED_FOR_TABLE_DESIGN` dentro de `TECH-002`.

Este documento define cómo se materializan tipos y controles ya exigidos por los casos de uso y ADR. No contiene DDL ni autoriza migraciones. El PoC de RLS continúa siendo obligatorio antes de la primera migración PostgreSQL.

## Principios obligatorios

1. PostgreSQL y SQLite comparten semántica, no un esquema físico fingidamente idéntico.
2. Cada motor tendrá migraciones, adaptadores y pruebas propios.
3. El dominio y la aplicación no importan Kysely, drivers ni tipos específicos del motor.
4. Ninguna tabla nace sin módulo propietario y fuente trazable.
5. Toda entidad sincronizable usa el mismo UUID v7 de extremo a extremo.
6. Los hechos confirmados, movimientos y auditoría no se actualizan destructivamente.
7. Una proyección nunca sustituye su fuente de verdad.
8. Toda operación tenant-scoped valida aislamiento en aplicación y, en PostgreSQL, mediante RLS cuando corresponda.
9. SQLite es escrito únicamente por POS Local Service.
10. No se usa coma flotante binaria para dinero, tasas, cantidades o conversiones autoritativas.

## Nombres físicos

### PostgreSQL

Se utilizan schemas por módulo propietario:

| Schema | Propietario |
|---|---|
| `platform` | cuentas y catálogos estrictamente globales de plataforma |
| `identity` | usuarios, credenciales, factores, sesiones y eventos de seguridad |
| `tenancy` | tenants y memberships |
| `organization` | empresas y sucursales |
| `authorization` | roles, permisos, asignaciones y políticas |
| `devices` | dispositivos, instalaciones, claves públicas y estado operativo |
| `licensing` | licencias, entitlements, activaciones y revocaciones |
| `catalog` | productos, categorías, unidades, presentaciones e identificadores |
| `pricing` | precios, promociones, impuestos y redondeo |
| `inventory` | ubicaciones, lotes, movimientos, reservas y proyecciones |
| `purchasing` | proveedores y recepciones autorizadas por casos de uso |
| `cash` | cajas, turnos, conteos y movimientos |
| `sales` | ventas, líneas, suspensiones, devoluciones comerciales y cancelaciones |
| `payments` | grupos, pagos, intentos, asignaciones, refunds y conciliación |
| `sync` | inbox, conflictos, revisiones y checkpoints centrales |
| `fiscal` | configuración y documentos electrónicos neutrales a proveedor |
| `audit` | auditoría inmutable |

Un schema no implica microservicio. Es una frontera de ownership dentro del monolito modular.

### SQLite

SQLite no ofrece schemas equivalentes. Las tablas utilizan prefijo de módulo:

```text
identity_users
catalog_products
inventory_movements
sales_sales
payments_payments
sync_outbox_entries
audit_events
```

Los nombres de tabla son plurales, `snake_case` y no contienen nombres de proveedor. Las columnas son `snake_case`. Las PK usan `id`; las FK usan `<aggregate>_id`.

## Clasificación de datos por ubicación

Cada tabla debe declarar una de estas clases antes del esquema:

| Clase | PostgreSQL | SQLite | Autoridad |
|---|---|---|---|
| `CENTRAL_ONLY` | Sí | No | módulo central propietario |
| `LOCAL_ONLY` | No | Sí | POS Local Service |
| `CENTRAL_MASTER_REPLICATED` | Sí | proyección/versiones necesarias | central; local no publica cambios no autorizados |
| `LOCAL_AUTHORITATIVE_SYNCED` | copia consolidada | Sí | local hasta aceptación/reconciliación central según `DEC-007` |
| `DUAL_WITH_EXPLICIT_POLICY` | Sí | Sí | definida por operación y estado, nunca last-write-wins genérico |
| `DERIVED_PROJECTION` | opcional | opcional | reconstruible desde hechos propietarios |

La presencia de la misma entidad en ambos motores no permite replicar todas sus columnas ni escribir desde ambos lados.

## Identificadores

### UUID v7

| Motor/frontera | Representación |
|---|---|
| Dominio y contratos | string UUID v7 canónico lowercase con guiones |
| PostgreSQL | `uuid` |
| SQLite | `TEXT` con longitud 36 y validación canónica en adaptador |
| API, IPC, outbox, inbox y auditoría | mismo valor canónico |

Reglas:

1. No existe una segunda columna `global_id`.
2. No se usan autoincrementos como identidad sincronizable.
3. Un consecutivo humano nunca es PK.
4. Referencias heredadas se almacenan en una tabla o columna de migración explícita, no sustituyen `id`.
5. El generador UUID v7 debe poder probar monotonicidad razonable sin usar el timestamp como autoridad de negocio.

### Identificadores humanos

SKU, códigos, series, números de venta, NIT y referencias externas:

- se normalizan mediante una función versionada;
- conservan el valor original cuando sea necesario mostrarlo o auditarlo;
- tienen unicidad en su scope de negocio, no global por conveniencia;
- no se reutilizan cuando el contrato exige historia;
- no se generan con `COUNT(*)`.

## Tiempo

| Concepto | PostgreSQL | SQLite |
|---|---|---|
| instante autoritativo | `timestamptz` UTC | `TEXT` RFC 3339 UTC con microsegundos |
| fecha comercial | `date` | `TEXT` `YYYY-MM-DD` validado |
| zona IANA | `text` | `TEXT` |
| offset reportado | `smallint` en minutos | `INTEGER` en minutos |
| duración | entero con unidad declarada | entero con unidad declarada |

Reglas:

1. Los nombres terminados en `_at` son instantes UTC.
2. `business_date` no se deriva nuevamente al consultar; queda congelada al confirmar la operación.
3. Cuando importa el contexto local se conservan `timezone_id` y `utc_offset_minutes`.
4. El reloj del dispositivo se guarda como evidencia reportada, nunca como autoridad global.
5. PostgreSQL asigna `received_at`/`server_recorded_at` para recepción central.
6. No se almacenan fechas locales ambiguas sin zona u offset cuando representan un instante.

## Decimales exactos

### Contrato lógico vigente

Se conserva el contrato de `DEC-003`:

| Categoría | Precisión lógica |
|---|---|
| importe de cálculo, precio, base, impuesto, descuento, residuo, pago y costo | `(19,6)` |
| importe documental normalizado | `(19,2)` |
| tasa, porcentaje y factor de conversión | `(19,10)` |
| cantidad, peso y unidad convertible | `(19,6)` |

### PostgreSQL

PostgreSQL utiliza `numeric(19,6)`, `numeric(19,2)` o `numeric(19,10)` según la categoría. El driver entrega estos valores como string; nunca se convierten a `number` JavaScript.

### SQLite

SQLite utiliza `TEXT` con decimal canónico de escala fija como representación autoritativa:

```text
0.000000
1250.500000
-25.000000
0.1900000000
```

Reglas:

1. No se admite exponente, coma, whitespace, `NaN`, infinito ni cero negativo.
2. La cantidad de decimales coincide exactamente con la escala física de la columna.
3. Los ceros a la izquierda se normalizan; `0` se representa con una sola cifra entera.
4. La precisión total no excede 19 dígitos.
5. El adaptador convierte la cadena en coeficiente `BigInt` y escala antes de operar.
6. El dominio calcula mediante un value object decimal basado en coeficiente entero; nunca con `number`.
7. SQLite no usa `SUM`, `AVG`, comparación numérica ni orden numérico nativos sobre estas columnas.
8. Los agregados autoritativos se calculan en dominio y se persisten con control de versión dentro de la transacción.
9. El adaptador valida formato, precisión, escala, signo y límites en cada escritura y lectura.
10. PostgreSQL vuelve a validar límites y resultados sincronizados.
11. Cuando un `CHECK` SQLite no pueda expresar toda la regla, se aplica la excepción explícita de `DEC-007`: validación local transaccional, prueba negativa y revalidación central.

Esta decisión prioriza exactitud y portabilidad sobre agregaciones SQL locales implícitas. No requiere extensiones nativas ni una segunda librería ORM.

### Moneda

1. Todo agregado monetario contiene `currency_code CHAR(3)` o lo deriva de un padre inmutable dentro de la misma transacción.
2. Una obligación, grupo de pagos y sus pagos usan una sola moneda salvo caso de uso futuro explícito.
3. Sentido correctivo se expresa mediante tipo de operación; no mediante signos ambiguos.
4. Los límites `>= 0` se aplican donde el caso de uso no admite negativos.

## Booleanos, estados y enums

| Motor | Representación |
|---|---|
| PostgreSQL | `boolean`; estados como `text` con `CHECK` versionado en migración |
| SQLite | `INTEGER` con `CHECK (value IN (0,1))`; estados como `TEXT` con `CHECK` |

No se utilizan enums nativos PostgreSQL en la primera versión porque complican expansión/contracción y divergencia con SQLite. Un nuevo estado requiere migración compatible y pruebas de consumidores anteriores.

Un estado derivado no se persiste en el agregado solo para facilitar una pantalla. Puede existir en una proyección explícita y reconstruible.

## JSON

JSON se admite únicamente para:

- snapshots inmutables con schema/version/checksum;
- evidencia de proveedor sanitizada;
- atributos de variante cuyo conjunto sea realmente abierto;
- payload de evento/outbox versionado;
- diagnóstico autorizado.

JSON no sustituye:

- FK;
- índices y unicidades;
- importes autoritativos;
- estados principales;
- scopes tenant/empresa/sucursal;
- relaciones rol-permiso;
- referencias de pago o inventario;
- secretos.

PostgreSQL usa `jsonb`; SQLite usa `TEXT` JSON canónico validado por el adaptador y `json_valid` cuando esté disponible en el runtime certificado.

## Versionado y concurrencia

1. Agregados mutables contienen `version BIGINT/INTEGER NOT NULL` iniciando en `1`.
2. Una actualización usa `WHERE id = ? AND version = expected_version` e incrementa exactamente una vez.
3. Cero filas afectadas produce conflicto, no retry ciego.
4. Hechos append-only no necesitan versión mutable, pero sí identidad e idempotencia.
5. `updated_at` no sustituye `version`.
6. No se usa lock pesimista local fuera del único escritor; PostgreSQL puede usar locks explícitos solo en fronteras documentadas.

## Ciclo de vida y eliminación

| Clase | Política |
|---|---|
| catálogo mutable | `status`, `retired_at` o vigencia; sin hard delete si fue referenciado |
| definición versionada | nueva versión; la publicada no se edita |
| venta/pago/caja/inventario | append-only o transición controlada; sin hard delete |
| sesión/token | revocación y expiración; retención según seguridad |
| proyección | reconstruible; puede regenerarse sin eliminar fuente |
| dato migrado | conserva referencia y evidencia de reconciliación |

No se propagan borrados en cascada desde identidad, dispositivo, tenant o catálogo hacia hechos históricos.

## Auditoría

`AuditEvent` es append-only y conserva como mínimo:

- `id` UUID v7;
- tenant/empresa/sucursal cuando apliquen;
- `actor_type` y `actor_id` opcional según tipo;
- sesión y dispositivo cuando existan;
- acción y recurso;
- `resource_id`;
- `correlation_id`;
- `operation_id` o idempotency key cuando corresponda;
- instante reportado y timestamp de servidor;
- resultado;
- motivo/código estable;
- hash o checksum de evidencia cuando aplique.

No almacena contraseñas, tokens, claves privadas, PAN, CVV ni credenciales fiscales. Logs y trazas no sustituyen esta tabla.

## Aislamiento PostgreSQL y RLS

### Roles físicos

| Rol | Uso | Restricciones |
|---|---|---|
| `pos_schema_owner` | propietario de objetos; usado por migración controlada | no usado por API ni workers |
| `pos_migrator` | ejecutar versión de migración autorizada | sin tráfico de negocio |
| `pos_app` | API central por tenant | no owner, no superuser, sin `BYPASSRLS` |
| `pos_worker` | workers procesando un tenant por transacción | no owner, no `BYPASSRLS` |
| `pos_reporting` | proyecciones autorizadas de lectura | no accede a tablas fuera de datasets aprobados |

### Política

1. Toda tabla tenant-scoped contiene `tenant_id NOT NULL` aunque el tenant sea derivable por FK; esto habilita aislamiento, índices y comprobaciones compuestas.
2. RLS se habilita y fuerza en tablas tenant-scoped centrales.
3. El contexto se establece con `SET LOCAL app.tenant_id` dentro de una transacción.
4. La política compara `tenant_id` con `current_setting('app.tenant_id', true)` convertido a UUID.
5. La ausencia o invalidez del contexto produce denegación, nunca acceso global.
6. API y workers no consultan tablas tenant-scoped fuera de transacción.
7. Un worker multi-tenant abre una transacción independiente por tenant/lote; no usa bypass general.
8. El pool no conserva contexto entre préstamos porque `SET LOCAL` termina con commit/rollback.
9. FKs y constraints incluyen el scope necesario para impedir relaciones cruzadas aunque RLS no cubra integridad referencial.
10. Operaciones de plataforma global usan puertos y roles específicos, auditados, no parámetros enviados por clientes.

### Gate de PoC

Antes de la migración PostgreSQL deben probarse:

- dos tenants con el mismo identificador humano permitido;
- lectura, insert, update y delete cruzados denegados;
- `WITH CHECK` impidiendo cambiar `tenant_id`;
- conexión sin contexto denegada;
- owner y migrator fuera del pool de aplicación;
- worker procesando tenants secuencialmente sin fuga de contexto;
- backup completo sin omisión silenciosa por RLS;
- consultas con FK/unique que no filtren datos sensibles mediante mensajes de error.

## Aislamiento SQLite

SQLite no implementa RLS. El aislamiento local usa:

1. una instalación vinculada a tenant y empresa autorizados;
2. `tenant_id` obligatorio en cada tabla operacional;
3. repositorios que reciben contexto cerrado, no tenant libre desde renderer;
4. FK compuestas o validación transaccional para impedir relaciones cruzadas;
5. consultas sin métodos globales en puertos de negocio;
6. pruebas negativas del adaptador;
7. POS Local Service como único escritor;
8. revalidación central de toda operación sincronizada.

## Índices mínimos por patrón

Todavía no se fijan nombres de índices por tabla, pero todo esquema deberá justificar:

- PK;
- cada FK usada en borrado lógico, join o validación;
- cada `UNIQUE` de negocio;
- `(tenant_id, id)` o clave compuesta equivalente para relaciones aisladas;
- estados de trabajo con próximo intento;
- outbox pendiente por dispositivo/secuencia;
- inbox por operación e idempotencia;
- vigencias por scope y rango temporal;
- venta por sucursal/serie/número;
- stock por ubicación/presentación/lote;
- referencias externas de pago;
- auditoría por tenant/recurso/instante.

No se crean índices especulativos. Cada índice debe corresponder a constraint, FK, caso de uso o consulta crítica documentada y se valida con plan real.

## Controles que cierran brechas

- `PHY-G13` queda cerrado documentalmente mediante decimal canónico SQLite y value object de coeficiente entero.
- `PHY-G14` queda definido documentalmente; permanece bloqueado para migración hasta ejecutar el PoC RLS descrito.

## Condición de salida

Estas convenciones quedan aprobadas para diseñar tablas cuando:

1. ninguna contradice los casos de uso o ADR vigentes;
2. todas las tablas propuestas declaran clase de ubicación y ownership;
3. la matriz de columnas aplica estas representaciones sin excepciones silenciosas;
4. las pruebas de dialecto incluyen decimales, UUID, RLS, timestamps y concurrencia;
5. cualquier excepción se registra antes de escribir DDL.
