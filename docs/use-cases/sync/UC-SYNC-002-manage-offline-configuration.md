# UC-SYNC-002: Gestionar configuración versionada y disponibilidad offline

## Objetivo

Definir cómo un dispositivo POS obtiene, conserva, valida y utiliza configuración versionada para determinar qué capacidades pueden ejecutarse durante operación offline.

La operación offline nunca amplía permisos, módulos, límites, entitlements ni autoridad.

## Alcance

Aplica a configuración necesaria para operar offline, incluyendo cuando corresponda:

- catálogo;
- pricing;
- impuestos;
- redondeo;
- promociones;
- inventario;
- caja;
- ventas;
- pagos con capacidad offline explícita;
- dispositivos;
- permisos sincronizados;
- licenciamiento;
- políticas operativas.

La disponibilidad offline debe declararse explícitamente por módulo y capacidad.

## Precondiciones

- tenant válido;
- dispositivo e instalación identificables;
- empresa y sucursal conocidas cuando corresponda;
- política de sincronización compatible;
- configuración emitida por una autoridad válida;
- versión y checksum verificables localmente.

## Referencias de configuración efectiva

`UC-SYNC-002` no define una entidad global `Configuration` ni una versión universal de configuración.

Cada dominio conserva su propio mecanismo normativo de versionado, por ejemplo:

- `version`;
- `policy_version`;
- `payload_version`;
- `entitlement_version`;
- `schema_version`;
- u otra referencia versionada definida por el dominio correspondiente.

La evaluación offline reúne referencias a esas versiones sin convertirlas en una nueva fuente de verdad.

Una referencia de configuración efectiva puede conservar conceptualmente:

- `domain`;
- `resource_type`;
- `resource_id` opcional;
- `native_version_field`;
- `native_version_value`;
- `schema_version` opcional;
- `payload_checksum` opcional;
- `effective_from` opcional;
- `effective_until` opcional;
- `authority`;
- `offline_policy_reference` opcional.

`native_version_field` identifica qué mecanismo de versión utiliza el dominio.

Ejemplos:

- pricing -> `policy_version`;
- license -> `policy_version`;
- membership -> `version`;
- inventory reservation -> `version`;
- sync operation -> `schema_version` / `expected_version`.

No existe un `configuration_version` global que reemplace esas versiones.

La disponibilidad offline tampoco se representa mediante un booleano autoritativo global `offline_allowed`.

La capacidad offline efectiva se calcula utilizando las versiones y políticas vigentes junto con permisos, licencia, dispositivo, autoridad, vigencia, revocaciones y dependencias.

## Versionado

Toda configuración que pueda alterar una decisión operativa debe estar versionada.

Reglas:

1. una versión identifica una definición concreta;
2. no se modifica silenciosamente después de publicarse;
3. puede coexistir históricamente con versiones posteriores;
4. puede ser referenciada por operaciones ya ejecutadas;
5. una modificación material requiere una nueva versión;
6. una versión no puede reutilizarse para un payload diferente.

## Schema version

schema_version identifica el contrato estructural utilizado para interpretar la configuración.

El dispositivo solo puede usar una configuración cuyo schema_version soporte.

Una versión estructural no soportada produce incompatibilidad explícita.

## Checksum

Cada configuración relevante para decisiones offline debe disponer de checksum determinista.

El checksum debe calcularse sobre una representación canónica del payload.

La misma versión nativa de dominio con diferente `payload_checksum` constituye conflicto.

## Snapshot local de configuración

El dispositivo conserva localmente la configuración autorizada necesaria para capacidades offline habilitadas.

El snapshot local conserva como mínimo:

- versión;
- checksum;
- vigencia;
- alcance;
- autoridad;
- política offline;
- momento de recepción;
- módulo;
- capacidad autorizada.

El snapshot no convierte al dispositivo en autoridad definitiva.

## Estados de configuración

Estados conceptuales:

- CURRENT;
- STALE;
- EXPIRED;
- INCOMPATIBLE;
- REVOKED;
- MISSING;
- INVALID.

### CURRENT

