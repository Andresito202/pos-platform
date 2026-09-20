# Camacho POS Colombia (pos-platform)

Plataforma POS modular, multi-tenant, local-first para retail colombiano.
Identidad comercial: `Camacho POS Colombia`. Identificadores técnicos: `pos-platform`, `@pos-platform/*`.

## Regla de oro
Este repo distingue niveles de claim: `DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`,
`CANONICALLY_APPLIED`, `PRODUCTION_READY`. NUNCA afirmes un nivel que no verificaste
realmente en este entorno. Si no ejecutaste el comando, no digas "PASS". Si no viste el
runtime, no digas "MATERIALIZED".

## Estado vigente (revisar docs/product/backlog.md para el estado real, esto puede quedar desactualizado)
- Fase 1 — fundación técnica ejecutable. `apps/` y `packages/` del TARGET ya existen (verificado 2026-09-01):
  `apps/pos-local-service`; `packages/{application,contracts,database-core,database-postgres,database-sqlite,domain,observability,testing}`.
- `main` es la única rama canónica. Sin branch protection nativa → toda integración es por
  PR + SHA esperado + CI del HEAD exacto + verificación post-merge (ver docs/governance/repository-governance.md).
- Migrations PostgreSQL 001/002/003: integradas con gates cerrados. SQLite 003: `NONE`.
- Un RT marcado `DONE` en el backlog referido a un PR (p.ej. "RT-005 = DONE ... en PR #19") describe el estado
  del trabajo en esa rama/PR, NO que ya está mergeado a `main`. Verificar merge real con
  `gh pr view <N> --json state,mergedAt` antes de asumir integración — no inferirlo del backlog.

## Arquitectura TARGET (única, no forks)
- Monolito modular, TypeScript estricto, pnpm workspaces + Nx.
- API central: NestJS con Fastify.
- Desktop POS: Electron + React + Vite.
- POS Local Service: Node.js/TypeScript como servicio de Windows — único writer de SQLite.
- PostgreSQL 16 central + SQLite/WAL local. Kysely con migrations físicas separadas por dialecto.
- Zod para contratos runtime (cuando TECH-003 se materialice).
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

No es preferencia de estilo: el workflow ejecuta `Main push governance`
(`tools/ci/validate-main-push-history.sh`), que exige que **todo commit de
primera línea en `main` sea un merge commit creado por GitHub** y sea el
`merge_commit_sha` de un PR mergeado contra `main`. Un squash produce un commit
de un solo padre y el gate lo rechaza:

```
main introduced non-merge commit <sha>.
Direct pushes and squash/rebase merges are not accepted.
```

Ocurrió el 2026-09-06 con los PRs #42 y #43 y dejó `main` en rojo. Son los dos
únicos commits de la historia que incumplen el control; el incidente está en
`docs/governance/materialization-state.md`. La historia no se reescribe: el
siguiente merge correcto devuelve `main` a verde, pero la cicatriz queda.

Si usas la API de GitHub, el parámetro es `merge_method: "merge"`.

## Fuentes de verdad (léelas antes de proponer cambios grandes)
- **`docs/governance/materialization-state.md`** — qué existe de verdad en `main`, con ruta y comando de prueba. **Búscalo ahí antes de proponer construir algo.**
- docs/adr/DEC-017 (arquitectura canónica) · docs/adr/DEC-018 (linaje preservado: leerlo antes de tocar Catalog o Inventory)
- docs/product/brand.md · docs/product/backlog.md · docs/governance/repository-governance.md
- docs/README.md (índice) · docs/architecture/module-map.md · docs/architecture/data-ownership.md

> El backlog marca `DONE` cuando el caso de uso está **escrito**, no implementado.
> Ese malentendido costó trabajo dos veces. Cuando backlog y ledger discrepen,
> manda el código.

## Comandos existentes
Verificados contra `package.json`. No inventes comandos que no estén ahí.

```
pnpm typecheck                 # los 10 proyectos
pnpm architecture:check        # ARCH-003: capas, boundaries y áreas congeladas
pnpm ci:repository-policy      # escaneo de secretos en archivos rastreados

pnpm test:contracts            pnpm test:domain
pnpm test:application          pnpm test:fiscal-adapters
pnpm test:runtime              pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```

Cadena de suministro: `ci:supply-chain-tests`, `ci:dependency-inventory`,
`ci:vulnerability-audit`, `ci:sbom`, `ci:license-gate`. Los dos últimos exigen
`GITHUB_SHA` exportado; sin él fallan por contrato, no por regresión.

## AGENT PIPELINE — POS PLATFORM

Antes de escribir cualquier código sigue estas fases en orden.
No saltes fases. No declares una fase completa sin evidencia.

**FASE 1 — SPEC**
- Define qué problema resuelve el cambio
- Identifica los módulos afectados
- Lista las dependencias y consumidores
- Documenta los criterios de aceptación

**FASE 2 — PLAN**
- Lista los archivos que se van a crear o modificar
- Identifica riesgos
- Define el orden de ejecución
- Estima impacto en otros módulos

**FASE 3 — BUILD**
- Implementa solo lo necesario para el objetivo actual
- No refactorices por gusto
- No introduzcas dependencias nuevas sin justificación
- Sigue la arquitectura establecida del proyecto

**FASE 4 — TEST**
- Ejecuta las pruebas existentes relacionadas
- Agrega tests para el nuevo comportamiento
- Reporta el comando ejecutado y el resultado observado
- Si un test no puede ejecutarse indica la razón exacta

**FASE 5 — REVIEW**
- Verifica que el código cumple los criterios de aceptación
- Confirma que no rompe módulos existentes
- Revisa seguridad en cualquier endpoint o dato sensible
- Verifica manejo de errores

**FASE 6 — SIMPLIFY**
- Elimina código muerto o redundante introducido
- Verifica que los nombres son claros
- Confirma que la lógica es la mínima necesaria

**FASE 7 — SHIP**
- Confirma que CI pasa
- Verifica el diff final contra main
- Documenta el cambio en el archivo correspondiente
- Indica el estado: MATERIALIZED / TESTED / REVIEWED

### Estados de evidencia

Usa siempre estas categorías y nunca declares algo terminado sin evidencia:

- `DOCUMENTED` = existe documentación específica
- `MATERIALIZED` = existe implementación que cumple la condición
- `TESTED` = fue ejecutado y se observó el resultado
- `REVIEWED` = una persona revisó y aprobó
- `CANONICALLY_APPLIED` = está en main con CI verificado
- `PRODUCTION_READY` = validado en entorno de producción
- `NOT_EVALUATED` = no hay evidencia suficiente
- `REQUIRES_LOCAL_VERIFICATION` = necesita verificación manual

## Política de uso de modelos

- Usa el modelo de mayor capacidad disponible para decisiones críticas de arquitectura y seguridad.
- Usa modelos de menor costo/capacidad para tareas mecánicas cuando sean suficientes.
- Nunca reduzcas la capacidad del modelo cuando pueda comprometer seguridad, autenticación,
  autorización, dinero, pagos, IPC o arquitectura.
- No repitas análisis completo del repositorio si el contexto ya está establecido.
- Investiga de nuevo solo cuando exista incertidumbre real, contradicción, riesgo de seguridad,
  migración o cambio arquitectónico.
