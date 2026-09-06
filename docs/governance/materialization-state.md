# Estado de materialización — fuente única

## Propósito

Este documento existe porque el proyecto perdió trabajo dos veces por la misma
causa: **`DONE` en `docs/product/backlog.md` significa "el caso de uso está
escrito", y se leyó como "está implementado".**

Aquí `MATERIALIZED` significa una sola cosa: **existe código en `main` y esta
tabla dice en qué ruta está.** Una fila sin ruta verificable no puede declararse
materializada.

No reemplaza al backlog: el backlog prioriza y describe intención, este
documento registra evidencia. Cuando ambos discrepen, **manda el código**.

## Cómo se usa

Antes de proponer construir algo, búscalo aquí. Si la columna `Código en main`
tiene una ruta, ya existe: léela antes de escribir nada.

Al cerrar un bloque, se actualiza la fila correspondiente con la ruta real y el
comando de prueba ejecutado. No se marca una fila por anticipado.

## Convenciones

`DOC` documentación específica · `MAT` código en `main` · `TEST` prueba que
ejecuta el comportamiento · `CANON` integrado en `main` con CI verde ·
`PROD` validado en producción.

`—` significa que no existe, no que esté pendiente de verificar.

## Estado verificado sobre `6bdaf59` (2026-09-06)

### Núcleo comercial local

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| Sales V1 (venta → `READY_FOR_PAYMENT`) | ✅ | ✅ | ✅ | ✅ | ❌ | `apps/pos-local-service/src/sales/` · `MIGRATION_010` |
| Cash V1 (apertura/cierre de turno) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/cash/` · `MIGRATION_009` |
| Payments V1 (`CASH`, `TRANSFER`, cobertura) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/payments/` · `MIGRATION_011` |
| Completado de venta (único punto) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../payments/sqlite-payment-store.ts` → `completeSaleIfCovered` |
| Frontera Payments↔Cash | ✅ | ✅ | ✅ | ✅ | ❌ | `.../payments/cash-port.ts` |

> **Corrección de estado, 2026-09-06.** Payment V1 figuraba aquí como
> `CANONICALLY_APPLIED` desde `BLOQUE 4E`, y lo era en handler y
> persistencia, pero **no era alcanzable por el transporte de producción**:
> los cinco `payment.*` faltaban en el `switch` de enrutamiento y cada
> intento terminaba en `socket.destroy()`. Cerrado por PR #37. La lección
> que deja: «materializado» y «alcanzable de extremo a extremo» son
> propiedades distintas, y una fila de esta tabla debe acreditar la
> segunda cuando la capacidad se expone por un transporte.

### Plataforma local

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| SQLite `MIGRATION_001..011` | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/database-sqlite/src/local-database.ts` |
| Idempotencia (`runtime_operations`) | ✅ | ✅ | ✅ | ✅ | ❌ | `MIGRATION_001` · `.../operations/` |
| Identidad de dispositivo y licencia (tablas) | ✅ | ✅ | ✅ | ✅ | ❌ | `MIGRATION_003` |
| Auditoría append-only | ✅ | ✅ | ✅ | ✅ | ❌ | `MIGRATION_005` + triggers |
| Outbox / inbox / checkpoint / dead-letter | ✅ | ✅ | ✅ | ✅ | ❌ | `.../sync/durable-sync-store.ts` · `MIGRATION_004` |
| SSA y binding de sesión | ✅ | ✅ | ✅ | ✅ | ❌ | `.../session/` · `MIGRATION_007` |
| Proyección de autorización | ✅ | ✅ | ✅ | ✅ | ❌ | `.../authorization/` · `MIGRATION_006` |
| Master snapshot | ✅ | ✅ | ✅ | ✅ | ❌ | `.../master-data/` · `MIGRATION_009` |
| Canal IPC comercial (14 tipos) | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/contracts/src/ipc*.ts` · `.../commercial/` |
| Enrutamiento del canal → superficie comercial | ✅ | ✅ | ✅ | ✅ | ❌ | `.../channel/local-channel-component.ts` · `tests/channel-routing.test.ts` (Windows) |
| Shell Electron (main, preload, allowlist) | ✅ | ✅ | ✅ | ✅ | ❌ | `apps/pos-desktop/src/` |
| Logger estructurado | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/observability/src/` |

### Plataforma central

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| PostgreSQL migrations 001/002/003 | ✅ | ✅ | ✅ | ✅ | ❌ | `tools/target-migrations/sql/postgres/` |
| Esquema fiscal (10 tablas `fiscal.*`) | ✅ | ✅ | ❌ | ✅ | ❌ | `003_fiscal_electronic_invoicing_foundation.up.sql` |
| Aplicación central que use ese esquema | ✅ | ❌ | ❌ | ❌ | ❌ | — (`packages/database-postgres/src` vacío) |

### CI/CD y cadena de suministro

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| Validación TARGET (5 jobs) | ✅ | ✅ | ✅ | ✅ | ❌ | `.github/workflows/target-foundation-validation.yml` |
| CodeQL SAST | ✅ | ✅ | ✅ | ✅ | ❌ | `.github/workflows/codeql-sast.yml` |
| SBOM · licencias · vulnerabilidades · provenance | ✅ | ✅ | ✅ | ✅ | ❌ | `tools/ci/` |
| Strix (pentest AI) | ✅ | ✅ | ❌ | ✅ | ❌ | `.github/workflows/security.yml` — sin `STRIX_LLM`/`LLM_API_KEY` |