Configuración verificable, vigente, soportada y autorizada para la capacidad solicitada.

### STALE

Existe configuración verificable, pero no ha podido confirmarse contra la autoridad dentro del intervalo esperado.

STALE no implica automáticamente EXPIRED.

La política del módulo determina si:

- continúa temporalmente;
- opera degradada;
- queda restringida;
- exige reconexión.

### EXPIRED

La configuración excedió su vigencia efectiva u offline.

No puede renovarse ni extenderse localmente.

### INCOMPATIBLE

La versión estructural o semántica requerida no es soportada.

### REVOKED

Existe una revocación conocida aplicable.

La falta de conectividad no elimina una revocación conocida.

### MISSING

No existe localmente la configuración necesaria.

### INVALID

La configuración falla validaciones de integridad, identidad, alcance o checksum.

## Disponibilidad offline por módulo

Cada módulo debe declarar explícitamente qué capacidades puede ejecutar offline.

La disponibilidad offline efectiva es una decisión derivada y contextual.

No constituye un permiso persistente autónomo ni un booleano global capaz de ampliar derechos.

No se permite inferir disponibilidad simplemente porque existan datos locales.

La evaluación debe considerar al menos:

- módulo;
- operación solicitada;
- política de autoridad;
- referencia de versión nativa del dominio;
- schema_version;
- payload_checksum;
- vigencia;
- permiso;
- licencia;
- dispositivo;
- tenant;
- dependencias;
- política offline aplicable.

Resultados conceptuales:

- OFFLINE_ALLOWED;
- OFFLINE_ALLOWED_DEGRADED;
- OFFLINE_DENIED_RECONNECT_REQUIRED;
- OFFLINE_DENIED_CONFIGURATION_MISSING;
- OFFLINE_DENIED_CONFIGURATION_EXPIRED;
- OFFLINE_DENIED_CONFIGURATION_INVALID;
- OFFLINE_DENIED_PERMISSION;
- OFFLINE_DENIED_LICENSE;
- OFFLINE_DENIED_DEVICE;
- OFFLINE_DENIED_DEPENDENCY.

## Matriz conceptual de capacidades

| Dominio | Lectura offline | Escritura offline | Condición mínima |
|---|---|---|---|
| Catálogo | Sí, si existe snapshot | Según operación | Versión local válida |
| Pricing | Sí | Sí para venta autorizada | Snapshot y políticas vigentes |
| Impuestos | Sí | Cálculo según política | Política fiscal versionada válida |
| Redondeo | Sí | Cálculo | Política versionada y checksum válido |
| Inventario | Sí | Según política local-first | Identidad, versión y reconciliación |
| Caja | Sí | Según política | Sesión y caja válidas |
| Ventas | Sí | Sí según política | Dependencias offline satisfechas |
| Permisos | Sí | No editable offline | Permiso sincronizado válido |
| Licenciamiento | Sí | No amplía derechos | Evidencia y política offline válidas |
| Dispositivo | Sí | Operación limitada | Identidad y estado permitido |

Esta matriz no sustituye las reglas específicas de cada dominio.

## Dependencias de configuración

Una operación puede depender de varias configuraciones.

Todas las dependencias obligatorias deben estar disponibles y ser compatibles.

Una dependencia ausente no se sustituye por valores inseguros por defecto.

## Evaluación offline

Antes de ejecutar una capacidad offline:

1. identifica tenant, empresa, sucursal, dispositivo y actor;
2. identifica módulo y capacidad;
3. determina configuraciones requeridas;
4. obtiene versiones locales;
5. valida alcance;
6. valida schema_version;
7. valida checksum;
8. valida vigencia;
9. valida política offline;
10. valida permisos;
11. valida licencia;
12. valida estado del dispositivo;
13. valida dependencias;
14. determina capacidad efectiva;
15. registra las versiones utilizadas;
16. ejecuta únicamente si el resultado lo permite.

## Configuración STALE

No existe una regla global que permita utilizar siempre una configuración STALE.

Según el módulo puede:

- permitir lectura;
- permitir operación limitada;
- bloquear cambios sensibles;
- impedir nuevas operaciones;
- exigir reconexión.

