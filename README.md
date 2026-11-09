<p align="center">
  <img src="docs/brand/camacho-pos-colombia-logo-960.png"
       alt="Camacho POS Colombia — Vende. Controla. Sigue operando."
       width="640">
</p>

# Camacho POS Colombia

Camacho POS Colombia es una plataforma POS modular, multi-tenant y local-first para operación comercial real en Colombia.

`Camacho POS Colombia` es la identidad comercial. `POS Platform`, `pos-platform` y `@pos-platform/*` son identificadores técnicos internos.

## Estado y regla de continuidad

> **UNA SOLA LÍNEA. UN SOLO OBJETIVO ACTIVO. SE CONSTRUYE SOBRE LO EXISTENTE.**

La rama canónica del producto es `main`. La rama de trabajo activa debe comprobarse en la decisión vigente del propietario y el tablero del proyecto; las referencias históricas de ramas no son instrucciones actuales.

No se permite abrir una arquitectura paralela, duplicar módulos ni rehacer capacidades sin evidencia de defecto o requisito autorizado. Primero se audita lo construido.

Reglas vigentes para agentes: [`AGENTS.md`](AGENTS.md).

## Fuentes de verdad

El README es un resumen. No autoriza por sí mismo trabajo nuevo.

1. `docs/governance/repository-governance.md` — ramas, PR, integración y evidencia Git.
2. `docs/governance/tablero-materializacion.md` — niveles de evidencia por capacidad.
3. `docs/product/backlog.md` — prioridad, dependencia, bloqueo y orden de trabajo.
4. `docs/architecture/` y `docs/adr/` — arquitectura, ownership y decisiones.
5. Contratos y código existente — comportamiento real que debe preservarse.

Si dos fuentes normativas contradicen su estado, **se detiene la implementación y se reconcilian primero**.

## Qué está construido y se considera base, no terreno para rehacer

La fundación local y comercial ya existente incluye, según la evidencia registrada en el árbol:

- POS Local Service con SQLite/WAL y single-writer.
- Lifecycle local, identidad de dispositivo/licencia, auditoría e idempotencia.
- Canal local autenticado/versionado con controles de MAC, anti-replay y allowlist.
- Sesión/SSA, snapshot de autorización y autorización RBAC fail-closed donde el runtime vigente los instancia.
- Núcleo comercial: Sales, Cash, Payments, Customers, Catalog, Tax e Inventory en los alcances ya implementados.
- Outbox/sync durable con claim, respuesta, retry/backoff y dead-letter.
- Electron + React + Vite como shell/renderer, con los niveles de evidencia que marque el tablero; no se debe asumir que shell significa POS comercial completo.
- PostgreSQL migrations 001/002/003 con sus gates históricos cerrados; SQLite 003 continúa sin equivalencia inventada.
- CI de foundation, supply chain, CodeQL y gobernanza de `main`.

**Estas piezas no se rehacen por iniciativa de una IA.** Si una auditoría encuentra un defecto, se corrige el componente existente y se preserva su contrato salvo decisión arquitectónica explícita.

## Trabajo activo — D-2 / Central Sync

La línea activa está cerrando el transporte saliente del outbox y su evidencia de persistencia.

PR #78 corresponde a D-2: `DurableSyncStore` → `SyncDispatcher` → `CentralTransport`/`FetchCentralTransport`, con validación de contrato, `request_id`, fail-closed de credenciales y backoff/dead-letter.

Además, la línea activa contiene un **Central Sync Persistence Gate** dedicado que debe probar contra infraestructura real:

```text
PostgreSQL 16.14 real
        ↓
migration runner real
        ↓
central-sync-server real
        ↓
HTTP POST real
        ↓
sync.sync_operations
        ↓
replay HTTP real
        ↓
idempotency = una sola persistencia
```

El workflow es `.github/workflows/central-sync-persistence-gate.yml` y el paquete expone `central-sync:gate`.

### Estado exacto del gate

- Implementación del gate: `IMPLEMENTED`.
- Workflow dedicado: `IMPLEMENTED`.
- PostgreSQL 16.14 configurado: `IMPLEMENTED`.
- Servidor Central Sync real configurado: `IMPLEMENTED`.
- Persistencia real observada: **pendiente de ejecución del workflow nuevo**.
- Replay real observado: **pendiente**.
- Idempotencia real observada: **pendiente**.
- `CENTRAL-SYNC GATE: VERIFIED`: **NO declarado todavía**.

