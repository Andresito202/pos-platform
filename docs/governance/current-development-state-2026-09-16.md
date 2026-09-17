# Estado de desarrollo vigente — 2026-09-16

## 1. Línea única

- Canónica: `main`.
- Activa: `claude/pos-camacho-bloque-4c-ld43py`.
- No existe autorización para crear otra línea de desarrollo en paralelo.

Toda IA debe continuar desde esta línea y auditar primero lo ya construido.

## 2. Base que se considera construida

Estas áreas forman parte de la base existente y no deben rehacerse por preferencia:

- POS Local Service y single-writer SQLite/WAL.
- Contratos y canal local autenticado/versionado.
- Idempotencia, auditoría y sync durable/outbox.
- Sesión/autorización en los alcances que el tablero acredita.
- Sales, Cash, Payments, Customers, Catalog, Tax e Inventory en los alcances ya implementados.
- Electron/React/Vite en los alcances acreditados por el tablero.
- PostgreSQL migrations 001/002/003 con sus gates históricos cerrados.
- CI, supply-chain, CodeQL y gobernanza de integración de `main`.

Una auditoría futura puede corregir defectos en estas áreas, pero no debe crear una segunda implementación para el mismo owner.

## 3. Bloque activo

### D-2 — transporte saliente del outbox

PR #78 documenta el bloque D-2. Su alcance incluye:

- `DurableSyncStore` → `SyncDispatcher`;
- puerto `CentralTransport` y adapter `FetchCentralTransport`;
- validación simétrica del contrato;
- control de `request_id`;
- fail-closed de credenciales;
- retry/backoff/dead-letter ya existentes en el store;
- sin idempotencia falsa a nivel de envelope.

D-2 permanece pendiente de evidencia runtime real, pero la línea activa continúa con D-3 para no quedar bloqueada por la disponibilidad operativa de GitHub Actions.

## 4. Central Sync Persistence Gate

La línea activa contiene:

- `tools/target-migrations/src/central-sync-gate.ts`;
- script `central-sync:gate`;
- `.github/workflows/central-sync-persistence-gate.yml`;
- PostgreSQL 16.14 como servicio CI;
- migration runner real;
- `central-sync-server` real;
- readiness `/health`;
- POST real;
- comprobación de fila persistida;
- replay real;
- comprobación de idempotencia por una sola persistencia;
- artifact con logs sin secretos.

### Evidencia

| Elemento | Estado |
|---|---|
| Código del gate | `IMPLEMENTED` |
| Script formal | `IMPLEMENTED` |
| Workflow dedicado | `IMPLEMENTED` |
| PostgreSQL 16.14 | `IMPLEMENTED` |
| Servidor real | `IMPLEMENTED` |
| POST → PostgreSQL observado | `NOT_EVALUATED` para la ejecución nueva |
| Replay observado | `NOT_EVALUATED` |
| Idempotencia observada | `NOT_EVALUATED` |
| Gate `VERIFIED` | **NO** |

### Bloqueo operativo de CI

La evidencia registrada en PR #78 muestra que varias ejecuciones de CI fueron impedidas por el estado de facturación/límite de gasto de la cuenta de GitHub: los jobs no llegaron a obtener runner ni pasos ejecutados. Esto es un bloqueo de ejecución de CI, no evidencia de un defecto del código D-2.

Este hecho no cambia la escalera de evidencia: mientras el persistence gate no ejecute el flujo real y produzca sus logs/artifact, D-2 permanece `TESTED`, no `VERIFIED`.

## 5. D-3 — raíz de confianza y reconciliación del modelo

`DEC-022` fue ratificada el 2026-09-16 y autoriza la implementación D-3.

Modelo canónico ratificado:

```text
Trust Root
  ↓
Operational DEVICE_TRUST Key
  ↓
Device Registry
  ↓
SignedDeviceTrustCredential
  ↓
Proof-of-Possession
  ↓
Authenticated Device
  ↓
Session bootstrap
```

### Reconciliación ejecutada

Se detectó y corrigió una contradicción real antes de abrir el endpoint central:

- existía un segundo `device-registry.ts` con una credencial distinta de `device-trust.ts`;
- existía un segundo `DeviceRegistryAuthenticator` con otra semántica de proof: hash SHA-256 del request y firma del digest hexadecimal;
- el modelo existente `DeviceTrustVerifier` ya define la cadena canónica root → operational key → signed credential → challenge/proof;
- la activación central comparaba indebidamente `request_checksum` contra `activation_checksum`, sin separar checksum de payload y secreto one-shot.

La línea activa ahora:

- elimina el contrato duplicado `device-registry.ts`;
- elimina el autenticador duplicado y sus tests;
- usa `DeviceEnrollmentProof` para el PoP previo a la existencia de la credencial;
- hace que el runtime central emita `SignedDeviceTrustCredential` usando `DeviceTrustCredentialClaimsSchema`;
- devuelve el credential firmado al resultado de enrollment, para que el lado local no pueda marcar enrolamiento sin material criptográfico;
- verifica en Local Service la firma operacional y el binding de la credencial antes de registrar `DEVICE_ENROLLMENT_COMPLETED`;
- usa `key_id` como referencia de la operational `DEVICE_TRUST` key, coherente con `DeviceTrustVerifier`;
- calcula y entrega al repositorio sólo `SHA-256(activation_secret)`;
- conserva la transacción atómica de consumo de activación + persistencia de credencial;
- persiste el checksum del objeto firmado canónico, no de un body alternativo;
- reconcilia `PostgresDeviceRegistryRepository` con el boundary compartido `CentralDeviceEnrollmentRepository`, eliminando la dependencia del runtime duplicado.

