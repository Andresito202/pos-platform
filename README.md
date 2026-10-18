<p align="center">
  <img src="docs/brand/camacho-pos-colombia-logo-960.png"
       alt="Camacho POS Colombia"
       width="640">
</p>

# Camacho POS Colombia

Camacho POS Colombia es una plataforma POS modular, multi-tenant y local-first para operación comercial real en Colombia.

`Camacho POS Colombia` es la identidad comercial. `POS Platform`, `pos-platform` y `@pos-platform/*` son identificadores técnicos internos.

## Estado y regla de continuidad — 2026-10-17

> **UNA SOLA LÍNEA. UN SOLO OBJETIVO ACTIVO. SE CONSTRUYE SOBRE LO EXISTENTE.**

La rama canónica del producto es `main`. La única línea activa de desarrollo es:

[rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92)

Cualquier IA o agente **deben continuar sobre esta línea** mientras la gobernanza no la cambie explícitamente.

No se permite abrir una rama paralela, duplicar una arquitectura, rehacer un módulo o inventar un trabajo alternativo porque una IA considere que es “mejor”. Primero se audita lo construido. Sólo se modifica lo existente cuando hay evidencia de defecto, incompatibilidad, requisito nuevo autorizado o gate fallido.

Reglas completas para agentes: [`AGENTS.md`](AGENTS.md).

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

## Trabajo actual e integración

El inventario remoto, las dependencias de PR y el orden vigente están en [Backlog maestro — reconciliación operativa](docs/product/backlog.md#reconciliación-operativa--2026-10-17-americabogota). Ésta es la única cola operativa; los documentos de septiembre conservan evidencia histórica sobre sus SHAs.

La línea activa ya contiene `main@591ad4c` y los deltas probados de #94/#95, con 0 commits pendientes de main. También corrige el rate limit de enrolamiento. PR #92 conserva la integración acumulada hacia main y #93 sigue dependiendo de su base final. La evidencia ejecutada, las limitaciones de transporte del entorno y la cola restante están en el backlog.

PR #89 y #91 fueron fusionadas el 2026-10-05; PR #78 quedó cerrada sin merge propio. No debe seguir presentándose como el trabajo pendiente actual.

La inspección confirma credenciales de dispositivos enrolados y prueba firmada en sync, además de claves de sesión inyectadas en el arranque. Su existencia no acredita aprovisionamiento, sincronización, login ni administración completos en el entorno real. Las verificaciones pendientes y sus rutas están en el backlog.

Los jobs recientes consultados de TARGET y CodeQL no iniciaron runner ni pasos. No se declara PASS, ni fallo de tests por ese resultado. La política de integración sigue en [Gobernanza](docs/governance/repository-governance.md); esta reconciliación no autoriza merges.

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
