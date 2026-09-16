# D-3 — Preparación de autoridad central — 2026-09-16

## Estado

`D-3` es el siguiente objetivo técnico después de D-2, pero **no se implementa todavía** porque el repositorio no contiene una autoridad central de producto (`database-postgres` no existe como aplicación/runtime) y la decisión de raíz de confianza `DEC-022` permanece propuesta, no ratificada.

Esto no bloquea el trabajo de análisis: deja delimitado exactamente qué puede reutilizarse y qué decisiones deben cerrarse antes de escribir runtime.

## Evidencia existente

La línea activa ya contiene un servidor ejecutable de validación/persistence gate en `tools/target-migrations/src/central-sync-server.ts`. Ese servidor demuestra una base técnica reutilizable:

- PostgreSQL mediante `pg`.
- `CENTRAL_SYNC_TOKEN` fail-closed.
- validación de request/response mediante los contratos compartidos.
- límite de operaciones y body.
- checksum SHA-256 del payload canónico.
- persistencia transaccional en `sync.sync_operations`.
- contexto `app.tenant_id` antes de acceso a datos.
- comprobación durable posterior al commit.
- replay por `operation_id` con comprobación de checksum e identidad.
- idempotencia por `(tenant_id, operation_type, idempotency_key)`.
- respuesta `COMMITTED` sólo después de evidencia durable.

Ese servidor es **evidencia de gate**, no debe convertirse automáticamente en el runtime productivo por copia o renombrado.

## Gaps concretos de D-3

1. **Runtime propietario:** no existe una aplicación `database-postgres`/Central Authority separada y gobernada como componente de producto.
2. **Contrato operativo:** debe fijarse qué responsabilidades pertenecen a la autoridad central frente al gate de persistencia.
3. **Credencial de dispositivo:** D-2 permanece fail-closed porque no existe una fuente productiva de credenciales.
4. **Raíz de confianza:** `DEC-022` continúa pendiente de ratificación; no se debe inventar un bootstrap alternativo.
5. **Autorización central:** falta cerrar cómo se valida la autoridad del dispositivo/instalación sin convertir el token local del gate en una raíz de confianza de aplicación.
6. **Evolución de versiones:** debe conservarse la compatibilidad de contratos ya existente; no se crea un segundo contrato HTTP.
7. **Persistencia y concurrencia:** la semántica demostrada por el gate debe mantenerse al extraer el runtime, incluyendo idempotencia, checksum, tenant isolation y evidencia post-commit.

## No hacer

- No copiar `central-sync-server.ts` a otra carpeta para aparentar D-3.
- No crear otro endpoint paralelo de sync.
- No introducir snapshots/SSA/SAS como sustitución de la autoridad de escritura.
- No inventar credenciales en `.env`, código fuente o fixtures productivos.
- No ratificar `DEC-022` implícitamente mediante implementación.
- No cambiar `DEC-008`, `DEC-010`, contratos de sync o ownership para facilitar la implementación.

## Criterio de entrada a implementación

D-3 puede pasar de `READINESS` a implementación cuando exista una decisión explícita sobre:

```text
raíz de confianza
→ credencial de dispositivo/instalación
→ autenticación de la frontera central
→ responsabilidades del Central Authority
→ ownership de persistencia
→ semántica de replay/idempotencia
→ límites de runtime y despliegue
```

La implementación deberá reutilizar los contratos y las invariantes ya demostradas, no reconstruirlas.

## Relación con D-2

D-2 continúa pendiente de ejecución real del persistence gate. La imposibilidad actual de GitHub Actions por el bloqueo de billing no se transforma en un PASS ni en un FAIL de código.

Por tanto:

```text
D-2 = TESTED / runtime evidence pendiente
D-3 = READINESS / implementación pendiente de decisiones
```

## Próximo movimiento

1. Mantener D-2 documentado como pendiente de ejecución CI.
2. Resolver/ratificar las decisiones que D-3 necesita, empezando por la raíz de confianza.
3. Sólo después materializar el Central Authority en la misma línea de desarrollo.