### Nueva frontera D-3 implementada

Se añadió `packages/device-trust/src/enrollment-http.ts` como **handler de protocolo transport-neutral**, no como servidor central. Esto resuelve una parte concreta del boundary sin crear una tercera arquitectura:

- límite de tamaño del body;
- `Content-Length` coherente;
- `application/json` obligatorio;
- autorización de transporte inyectable y separada de la identidad del dispositivo;
- parseo estricto con `DeviceEnrollmentRequestSchema`;
- validación temporal del challenge;
- lifetime máximo de la credencial decidido por la autoridad central;
- invocación exclusiva de `CentralDeviceCredentialIssuer`;
- respuesta con `SignedDeviceTrustCredential` completo sólo después del commit del issuer;
- mapeo cerrado de errores, sin devolver excepciones de PostgreSQL ni secretos;
- sin dependencia de Local Service.

Se añadió `packages/device-trust/tests/enrollment-http.test.ts` con cobertura de autorización, límites, JSON/schema, PoP inválido, credencial emitida y redacción de errores internos.

Esto **no** se declara como endpoint central productivo: todavía falta el servidor/aplicación Central Authority que posea TLS, límites de socket, autenticación de transporte real, rate limiting y conexión PostgreSQL administrada. No se reutiliza `central-sync-server` para ese fin.

### Estado de D-3

```text
DEC-022                         RATIFICADA
D-3 contracts/verifier          IMPLEMENTED
D-3 enrollment PoP              IMPLEMENTED / tests added
D-3 credential issuance         IMPLEMENTED / tests added
D-3 credential response         IMPLEMENTED / tests added
D-3 local credential verification IMPLEMENTED / tests added
D-3 postgres repository         IMPLEMENTED / reconciled
D-3 enrollment protocol handler IMPLEMENTED / not runtime verified
D-3 migration 004               IMPLEMENTED / no ejecutada
D-3 central endpoint            PENDIENTE — server/app boundary
D-3 authenticated boundary      PENDIENTE — transport/TLS/rate-limit
D-3 local credential persistence PENDIENTE
D-3 session bootstrap           PENDIENTE
D-3 security E2E                PENDIENTE
D-3 runtime VERIFIED            NO
```

### Bloqueador de dependencias

`packages/device-trust` y la dependencia workspace añadida a `tools/target-migrations` todavía requieren regeneración del `pnpm-lock.yaml` con pnpm real. No se fabrica manualmente el lockfile. Hasta generar y comprobar ese artefacto, el cambio no se declara `typecheck PASS` ni `VERIFIED`.

### Criterio de seguridad de la activación

```text
one-shot activation secret
        ↓
SHA-256(secret) almacenado centralmente
        ↓
POST enrollment
        ↓
validación de binding + PoP + credencial firmada
        ↓
BEGIN
  lock activation
  revalidate status/expiry/checksum
  persist signed credential
  consume activation
  activate device
COMMIT
        ↓
Local Service verifies operational signature + binding
        ↓
DEVICE_ENROLLMENT_COMPLETED
```

El secreto de activación no debe persistirse como plaintext en PostgreSQL ni enviarse a ningún componente que no necesite validarlo.

## 6. Qué permanece congelado

No abrir ni desarrollar en paralelo:

- otra arquitectura de sync;
- otro Central Sync server/API;
- otra estrategia de persistencia para el mismo gate;
- otra raíz o formato de credencial para D-3;
- otro proof-of-possession para D-3;
- G1/session bootstrap como sustitución de la frontera de confianza D-3;
- nuevas verticales de negocio por preferencia;
- hardware, packaging o infraestructura productiva como desviación del objetivo activo.

Si aparece un defecto que bloquea D-3, se audita y se corrige en la misma línea.

## 7. Criterio de cierre D-3

D-3 sólo puede avanzar a `VERIFIED` cuando exista evidencia observable de:

```text
trust root verified
→ operational DEVICE_TRUST key verified
→ device identity registered
→ one-shot enrollment
→ signed credential issued
→ credential persisted atomically
→ authenticated device proof-of-possession
→ revocation/rotation/replay checks
→ central authenticated boundary
→ session bootstrap
→ security E2E
→ runtime evidence
```

La presencia del archivo, un test unitario o una implementación no sustituyen esta evidencia.

## 8. Después de D-3

El siguiente objetivo se toma del backlog/ADR vigente. No lo elige la IA por conveniencia. Antes de iniciar otro bloque debe actualizarse/reconciliarse la documentación de estado.

## 9. Regla permanente

> **Una sola línea. Un solo objetivo activo. Continuar lo construido. Corregir lo demostrado. No inventar trabajo paralelo.**