La decisión debe quedar registrada.

## Configuración expirada

Una configuración expirada:

- no se renueva localmente;
- no extiende su vigencia por falta de conectividad;
- no amplía permisos ni entitlements;
- no se sustituye por configuración inventada.

Si la política no permite continuidad, la operación se bloquea hasta obtener configuración válida.

## Cambios mientras el dispositivo está offline

El dispositivo puede desconocer cambios centrales posteriores.

Por tanto:

1. una operación offline conserva la versión efectivamente utilizada;
2. no se reescribe retrospectivamente al reconectar;
3. la autoridad central valida la operación;
4. incompatibilidades producen conflicto explícito;
5. las discrepancias no se ocultan.

## Configuración y autoridad

La existencia de una copia local no transfiere autoridad definitiva al dispositivo.

El dispositivo no puede ampliar localmente:

- permisos;
- roles;
- módulos;
- límites;
- licencias;
- entitlements;
- vigencia;
- gracia;
- revocaciones;
- configuración fiscal;
- autoridad de políticas.

## Reconexión

Al recuperar conectividad:

1. sincroniza operaciones pendientes mediante UC-SYNC-001;
2. obtiene metadatos de configuración;
3. compara versiones;
4. compara checksums;
5. descarga nuevas configuraciones autorizadas;
6. valida integridad;
7. valida alcance;
8. persiste la nueva configuración;
9. actualiza disponibilidad efectiva;
10. conserva versiones históricas referenciadas;
11. procesa conflictos sin reescribir operaciones históricas.

## Actualización atómica

Una configuración nueva no reemplaza a la anterior hasta quedar completamente validada y persistida.

Flujo conceptual:

download -> validate -> persist candidate -> verify -> activate

Si falla antes de activate, se conserva la última configuración válida según su propia vigencia.

## Operaciones ya iniciadas

Una operación que ya congeló snapshot no debe recalcularse automáticamente porque llegue una configuración nueva.

Las operaciones históricas usan sus versiones originales.

Las operaciones nuevas usan la configuración efectiva aplicable al momento de su creación.

## Permisos offline

Los permisos offline proceden de evidencia previamente sincronizada.

No pueden:

- crearse localmente;
- ampliarse localmente;
- extender vigencia localmente;
- ignorar revocaciones conocidas.

## Licenciamiento offline

La operación offline debe respetar:

- modalidad contratada;
- módulos habilitados;
- límites;
- vigencia;
- gracia autorizada;
- activación;
- dispositivo;
- revocaciones conocidas;
- versión de política.

## Pricing, impuestos y redondeo

Una venta offline conserva las versiones utilizadas para:

- pricing;
- impuestos;
- redondeo;
- promociones cuando correspondan.

Los resultados congelados no se recalculan al sincronizar por existir una política posterior.

## Inventario

Los movimientos offline conservan:

- tenant;
- ubicación;
- producto;
- lote cuando corresponda;
- cantidad;
- unidad;
- idempotency_key;
- expected_version cuando aplique;
- evidencia de configuración utilizada.

## Caja

La ausencia de conectividad no permite:

- inventar una apertura;
- utilizar una sesión ajena;
- evadir permisos;
- ignorar límites configurados.

## Auditoría

Debe poder reconstruirse:

- actor;
- dispositivo;
- tenant;
- sucursal;
- capacidad;
- configuración;
- versión;
- checksum;
- vigencia;
- resultado de autorización;
- momento local;
- momento de recepción central.

## Errores conceptuales

- SYNC_CONFIGURATION_MISSING;
- SYNC_CONFIGURATION_EXPIRED;
- SYNC_CONFIGURATION_STALE;
- SYNC_CONFIGURATION_INVALID;
- SYNC_CONFIGURATION_CHECKSUM_MISMATCH;
- SYNC_CONFIGURATION_VERSION_CONFLICT;
- SYNC_SCHEMA_VERSION_UNSUPPORTED;
- SYNC_OFFLINE_NOT_ALLOWED;
- SYNC_OFFLINE_DEPENDENCY_MISSING;
- SYNC_OFFLINE_PERMISSION_DENIED;
- SYNC_OFFLINE_LICENSE_DENIED;
- SYNC_OFFLINE_DEVICE_DENIED;
- SYNC_CONFIGURATION_SCOPE_MISMATCH.

