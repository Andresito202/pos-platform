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

D-2 permanece en la línea activa hasta su cierre conforme a la escalera de evidencia.

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

La ejecución anterior sobre `0afefdb` terminó en `failure` y no acredita la ejecución posterior del workflow nuevo.

### Bloqueo operativo de CI

La evidencia registrada en PR #78 muestra que varias ejecuciones de CI fueron impedidas por el estado de facturación/límite de gasto de la cuenta de GitHub: los jobs no llegaron a obtener runner ni pasos ejecutados. Esto es un bloqueo de ejecución de CI, no evidencia de un defecto del código D-2.

Este hecho no cambia la escalera de evidencia: mientras el persistence gate no ejecute el flujo real y produzca sus logs/artifact, D-2 permanece `TESTED`, no `VERIFIED`.

## 5. Qué queda congelado mientras se cierra D-2

No abrir ni desarrollar en paralelo:

- otra arquitectura de sync;
- otro Central Sync server/API;
- otra estrategia de persistencia para el mismo gate;
- snapshots/SSA/SAS de entrada como sustitución de D-2;
- G1/trust bootstrap como sustitución del gate;
- DEC-022 como decisión ya ratificada;
- nuevas verticales de negocio por preferencia;
- hardware, packaging o infraestructura productiva como desviación del objetivo activo.

Si aparece un defecto que bloquea D-2, se audita y se corrige en la misma línea.

## 6. Criterio de cierre del bloque

D-2 / persistence gate sólo puede avanzar a `VERIFIED` cuando exista evidencia observable de:

```text
CI checkout del SHA revisado
→ PostgreSQL 16.14 real
→ migration real
→ Central Sync real READY
→ POST 200
→ fila persistida
→ replay 200
→ misma idempotency key
→ una sola fila
→ artifact/log verificable
```

La presencia del archivo, un test unitario, un workflow definido o un CI verde de otra ejecución no sustituyen esta evidencia.

## 7. Preparación del siguiente bloque — D-3

Se realizó la preparación arquitectónica de D-3 sin inventar runtime ni duplicar el servidor del gate.

Documento: `docs/governance/d3-central-authority-readiness-2026-09-16.md`.

Estado actual:

```text
D-2 = TESTED / evidencia runtime pendiente
D-3 = READINESS / implementación pendiente de decisiones
```

La línea contiene `tools/target-migrations/src/central-sync-server.ts`, que sirve como evidencia técnica del persistence gate. No se considera todavía la autoridad central productiva.

D-3 no puede materializarse correctamente hasta cerrar las decisiones sobre raíz de confianza, credencial de dispositivo/instalación, autenticación de la frontera central, responsabilidades de Central Authority, ownership de persistencia y límites de runtime/despliegue.

`DEC-022` sigue siendo una propuesta pendiente de ratificación; ninguna implementación puede ratificarla implícitamente.

## 8. Después del cierre

El siguiente objetivo se toma del backlog/ADR vigente. No lo elige la IA por conveniencia. Antes de iniciar otro bloque debe actualizarse/reconciliarse la documentación de estado.

## 9. Regla permanente

> **Una sola línea. Un solo objetivo activo. Continuar lo construido. Corregir lo demostrado. No inventar trabajo paralelo.**