### Materializado pero no conectado al runtime

Existe código probado que **`main.ts` nunca instancia**. No es trabajo
pendiente: es trabajo hecho y desconectado.

| Capacidad | Código en main | Evidencia de desconexión |
|---|---|---|
| Ciclo de seguridad local (DPAPI, identidad de dispositivo, licencia) | `.../src/security/` | `LocalSecurityLifecycle` solo se instancia en `tests/security.test.ts` |
| Adquisición de snapshot de autorización (SAS-003) | `.../authorization/snapshot-acquisition.ts` | cero referencias fuera del propio archivo |
| Esquema fiscal central | `003_*.up.sql` | ningún consumidor |

### Documentado, no materializado

Ninguna de estas capacidades tiene código en `main`, **independientemente de lo
que declare el backlog**.

| Capacidad | Backlog dice | Realidad en código |
|---|---|---|
| Catalog | `CAT-001 = DONE` | solo `sandbox_catalog_product`, poblado únicamente por tests |
| Pricing | `PRICE-001/002 = DONE` | solo `sandbox_price_rule` |
| Tax | `TAX-001/002/003 = DONE` | `tax_snapshot` es TEXT congelado; sin motor |
| Inventory | `INV-001/002 = DONE` | — |
| Customer / adquiriente | `CUST-001 = PLANNED` | — (ninguna tabla ni columna) |
| SaleReturn, notas crédito/débito | documentado | — |
| API central | documentado | — (`apps/` solo tiene 2 aplicaciones) |
| Transporte local↔central | documentado | — (sin cliente HTTP saliente) |
| Adapters de proveedor fiscal | documentado | — |
| Contingencia y reconciliación fiscal ejecutables | documentado | — |
| Instalador NSIS y firma de código | `DEC-010` | — (`electron-builder` ausente del lockfile) |
| Periféricos POS | documentado | — |
| E2E Playwright | configurado | `apps/pos-desktop/e2e/` sin un solo spec |
| `SEC-G01..G10` | `PLANNED` | — |

## Deuda registrada

| # | Deuda | Evidencia | Consecuencia si no se atiende |
|---|---|---|---|
| D-1 | `local_sync_outbox` no tiene purga ni retención | cero `DELETE` en `durable-sync-store.ts` | crecimiento monótono del archivo SQLite en uso real |
| D-2 | Sin transporte, todo queda `PENDING` de forma permanente | sin cliente HTTP saliente | ningún hecho comercial sale del dispositivo |
| D-3 | La regla que traduce permiso de matriz de producto a forma canónica sólo está escrita caso por caso | `DEC-012` §33.2 la enuncia para `CASH_SHIFT_CLOSE`; no existe enunciado general | cada módulo nuevo la redescubre o la contradice |
| D-4 | `packages/database-core`, `database-postgres` y `testing` declarados con `src/` vacío | `module-boundaries.json` vs `find` | boundaries que no gobiernan nada |
| D-5 | `fiscal_total_amount` en `sales_sales` es pricing, no facturación electrónica | `sale-calculation.ts` | lectura errónea de soporte fiscal inexistente |
| D-6 | Numeración comercial (`sales_document_series_counter`) no es numeración fiscal | esquema | reutilizarla violaría la autorización DIAN |
| D-7 | ~~El `switch` de enrutamiento no tiene `default`~~ · **CERRADA 2026-09-06** | rama `default` con asignación a `never` en `local-channel-component.ts` | — |

Corrección de `D-3`, 2026-09-06. La redacción original afirmaba que los permisos
fiscales documentados en minúscula «serían rechazados por el contrato». **Era
falso.** `permission-matrix.md` usa minúscula con puntos para *todos* los
permisos —`authorization.policy.create_draft`, `cash.count.abort`,
`cash.shift.close`—, y `DEC-012` §33.2 documenta la correspondencia:
`CASH_SHIFT_CLOSE` es la forma canónica de `cash.shift.close`. Son dos espacios
de nombres deliberados, no una incompatibilidad. Lo que sí falta, y es lo que
la fila registra ahora, es un enunciado general de esa regla: hoy sólo existe
caso por caso.

Sobre `D-7`: la corrección de PR #37 resolvió la instancia —los cinco `payment.*`
sin `case`— pero no la clase. Un tipo nuevo en el contrato podía volver a caer en
silencio, y el único guardián era una prueba que sólo corre en Windows. La rama
`default` con asignación a `never` convierte ese olvido en **error de
compilación**: verificado quitando `case "payment.cancel"` y observando
`TS2322: Type '{… message_type: "payment.cancel" …}' is not assignable to type
'never'`. La garantía pasó de una prueba de una plataforma a una propiedad del
tipo, comprobada en cada `pnpm typecheck`.

## Linaje archivado

`archive/cash-hexagonal-20260902` → `503aeb141ee323c822e5c95ad86022dbdb8f0f8a`

Arquitectura hexagonal detenida el 2026-09-02: dominio puro, casos de uso con
puertos, adaptadores PostgreSQL, migración `004_cash_foundation` y 16 suites de
prueba. **No integrable** por colisión de identidad de migraciones (`DEC-017` §3).

Consultable como referencia de diseño para `Catalog`, `Inventory`, `CashCount` y
`CashDifferenceReview`. Prohibido integrarlo por merge o `cherry-pick`.