## Invariantes

1. La operación offline no amplía autoridad.
2. Toda configuración material relevante está versionada.
3. Una modificación material genera nueva versión.
4. Misma versión con checksum diferente genera conflicto.
5. Una configuración expirada no se renueva localmente.
6. Una revocación conocida no se ignora offline.
7. Los permisos no se amplían offline.
8. Los entitlements no se amplían offline.
9. La disponibilidad offline es explícita por módulo.
10. Tener datos locales no implica autorización offline.
11. Una operación conserva las versiones utilizadas.
12. Una operación histórica no se recalcula por una versión posterior.
13. Una actualización se activa atómicamente.
14. Una configuración incompatible no se interpreta parcialmente.
15. Una dependencia obligatoria ausente no se sustituye silenciosamente.
16. El dispositivo no se convierte en autoridad definitiva.
17. Las discrepancias offline son visibles y conciliables.
18. El aislamiento multi-tenant sigue siendo obligatorio.
19. El checksum debe ser determinista.
20. La reconciliación no reescribe snapshots históricos.

## Excepciones

- configuración inexistente;
- versión no soportada;
- checksum incompatible;
- configuración expirada;
- configuración inválida;
- configuración fuera de alcance;
- dependencia ausente;
- permiso insuficiente;
- licencia insuficiente;
- dispositivo no autorizado;
- revocación conocida;
- política offline denegada;
- combinación incompatible de configuraciones;
- conflicto de versión al reconectar;
- acceso cruzado entre tenants.

## Postcondiciones

Si la operación se permite:

- se conoce la configuración efectiva;
- se conocen las versiones;
- se conserva evidencia para reconciliación;
- puede entrar al flujo definido por UC-SYNC-001;
- ningún derecho fue ampliado localmente.

Si se deniega:

- no se ejecuta el efecto protegido;
- se conserva el motivo;
- puede exigirse reconexión.

## Pruebas mínimas

### Versionado

- misma versión y mismo checksum;
- misma versión y checksum diferente;
- nueva versión válida;
- schema_version no soportada;
- conservación de versión histórica.

### Vigencia

- CURRENT;
- STALE permitido;
- STALE degradado;
- STALE bloqueado;
- EXPIRED;
- REVOKED.

### Disponibilidad offline

- módulo permitido;
- módulo denegado;
- capacidad permitida;
- dependencia ausente;
- datos locales presentes sin autorización.

### Seguridad

- ampliar permiso offline;
- ampliar entitlement offline;
- revocación conocida;
- tenant incorrecto;
- sucursal fuera de alcance;
- dispositivo incorrecto;
- checksum manipulado.

### Actualización

- descarga válida;
- descarga corrupta;
- actualización interrumpida;
- activación atómica;
- conservación de última configuración válida;
- combinación incompatible.

### Reconexión

- operación con versión válida;
- operación con versión histórica;
- conflicto de versión;
- conflicto de checksum;
- nueva configuración no modifica snapshot histórico.

### Dominios

- venta offline;
- pricing offline;
- impuesto offline;
- redondeo offline;
- inventario offline;
- caja offline;
- permiso offline;
- licencia offline.

### Recuperación

- reinicio con configuración vigente;
- reinicio con configuración STALE;
- reinicio con configuración expirada;
- reinicio durante actualización;
- recuperación conserva versión y checksum.

## Documentos normativos relacionados

- docs/adr/ADR-003-local-first.md;
- docs/adr/DEC-007-local-first-data-authority.md;
- docs/adr/DEC-008-device-trust-license-activation.md;
- docs/architecture/conceptual-data-model.md;
- docs/domain/business-rules.md;
- docs/domain/glossary.md;
- docs/security/permission-matrix.md;
- docs/use-cases/sync/UC-SYNC-001-synchronize-operation.md.
