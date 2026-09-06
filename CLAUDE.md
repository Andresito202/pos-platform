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

## Fuentes de verdad (léelas antes de proponer cambios grandes)
- docs/product/brand.md · docs/product/backlog.md · docs/governance/repository-governance.md
- docs/README.md (índice) · docs/architecture/module-map.md · docs/architecture/data-ownership.md

## Comandos existentes
```
pnpm typecheck
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
```
No inventes comandos que no estén en package.json/nx.json — verifica antes de sugerir uno nuevo.

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
