# Camacho POS Colombia (pos-platform)

## REGLA DOMINANTE — UNA SOLA LÍNEA DE DESARROLLO

Este repositorio no acepta desarrollo paralelo por iniciativa de una IA.

- **Línea activa vigente:** `feat/payment-qr-provider-foundation`
- **Fuente única de verdad, legible por máquina:** `tools/governance/active-line.txt`.
  Este documento, `AGENTS.md` y `README.md` la **citan**; el fichero la **define**.
  Si alguno discrepa, manda el fichero y `pnpm ci:governance` falla.
- **Comprobación obligatoria antes de escribir una línea de código:**

  ```bash
  ./tools/governance/check-active-line.sh    # sale 1 si no estás en la línea activa
  ```

  Las sesiones de Claude Code lo ejecutan solas: `.claude/hooks/session-start.sh`
  lo lanza al arrancar y lo imprime antes que nada. **No depende de que tú lo leas.**
- **Rama canónica del producto:** `main`
- **Línea anterior, ya absorbida:** `claude/pos-camacho-bloque-4c-ld43py` (PR #78).
  Su HEAD `16a0966` es **ancestro** de la línea activa: `git merge-base
  --is-ancestor 16a0966 <HEAD>` devuelve verdadero y `git rev-list --count
  HEAD..origin/claude/pos-camacho-bloque-4c-ld43py` devuelve **0**. No queda
  nada por rescatar ahí. **No se trabaja sobre ella.**
- El trabajo nuevo continúa sobre la línea activa mientras la gobernanza no la cambie explícitamente.
- No abrir otra rama porque una IA considere que su enfoque es más limpio, moderno o conveniente.
- No duplicar módulos, contratos, migrations, gates o arquitecturas existentes para resolver el mismo problema.
- No rehacer trabajo ya construido sin demostrar primero un defecto, una incompatibilidad o un requisito nuevo autorizado.
- No integrar ramas históricas completas para “aprovechar trabajo”. Su contenido se extrae selectivamente sólo cuando una auditoría demuestra que sigue siendo necesario y compatible.
- Si existe contradicción entre documentos, contratos o implementaciones, **se detiene la escritura y se reconcilia primero**.

> **Primero se continúa lo construido. Después se corrige lo demostrado. No se dispersa el proyecto.**

## Protocolo obligatorio antes de cualquier cambio

1. Leer `AGENTS.md`.
2. Leer este `CLAUDE.md`.
3. Leer `README.md`.
4. Leer `docs/governance/repository-governance.md`.
5. Leer `docs/governance/tablero-materializacion.md`.
6. Leer `docs/product/backlog.md`.
7. Identificar la línea activa y el objetivo único vigente.
8. Auditar código, contratos, ADRs, tests y documentación existentes antes de diseñar.
9. Identificar owner y solución existente antes de crear una nueva.
10. Declarar alcance, riesgos y criterio de evidencia antes de escribir.

## Regla de continuidad

Una propuesta alternativa no se implementa por iniciativa propia. Sólo puede sustituir o modificar lo construido si existe evidencia concreta de:

- contrato incumplido;
- defecto reproducible;
- incompatibilidad arquitectónica;
- requisito nuevo autorizado;
- gate fallido que requiera corrección.

Frases como “es mejor”, “es más limpio”, “conviene rehacerlo” o “podemos hacerlo en paralelo” **no son evidencia**.

## Niveles de evidencia

Usa siempre la escalera vigente del tablero de materialización:

- `DOCUMENTED`
- `IMPLEMENTED`
- `TESTED`
- `RUNTIME_VERIFIED`
- `CALLER_REACHABLE`
- `END_TO_END`
- `PRODUCTION`

No confundas `main` o CI verde con un peldaño. Son evidencia de integración/CI, no sustitutos de la ejecución que exige cada capacidad.

Nunca declares `PASS`, `TESTED`, `VERIFIED` o un nivel superior por inferencia.

## Superficies cerradas

Una capacidad integrada y cerrada no se toca “para mejorarla” sin evidencia y alcance explícitos. Esto aplica especialmente a:

- contratos canónicos;
- migrations cerradas;
- reglas de ownership;
- single-writer SQLite;
- idempotencia y causalidad;
- append-only financiero/inventario/auditoría;
- seguridad fail-closed;
- gates de CI que ya tienen evidencia válida.

## Estado de proyecto y documentación

El README es un resumen, no una autorización para inventar trabajo. Las fuentes normativas son las indicadas por `docs/governance/repository-governance.md`, `docs/governance/tablero-materializacion.md`, `docs/product/backlog.md` y los ADR/contratos correspondientes.

Si README, backlog, ADR, workflow, PR o código presentan estados incompatibles, no elijas uno arbitrariamente: identifica la fuente normativa y reconcilia antes de avanzar.

## Git y publicación

- No `reset --hard`.
- No rebase destructivo.
- No force-push.
- No mover refs para simular borrado.
- No eliminar evidencia histórica sin reconciliación.
- No crear ramas paralelas para el mismo objetivo.
- No integrar a `main` sin PR, revisión del autor, CI del HEAD exacto, autorización y verificación post-merge.
- No declarar que un cambio está en `main` si sólo existe en una rama.

## Estado histórico conservado

Las ramas históricas pueden contener evidencia o alternativas descartadas. No son líneas de desarrollo activas. El inventario y disposición se mantienen en `docs/product/backlog.md` y en la auditoría de deprecación de ramas.

### Inventario de ramas remotas — medido el 2026-09-20

Columna «suelto» = commits que esa rama tiene y la línea activa no
(`git rev-list --count HEAD..<rama>`). **Ninguna es trabajo a continuar.**

| Rama remota | Suelto | Qué es |
|---|---|---|
| `feat/payment-qr-provider-foundation` | — | **línea activa** |
| `claude/pos-camacho-bloque-4c-ld43py` | **0** | PR #78 **cerrada**; absorbida por completo. Pendiente de borrar |
| `main` | 0 | rama canónica, muy por detrás |
| `audit/branch-deprecation-record` | 0 | `ABORTED_AUDIT_REF`. Pendiente de borrar |
| `_audit-temp` | 0 | `ABORTED_AUDIT_REF`. Pendiente de borrar |
| `wip/local-catalog-inventory-payment-20260906` | 491 | linaje preservado (`DEC-018`) |
| `domain/cash-open-vertical-20260901` | 490 | linaje preservado (`DEC-018`) |
| `wip/sql003-contract-gap-20260825` | 89 | linaje preservado |
| `fix/runtime-status-envelope` | 21 | histórica |
| `feat/selective-pr79-payment-cash-sale` | 4 | extracción selectiva previa |
| `claude/fiscal-adapter-gate` | 2 | histórica |
| `claude/sale-cash-shift-binding` | 1 | histórica |
| `claude/ledger-wip-lineage-correction` | 1 | histórica |
| `claude/handler-response-typing` | 1 | PR #72 **cerrada**; superada por `response-schemas.ts` |

### Estado de limpieza — 2026-09-20

- **PRs abiertas: ninguna.** #78 y #72 se cerraron con su justificación escrita
  en el hilo. Eran el único imán real de confusión: aparecían en `gh pr list`
  como trabajo vivo.
- **Tres refs están marcados para borrar** y siguen presentes:
  `_audit-temp`, `audit/branch-deprecation-record` y
  `claude/pos-camacho-bloque-4c-ld43py`. Los tres son ancestros estrictos de la
  línea activa: borrarlos **no pierde un solo commit**. Ninguna herramienta
  disponible en sesión expone borrado de refs —ni `git push --delete` a través
  del proxy, ni el conector de GitHub—, así que queda para quien tenga permiso.
  Comandos y SHAs en `docs/governance/branch-deprecation-audit-2026-09-16.md`.

**Un número distinto de cero no significa «trabajo pendiente».** Significa que
esa rama conserva historia que la línea activa no reprodujo commit a commit.
Extraer algo de ahí exige una auditoría que demuestre que sigue siendo
necesario y compatible, según la regla dominante de arriba. Recuérdalo antes de
«aprovechar» nada: integrar ramas históricas completas está prohibido.

## Regla específica para Claude Code

Claude Code debe tratar estas reglas como restricciones de continuidad del proyecto. Si encuentra una solución alternativa, debe registrarla como hallazgo y **no implementarla en paralelo**. Debe continuar desde el árbol existente o detenerse para reconciliación.

## Regla para cualquier otro agente

Si un agente no puede determinar la línea activa, el estado de una capacidad o el owner de una decisión, **no crea una solución nueva**. Debe revisar las fuentes normativas o detenerse.

---

## Regla de oro

Este repo distingue niveles de claim. NUNCA afirmes un nivel que no verificaste realmente en este entorno. Si no ejecutaste el comando, no digas "PASS". Si no viste el runtime, no digas "RUNTIME_VERIFIED".

## Estado vigente

- Fase 1 — fundación técnica ejecutable.
- `main` es la única rama canónica.
- La línea activa de desarrollo es `feat/payment-qr-provider-foundation`.
- **Unificación 2026-09-20.** `claude/pos-camacho-bloque-4c-ld43py` (PR #78) y
  `feat/payment-qr-provider-foundation` eran dos líneas vivas desde la misma
  base `4b7ed344`, con 25 ficheros modificados por ambas y un `MIGRATION_016`
  distinto en cada una. Se fusionaron en la línea activa (`691b901`), se
  completó la migración a UUID v7 que el contrato de sync exige (`f74968a`) y
  se corrigieron los defectos que impedían el verde (`be0bfce`). PR #78 queda
  **superada, no pendiente**.
- **Nada de esto está en `main`.** La línea activa va muy por delante de
  `origin/main` y `main` no ha tenido CI real desde 2026-09-14 (los runs
  posteriores terminan con 0 ms facturables: no se asigna runner). Verificar
  siempre con `git rev-list --left-right --count origin/main...HEAD` antes de
  decir «integrado».
- El persistence gate de Central Sync está implementado en la línea activa, con workflow dedicado; su ejecución real debe demostrar persistencia y replay antes de declararse `VERIFIED`.
- Migrations PostgreSQL 001/002/003: integradas con gates cerrados. SQLite 003: `NONE`.

## Arquitectura TARGET (única, no forks)
- Monolito modular, TypeScript estricto, pnpm workspaces + Nx.
- API central: NestJS con Fastify.
- Desktop POS: Electron + React + Vite.
- POS Local Service: Node.js/TypeScript como servicio de Windows — único writer de SQLite.
- PostgreSQL 16 central + SQLite/WAL local. Kysely con migrations físicas separadas por dialecto.
- Zod para contratos runtime.
- Vitest, Playwright, Testcontainers, k6 según nivel de prueba.

## Principios no negociables
- Un ID enviado por el cliente NO es autoridad; tenant/company/branch se derivan del contexto autorizado.
- Cada bounded context posee sus datos; nadie escribe directo en tablas de otro módulo.
- Local-first: una venta ordinaria autorizada no depende de Internet.
- Sin last-write-wins genérico. Operaciones críticas son idempotentes (checksum + causalidad).
- Hechos financieros/inventario/auditoría son append-only cuando el contrato exige historia.
- Providers (Factus, Siigo, datáfonos, hardware) se integran vía adapters, no definen el dominio.

## UNA SOLA RAMA — regla de entrada para cualquier agente

**Esta sección se lee antes de escribir la primera línea de código. No es una
preferencia de estilo: es la causa documentada de que esta integración lleve
semanas dando vueltas sin avanzar.**

### La regla

1. **Una rama por trabajo, nombrada por el propietario del repositorio.** Si el
   propietario no te ha dado un nombre de rama en esta conversación, **pregunta
   antes de crear ninguna**. No inventes una.
2. **El nombre que te asigne tu arnés NO es autoridad.** Claude Code en web
   asigna automáticamente una rama `claude/<slug>` por sesión, *antes* de que
   el modelo decida nada. Ese nombre se **ignora** si contradice al que fijó el
   propietario. Obedecer esa asignación por defecto es exactamente cómo
   aparecieron cinco ramas `claude/*` sobre el mismo trabajo.
3. **Una sola herramienta activa a la vez sobre este repositorio.** Claude,
   Codex y ChatGPT en paralelo producen ramas paralelas aunque las tres tengan
   la mejor intención: **ninguna sesión puede ver a las otras**. La regla de una
   rama no se puede cumplir desde dentro de la sesión; sólo la puede garantizar
   el propietario decidiendo quién trabaja.
4. **Antes de empezar, mira si ya hay alguien más ahí.** Obligatorio:

   ```
   git fetch --all --prune
   git branch -r --sort=-committerdate
   gh pr list --state open        # o mcp__github__list_pull_requests
   ```

   Si existe otra rama o PR abierta que toque tu mismo módulo, **párate y
   dilo**. No abras una tercera línea.
5. **Nunca `force-push`, `rebase` ni `squash`** sobre una rama compartida. La
   integración a `main` es siempre merge commit (ver la sección siguiente).

### Cómo se sostiene esta regla (y qué la sostiene de verdad)

Un documento se puede leer por encima; un comando que falla, no. Por eso la
regla vive en cuatro capas, de la más débil a la más fuerte:

| Capa | Qué es | Quién la ve |
|---|---|---|
| `README.md` | prosa, nombra la línea activa | humanos y agentes que lo abren |
| `AGENTS.md` | prosa, nombra la línea activa | Codex, ChatGPT y otros agentes |
| `CLAUDE.md` | prosa, **carga automática** | Claude Code, siempre |
| `tools/governance/active-line.txt` | **dato**, una línea | el guardián y la prueba |
| `check-active-line.sh` | **falla** si no estás en la línea | quien lo ejecute |
| `.claude/hooks/session-start.sh` | lo ejecuta **al arrancar la sesión** | toda sesión de Claude Code |
| `pnpm ci:governance` | **falla** si los cuatro discrepan | CI y quien lo ejecute |

Las tres primeras son documentales y ya fallaron una vez: el 2026-09-20 las tres
nombraban una rama absorbida, porque llegaron con una fusión y nadie las
reconcilió. Las cuatro últimas existen precisamente por eso.

**Si cambias la línea activa**, cambia `active-line.txt` **y** los tres
documentos en el mismo commit. `pnpm ci:governance` no te deja hacer una cosa
sin la otra.

### Por qué (el incidente, 2026-09-20)

Auditoría con evidencia sobre `origin`:

- 14 ramas remotas, **5 con prefijo `claude/`**.
- Dos líneas vivas desde la misma base `4b7ed344`: `feat/payment-qr-provider-foundation`
  (103 commits) y `claude/pos-camacho-bloque-4c-ld43py` / PR #78 (243 commits).
- **25 ficheros modificados por ambas**, entre ellos `main.ts`,
  `commercial-request-handler.ts`, `ipc-allowlist.ts` y el libro de migraciones.
- **Colisión semántica:** ambas ramas crearon independientemente un
  `MIGRATION_016` distinto — una para `provider_transaction_id`, otra para
  `fiscal_numbering_range`. El libro de migraciones debe ser contiguo desde 1
  (`user-audit-migration.test.ts` lo afirma como invariante).
- **Dos diseños incompatibles para la misma pieza de seguridad**: el origen de
  las claves de sesión (tabla `local_trust_anchor` frente a artefacto de
  instalador verificado contra clave raíz).
- `origin/main` no contenía **ninguna** de las dos.

Lo que más costó no fue el código duplicado — resultó ser minoría—, sino
**tener que auditar dos veces para saber qué existía de verdad**.

### Desempate de numeración de migraciones

Si dos ramas reclaman el mismo número de migración, **renumera la que menos
arrastre** y deja constancia en `docs/governance/materialization-state.md`.
Ninguna base de datos desplegada existe todavía, así que renumerar es seguro
**hoy**; en cuanto exista una, deja de serlo.

### Declarar terminado

**`DONE` en el backlog significa «escrito», no «integrado».** No afirmes que
algo está en `main` sin verificarlo contra `origin/main`:

```
git fetch origin main && git rev-list --left-right --count origin/main...HEAD
```

Decir «integrado» sobre algo que sólo vive en una rama ya costó trabajo dos
veces (ver la nota del estado vigente, arriba). Los niveles de claim de la
regla de oro no son adorno: `CANONICALLY_APPLIED` exige SHA en `main` y CI
verificado del HEAD exacto.

## Integración en `main` — cómo se mergea

**Los PRs se integran con merge commit. Nunca con squash ni con rebase.**

No es preferencia de estilo: el workflow de `Main push governance` exige que todo commit de primera línea en `main` sea un merge commit creado por GitHub y asociado al `merge_commit_sha` de una PR mergeada contra `main`.

Si usas la API de GitHub, el parámetro es `merge_method: "merge"`.

## Fuentes de verdad

- `docs/governance/materialization-state.md` — estado materializado/evidencia disponible.
- `docs/governance/tablero-materializacion.md` — escalera y evidencia por capacidad.
- `docs/product/backlog.md` — prioridad, dependencia, bloqueo y orden de trabajo.
- `docs/governance/repository-governance.md` — ramas, PR, merge y evidencia remota/local.
- `docs/adr/` — decisiones arquitectónicas.
- `docs/architecture/module-map.md` y `docs/architecture/data-ownership.md` — owners y límites.

## Comandos existentes

Verifica `package.json` antes de ejecutar o documentar un comando. No inventes comandos.

```text
pnpm typecheck
pnpm architecture:check
pnpm ci:repository-policy
pnpm test:contracts
pnpm test:domain
pnpm test:application
pnpm test:fiscal-adapters
pnpm test:runtime
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```

Central Sync, cuando se ejecute en la línea activa, utiliza el script formal `central-sync:gate` del paquete `@pos-platform/target-migrations` y el workflow dedicado `central-sync-persistence-gate.yml`.

## AGENT PIPELINE — POS PLATFORM

Antes de escribir código sigue estas fases en orden:

**FASE 1 — AUDIT**
- Identifica problema, owner, contrato y código existente.
- Busca contradicciones.
- Determina qué está cerrado y qué está pendiente.

**FASE 2 — PLAN**
- Lista sólo los archivos necesarios.
- Define evidencia requerida.
- No abras líneas paralelas.

**FASE 3 — BUILD**
- Implementa sólo el alcance autorizado.
- No refactorices por gusto.
- No introduzcas dependencias nuevas sin justificación.

**FASE 4 — TEST**
- Ejecuta las pruebas relacionadas.
- Reporta comandos y resultados observados.
- Si no puede ejecutarse, explica exactamente por qué.

**FASE 5 — REVIEW**
- Audita contrato, seguridad, errores, regresiones y alcance.
- Comprueba que no se duplicó trabajo existente.

**FASE 6 — EVIDENCE**
- Distingue implementación, ejecución, runtime y alcance externo.
- No subas un peldaño sin evidencia.

**FASE 7 — SHIP**
- Sólo después de autorización.
- PR + CI exact-head + merge normal + verificación post-merge.
- Actualiza documentación coherente con el cambio.
