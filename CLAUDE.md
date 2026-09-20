# Camacho POS Colombia (pos-platform)

## REGLA DOMINANTE — UNA SOLA LÍNEA DE DESARROLLO

Este repositorio no acepta desarrollo paralelo por iniciativa de una IA.

- **Línea activa vigente:** `claude/pos-camacho-bloque-4c-ld43py`
- **Rama canónica del producto:** `main`
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
- La línea activa de desarrollo es `claude/pos-camacho-bloque-4c-ld43py`.
- PR #78/D-2 es trabajo de la línea activa y todavía no debe describirse como integrado en `main` hasta merge + verificación post-merge.
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
