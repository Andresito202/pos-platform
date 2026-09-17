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

PR #78 documenta el bloque D-2. Su alcance incluye `DurableSyncStore` → `SyncDispatcher`, `CentralTransport`, `FetchCentralTransport`, validación simétrica, `request_id`, fail-closed de credenciales y retry/backoff/dead-letter.

D-2 continúa pendiente de evidencia runtime real.

## 4. D-3 — raíz de confianza y enrollment central

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

La línea activa eliminó el modelo duplicado de `device-registry.ts`/`DeviceRegistryAuthenticator` y conserva únicamente la cadena canónica `device-trust.ts`. El activation secret se separa del checksum del payload y sólo se entrega al repositorio como `SHA-256(secret)`. El repositorio conserva el consumo one-shot y la persistencia de la credencial en una transacción.

### D-3 implementado en esta línea

- contratos/verificador canónicos;
- enrollment PoP previo a credencial;
- issuer central de `SignedDeviceTrustCredential`;
- resultado de enrollment con credencial completa;
- verificación local de firma operacional y binding;
- almacén local cifrado de credencial D-3, separado por AAD del secreto de identidad;
- handler transport-neutral con límites, schema, autenticación inyectable y lifetime de credencial;
- aplicación `apps/central-authority` separada de `central-sync-server`;
- repositorio PostgreSQL de Device Registry dentro de Central Authority, no dentro del tooling de migraciones;
- HTTPS/TLS real con mínimo TLS 1.2;
- autenticación de transporte bearer separada de la identidad criptográfica del dispositivo;
- rate limiting acotado en memoria por origen + huella de credencial de transporte;
- errores internos sanitizados;
- CLI ejecutable de migration 004;
- workflow `.github/workflows/d3-live-security-e2e.yml` para typecheck, tests, PostgreSQL 16.14, migrations 001–004, arranque TLS y boundary autenticada;
- gate ejecutable de enrollment HTTPS real con persistencia central, consumo one-shot y replay;
- pruebas de persistencia local, PoP, emisión, replay y redacción de errores.

### Seguridad de límites

El servidor central no recibe una clave privada del dispositivo ni una clave privada del issuer desde el request. La clave privada del issuer se inyecta desde un fichero de secreto de despliegue. El token bearer sólo autentica el transporte y no sustituye al binding + Ed25519 PoP.

La credencial local se escribe cifrada antes de registrar `DEVICE_ENROLLMENT_COMPLETED`; el audit log sólo conserva referencias opacas y nunca el material de la credencial ni el activation secret.

### Estado actual de D-3

```text
DEC-022                         RATIFICADA
D-3 contracts/verifier          IMPLEMENTED
D-3 enrollment PoP              IMPLEMENTED / tests added
D-3 credential issuance        IMPLEMENTED / tests added
D-3 credential response         IMPLEMENTED / tests added
D-3 local credential verification IMPLEMENTED / tests added
D-3 local credential persistence IMPLEMENTED / tests added
D-3 postgres repository         IMPLEMENTED / moved to Central Authority
D-3 enrollment protocol handler IMPLEMENTED / tests added
D-3 central server/app          IMPLEMENTED
D-3 TLS/auth transport         IMPLEMENTED / executable CI gate
D-3 rate limiting               IMPLEMENTED / bounded in-memory gate
D-3 migration 004               IMPLEMENTED / executable CLI + CI gate
D-3 security E2E                IMPLEMENTED / live HTTPS path added
D-3 runtime VERIFIED            NO — workflow execution still pending
```

### Evidencia que todavía no puede declararse

No se declara `VERIFIED` hasta observar una ejecución real del workflow con:

1. PostgreSQL 16.14 operativo.
2. migrations 001–004 aplicadas y ledger `APPLIED`.
3. `device_registry`, activation y credential persistidos realmente.
4. Central Authority escuchando por TLS.
5. request sin autenticación rechazado.
6. enrollment autenticado con PoP válido sobre HTTPS.
7. activation consumida una sola vez.
8. credential persistida centralmente y recuperable por el flujo local.
9. replay rechazado.
10. artifact de evidencia sin secretos.

El lockfile sigue pendiente de regeneración con pnpm real; no se fabrica manualmente. El workflow D-3 usa instalación no congelada para poder validar la línea mientras ese artefacto se regenera en un entorno con pnpm.

## 5. Qué permanece congelado

No abrir en paralelo:

- otra arquitectura de sync;
- otro Central Sync server/API;
- otra raíz o formato de credencial D-3;
- otro proof-of-possession D-3;
- otra persistencia para la credencial D-3;
- G1/session bootstrap como sustitución de D-3;
- nuevas verticales de negocio por preferencia;
- hardware, packaging o infraestructura productiva como desviación del objetivo activo.

## 6. Criterio de cierre D-3

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

La implementación está completada en el alcance D-3 autorizado; el estado abierto de este bloque es la evidencia runtime real. Después de esa evidencia, el siguiente bloque gobernado es la integración del session bootstrap conforme al ADR vigente.

## 7. Regla permanente

> **Una sola línea. Un solo objetivo activo. Continuar lo construido. Corregir lo demostrado. No inventar trabajo paralelo.**
