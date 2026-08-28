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

## Siguiente slice de TECH-003

Después de cerrar estos contratos comunes:

1. handshake Desktop ↔ Local Service y ventana de protocolo;
2. commands/results IPC propios con schemas específicos;
3. sync local ↔ central sobre Operation/outbox/inbox;
4. contratos HTTP centrales sin lógica de dominio en controllers;
5. adapters externos solo cuando su gate separado sea autorizado.