La ejecución anterior sobre el commit `0afefdb` falló y no puede usarse como evidencia del workflow posterior. Un cambio preparado para ejecutar no equivale a una ejecución verificada.

## PR #78 y `main`

PR #78 es trabajo de la línea activa y **no debe describirse como integrado en `main` mientras no exista merge + verificación post-merge**.

`main` continúa siendo la fuente canónica del producto. Una rama de trabajo no se vuelve canónica por tener más commits o CI verde.

Flujo obligatorio:

`rama activa → PR → revisión del autor → CI exact-head → autorización → merge commit → CI post-merge → documentación reconciliada`

No squash, no rebase y no force-push para integrar a `main`.

## Qué NO se debe hacer ahora

Mientras D-2 y su gate no estén cerrados, no se debe abrir trabajo paralelo sobre:

- una segunda arquitectura de sync;
- otra implementación de Central Sync;
- otra base central o API paralela;
- una migración nueva para resolver el mismo problema;
- snapshots/SSA/SAS de entrada como sustituto de D-2;
- G1/trust bootstrap como supuesto requisito del gate actual;
- DEC-022 como si ya estuviera ratificada;
- verticales de negocio nuevas sólo porque el núcleo ya tenga handlers;
- hardware, packaging o infraestructura productiva como desviación del objetivo activo.

Si una de estas áreas tiene un defecto que bloquea D-2, primero se documenta la relación y se audita; no se crea una segunda línea.

## Arquitectura canónica

```text
Renderer React
    │
    │ preload allowlisted
    ▼
Electron main
    │
    │ canal local autenticado/versionado
    ▼
POS Local Service
    ├── dominio/casos de uso locales
    ├── SQLite/WAL — único writer
    ├── outbox/sync
    ├── auditoría/idempotencia
    ├── dispositivo/licencia
    └── backup/diagnóstico
```

La arquitectura central futura no reemplaza al POS local. Los providers externos no definen el dominio canónico.

## Niveles de evidencia

El tablero vigente usa esta escalera:

`DOCUMENTED → IMPLEMENTED → TESTED → RUNTIME_VERIFIED → CALLER_REACHABLE → END_TO_END → PRODUCTION`

No se salta un peldaño. `main` y CI son ejes de integración, no sustitutos de la evidencia de runtime.

Regla estricta: **si no se ejecutó, no se declara PASS; si no se observó el runtime requerido, no se declara VERIFIED.**

## Qué falta después del bloque actual

Una vez cerrado D-2 y su gate, el siguiente trabajo se determina desde el backlog y los ADR vigentes. No se selecciona por preferencia de la IA.

Entre las capacidades que siguen sin representar un producto POS terminado están, según su evidencia actual:

- superficie completa de caja para el operador;
- administración real de usuarios/roles y controles avanzados de autorización;
- autoridad central productiva y despliegue;
- hardware y sus adapters físicos;
- empaquetado/instalación y operación productiva;
- observabilidad y pruebas de carga donde correspondan;
- seguridad `SEC-G01..SEC-G10` cuando sus prerequisitos estén desbloqueados;
- trust bootstrap/G1, que permanece separado y no se declara resuelto por D-2.

Esto no constituye un nuevo backlog. Son áreas pendientes ya conocidas; su orden se toma de las fuentes normativas.

## Gobernanza

El repositorio es privado. `main` no tiene branch protection preventiva nativa en el plan actual; existe un control compensatorio detectivo de gobernanza.

Las ramas históricas no son líneas activas. No se reutilizan ni se integran completas. La auditoría de deprecación de ramas registra qué trabajo fue integrado, qué quedó como evidencia y qué no debe reutilizarse.

## Desarrollo local

Los comandos y sus resultados sólo se consideran evidencia cuando fueron ejecutados realmente en el entorno correspondiente. GitHub no demuestra `git status`, procesos locales, Docker ni PostgreSQL local.

Comandos base existentes incluyen:

```powershell
pnpm typecheck
pnpm architecture:check
pnpm test:contracts
pnpm test:domain
pnpm test:application
pnpm test:fiscal-adapters
pnpm test:runtime
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```

No inventar comandos: verificar `package.json` antes de documentar o ejecutar uno nuevo.

## Principio final

**Una sola línea de desarrollo. Un solo objetivo activo. Una sola fuente de verdad por decisión. Se corrige lo demostrado y se continúa sobre lo construido.**
