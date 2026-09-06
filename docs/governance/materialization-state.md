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

### Plano fiscal

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| Cinco puertos por capacidad | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/fiscal-adapters/src/ports/` |
| Declaración tipada de credencial (`D-3`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/credential.ts` |
| Matriz de capacidades y verificación cruzada | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/capability.ts` · `.../src/adapter-declaration.ts` |
| Escalera de verificación (`D-4`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/verification.ts` |
| Saldo de bolsa como proyección (`D-5`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/quota.ts` |
| Adapter de cualquier proveedor | ✅ | ❌ | ❌ | ❌ | ❌ | — |

> **Qué acredita esta sección y qué no.** Acredita que las cinco formas existen,
> compilan, y que un solo objeto puede satisfacerlas: `port-conformance.test.ts`
> implementa los cinco puertos con un fake determinista. Acredita también que la
> forma admite los **tres** contratos de proveedor, no sólo FACTUS:
> `provider-contracts.test.ts` construye las declaraciones de SIIGO, FACTUS y
> ALEGRA desde `provider-integration-matrix.md` y comprueba que ninguna se
> contradice.
>
> **No acredita compatibilidad con ningún proveedor.** Los tres siguen en
> `NOT_EVALUATED`, y la propia escalera lo impone: un fake determinista tiene
> techo `MOCK_TESTED`, verificado en `verification-and-quota.test.ts`. Ninguna
> línea de este bloque abre una conexión de red.
>
> Comando ejecutado: `pnpm test:fiscal-adapters` — 47 pruebas, 0 fallos.
> Cableado en CI como paso «Validate fiscal capability ports».

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
que declare el backlog**. `main` es la única referencia de esta tabla: `Catalog`,
`Inventory` y el dominio de `Payment` sí tienen código, pero en el linaje
preservado que documenta la sección siguiente, no en `main`.

| Capacidad | Backlog dice | Realidad en código |
|---|---|---|
| Catalog | `CAT-001 = DONE` | en `main`: solo `sandbox_catalog_product`, poblado únicamente por tests. Existe implementación completa en `wip/local-catalog-inventory-payment-20260906` (ver «Linaje preservado») |
| Pricing | `PRICE-001/002 = DONE` | solo `sandbox_price_rule` |
| Tax | `TAX-001/002/003 = DONE` | `tax_snapshot` es TEXT congelado; sin motor |
| Inventory | `INV-001/002 = DONE` | en `main`: nada. Existe implementación completa en `wip/local-catalog-inventory-payment-20260906` (ver «Linaje preservado») |
| Customer / adquiriente | `CUST-001 = PLANNED` | — (ninguna tabla ni columna) |
| SaleReturn, notas crédito/débito | documentado | — |
| API central | documentado | — (`apps/` solo tiene 2 aplicaciones) |
| Transporte local↔central | documentado | — (sin cliente HTTP saliente) |
| Adapters de proveedor fiscal | documentado | puertos y declaración en `packages/fiscal-adapters/`; **ningún adapter** |
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
| D-8 | ~~`Catalog`, `Inventory` y el dominio de `Payment` en un linaje no integrable~~ · **CERRADA 2026-09-06 por `DEC-018`** | rama reclasificada como referencia de diseño; `frozenSourceAreas` en `module-boundaries.json` lo impone en CI | — |

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

## Incidente de gobierno de `main` — 2026-09-06

`main` quedó en rojo tras mergear #43, y la causa **no fue el diff**: fue el
método de merge que usé.

El workflow tiene un control compensatorio, `Main push governance`, que exige
que **todo commit de primera línea en `main` sea un merge commit** creado por
GitHub y sea el `merge_commit_sha` de un PR mergeado contra `main`
(`tools/ci/validate-main-push-history.sh`). Mergeé #42 y #43 con *squash*, que
produce un commit de un solo padre. El gate los rechazó:

```
main introduced non-merge commit 57a4703149b2dd1a6f2039568498a67b20e743ab.
Direct pushes and squash/rebase merges are not accepted.
```

Verificado sobre `origin/main`: los PRs #36 a #41 tienen dos padres cada uno y
pasaron el gate; `8850179` (#42) y `57a4703` (#43) tienen uno solo. Son los dos
únicos commits de la historia de `main` que incumplen el control, y los dos son
míos. Contradice además una instrucción explícita del propietario: «un solo PR
no significa squash obligatorio, conservar la trazabilidad».

**Qué se corrige y qué no.** El gate valida el rango introducido por cada push,
así que el siguiente merge correcto devuelve `main` a verde. Eso es lo que se
hace. Lo que **no** se corrige es la historia: los dos commits siguen ahí, y
reescribir `main` es destructivo y no se hace sin autorización expresa del
propietario. Queda como cicatriz registrada, no como problema resuelto.

Regla operativa que se deriva: en este repositorio los PRs se integran con
**merge commit**, nunca con squash ni rebase.

## Linaje preservado — hallazgo del 2026-09-06

La auditoría forense concluyó que `Catalog` e `Inventory` «no existen». **Era
cierto del remoto y falso del disco del propietario.** Al preparar la publicación
de la etiqueta de archivado apareció un volumen grande de trabajo sin commitear
sobre `domain/cash-open-vertical-20260901`. Se preservó antes de tocar nada:

`wip/local-catalog-inventory-payment-20260906` → `a10249fe5c48c7e1e162b3cc2ee2264ae09485ef`
· 145 archivos, 14 654 inserciones · publicado en el remoto.

### Qué contiene

| Área | Contenido |
|---|---|
| Catalog | `product`, `product-identifier`, `product-presentation`, `product-variant`, `variant-attributes`, `unit-conversion`, `conversion-factor`, 6 eventos de dominio, repositorios SQLite y PostgreSQL, casos de uso `create-product`, `update-product`, `deactivate-product`, `define-conversion`, con pruebas |
| Inventory | `inventory-movement`, `inventory-reservation`, `inventory-transfer`, `inventory-transfer-line`, `lot`, `on-hand-quantity`, `stock-balance`, 6 eventos, repositorios, 9 casos de uso (reserva, consumo, liberación, ajuste, merma, y el ciclo completo de traslado), con pruebas |
| Payment | dominio `payment`, `payment-attempt`, `payment-method`, `merchant-collection-identifier`, 4 eventos, puertos de autorización y autenticidad, casos de uso `initiate-payment` y `confirm-payment` |
| Migraciones | `005_catalog_foundation` y `006_inventory_foundation` (PostgreSQL), con pruebas |

### Por qué no se integra por merge, y qué se decidió

Verificado sobre el remoto el 2026-09-06:

```
git merge-base --is-ancestor 503aeb141ee323c822e5c95ad86022dbdb8f0f8a \
  origin/wip/local-catalog-inventory-payment-20260906   →   cierto
```

La rama **desciende del linaje hexagonal archivado**. `DEC-017` §4.4 prohíbe
integrarlo por merge o `cherry-pick`, y la razón es medible:

| Plano | Estado | Evidencia |
|---|---|---|
| PostgreSQL `001`–`003` | **idénticos byte a byte** a `main` | comparación de blob SHA |
| PostgreSQL `004`–`006` | **no existen en `main`** — adición pura, sin colisión de numeración | `git ls-tree` de ambas ramas |
| SQLite `MIGRATION_001`–`010` | **los diez divergen** del cuerpo homónimo en `main` | SHA-256 por cuerpo de migración |

La colisión de identidad de `DEC-017` §3 es **exclusivamente del plano SQLite**.
Diez migraciones comparten número y difieren en contenido: mezclarlas rompería
el linaje de checksums de cualquier base instalada. En PostgreSQL no hay
colisión: `004`, `005` y `006` son números libres en `main`.

De ahí se sigue que **el rescate no es una decisión única sino dos**, y tienen
coste muy distinto:

1. **Dominio y aplicación puros** (`packages/domain/src/{catalog,inventory,payment}`,
   casos de uso y sus pruebas) no tocan migraciones. Su obstáculo es de forma
   arquitectónica —puertos hexagonales frente al patrón canónico de `DEC-017`—
   no de identidad de migraciones.
2. **Persistencia SQLite** (`packages/database-sqlite/src/sqlite-*-repository.ts`)
   sí depende del esquema divergente y **no es portable tal cual**: requiere
   migraciones nuevas `MIGRATION_012` en adelante sobre el esquema de `main`.

**Decidido en `DEC-018` (2026-09-06): no se porta código, ninguna de las dos.**

Tres hallazgos lo forzaron, y el primero invalida la recomendación previa de
«rescatar el dominio puro»:

1. `Payment` y `Cash` del linaje **duplican capacidades que `main` ya tiene
   canónicas y probadas de extremo a extremo**. Su `PaymentMethod` es más ancho
   —nueve métodos frente a dos—, pero más ancho sobre el papel no es más
   avanzado.
2. Los 30 archivos de dominio del linaje dependen de `../money.js`,
   `../quantity.js`, `../tenant-scope.js`, `../company-scope.js` y
   `../actor.js`, **ninguno de los cuales existe en `main`**. `main` implementa
   el dinero como funciones en `apps/pos-local-service/src/payments/money.ts`.
   Misma invariante, dos representaciones — y `DEC-017` §3 ya registró que un
   segundo modelo de dinero «introduciría dos verdades sobre el mismo importe».
3. `DEC-017` §4.2 **prohíbe expresamente** ampliar `packages/domain` y
   `packages/application`, que es justo lo que el porte exigiría.

La rama se reclasifica a **referencia de diseño**, mismo estatus que el linaje
archivado. Se conserva como la especificación más detallada que existe de
`Catalog`, `Inventory` y de los siete métodos de pago que `main` no soporta.
`Catalog` e `Inventory` se implementarán en `apps/pos-local-service/src/` con la
representación monetaria de `main` y migraciones desde `MIGRATION_012`.

**Prohibido:** reimplementar `Catalog` o `Inventory` desde cero sin haber leído
antes esta rama. Y ya no depende de que alguien lo recuerde: `frozenSourceAreas`
en `module-boundaries.json` hace fallar CI si aparece un área nueva bajo el
`src/` de esos dos paquetes.

## Linaje archivado

`archive/cash-hexagonal-20260902` → `503aeb141ee323c822e5c95ad86022dbdb8f0f8a`
**Publicada en el remoto el 2026-09-06** (objeto anotado `f153e8b`).

Arquitectura hexagonal detenida el 2026-09-02: dominio puro, casos de uso con
puertos, adaptadores PostgreSQL, migración `004_cash_foundation` y 16 suites de
prueba. **No integrable** por colisión de identidad de migraciones (`DEC-017` §3).

Consultable como referencia de diseño para `Catalog`, `Inventory`, `CashCount` y
`CashDifferenceReview`. Prohibido integrarlo por merge o `cherry-pick`.
