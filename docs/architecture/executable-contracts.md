# TECH-003 — contratos ejecutables comunes

## Estado y alcance

Este slice inicia TECH-003 materializando únicamente el lenguaje común de las fronteras definido por `ARCH-004`. No crea endpoints HTTP, IPC Electron, named pipes, adapters provider ni casos de uso de negocio.

La implementación vive en `@pos-platform/contracts` y usa Zod con parsing estricto de objetos.

## Decisiones ejecutables

- `protocol_version`, `payload_schema_version` y `result_schema_version` usan versión canónica `major.minor.patch` con enteros no negativos y sin prefijos ambiguos.
- Identidades técnicas usan UUID RFC 9562/4122.
- `request_id` identifica transporte; `operation_id` conserva el hecho lógico; `correlation_id` agrupa el flujo; `causation_id` conserva causalidad.
- Una `idempotency_key` no es válida sin `operation_id`.
- Checksums SHA-256 se serializan como 64 caracteres hexadecimales minúsculos.
- Los objetos de wire son estrictos: campos desconocidos se rechazan.
- Payload y result del sobre genérico deben ser JSON; contratos específicos podrán sustituirlos por schemas más estrechos.
- `REJECTED` exige error; `SUCCEEDED` no admite error; un error transportado con estado `UNKNOWN` debe pertenecer a `UNKNOWN_OUTCOME`.
- `retry_after_ms` solo es válido para `RATE_LIMITED`.
- La comparación idempotente distingue `REPLAY`, `CONFLICT` y `DISTINCT`; compartir `operation_id` o `idempotency_key` con material diferente es conflicto fail-closed.

## Contratos materializados

- request envelope común;
- response envelope común;
- error estructurado y field errors;
- catálogo estable de categorías de error;
- versión y ventana de compatibilidad;
- identidad idempotente y clasificación de replay/conflict;
- primitivas UUID, códigos, message keys, timestamps y checksum.

## Controles

`pnpm test:contracts` prueba entradas válidas e inválidas, campos inesperados, payload no JSON, versión incompatible, resultado incierto, fuga de stack y colisiones de idempotencia.

`pnpm typecheck` incluye el package de contracts antes de migration tooling.

El CI TARGET ejecuta `architecture:check`, contratos, TypeScript, SQLite y PostgreSQL 16.14. Ningún PASS de este slice cambia `SEC-G01..SEC-G10` ni acredita runtime productivo.

## Handshake Desktop ↔ Local Service

El segundo slice materializa el intercambio de compatibilidad definido por DEC-010 sin crear todavía el canal named pipe:

- snapshot estricto con `desktop_version`, `service_version`, `protocol_min`, `protocol_max`, `installation_id`, `device_id`, `schema_version` y `service_state`;
- resultados exactos `COMPATIBLE`, `UPDATE_DESKTOP_REQUIRED`, `UPDATE_SERVICE_REQUIRED`, `MIGRATION_REQUIRED`, `RECOVERY_REQUIRED` y `UNTRUSTED_INSTALLATION`;
- negociación determinista de la versión de protocolo más alta presente en la intersección de dos ventanas;
- `COMPATIBLE` exige versión negociada; cualquier otro resultado la prohíbe;
- `schema_version` permanece como identificador opaco y validado: TECH-003 no inventa aquí orden o semántica de migración local;
- `service_state` permanece como código estable y su catálogo concreto pertenece al futuro runtime.

La compatibilidad de Desktop/Service, estado de migración, recovery y confianza de instalación no se infiere únicamente de la intersección del protocolo. Esa decisión futura combina la matriz de versiones y las evidencias de runtime definidas por DEC-010.

## Endurecimientos del contrato común

- la comparación de versiones usa enteros arbitrarios (`BigInt`) para evitar pérdida silenciosa de precisión;
- `server_time` es un instante RFC 3339 UTC y rechaza offsets distintos de `Z`, alineado con las convenciones físicas;
- los límites de bytes/profundidad se aplicarán en cada transporte; un schema Zod por sí solo no sustituye esos límites.

## IPC ejecutable — Bloque 1

TECH-003 materializa una allowlist mínima de mensajes propios sin crear todavía Electron, preload ni named pipes:

- `runtime.handshake`;
- `runtime.status.get`;
- `operation.result.get`.

Los mensajes desconocidos se rechazan. La consulta de resultado incierto conserva `operation_id` + `idempotency_key` y permite reconciliar después de una desconexión sin repetir ciegamente una operación.

Este bloque no acredita ACL, framing, autenticación del canal, timeouts ni seguridad del runtime Electron.

## Sync local ↔ central — Bloque 2

El contrato ejecutable conserva por operación:

- tenant/company/branch;
- `device_id` + `installation_id`;
- sesión/actor;
- agregado y tipo de operación;
- autoridad;
- secuencia local contigua;
- identidad idempotente;
- versión esperada;
- schema/payload/checksum;
- causalidad/correlación;
- tiempos locales como evidencia.

La request de batch exige que cada operación preserve el scope del batch y que la secuencia sea exactamente contigua desde el checkpoint previo. No se aceptan huecos implícitos.

La respuesta puede ser parcial: cada result debe corresponder a una operación solicitada y mantener su `correlation_id` y `aggregate_id`. Un result durable no implica automáticamente que el checkpoint pueda avanzar.

Solo `SERVER_ACCEPTED` y `SERVER_REJECTED` son elegibles para ampliar el prefijo contiguo confirmado. `CONFLICT`, `REVIEW_REQUIRED`, `DEAD_LETTER`, `WAITING_FOR_DEPENDENCY` y `RETRY_SCHEDULED` detienen el avance aunque exista evidencia durable del resultado técnico.

Este contrato materializa identidad, deduplicación y correspondencia; no implementa todavía outbox/inbox físicos ni procesamiento de negocio.

## Siguiente slice de TECH-003

1. contratos HTTP centrales sin lógica de dominio en controllers;
2. adapters externos solo cuando su gate separado sea autorizado.
