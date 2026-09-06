# DEC-017 — Arquitectura canónica del runtime y archivado del linaje hexagonal

## Estado

`NORMATIVA RATIFICADA` — 2026-09-06. **No autoriza implementar nada.**

No crea tablas, no crea migraciones, no modifica código de producción, no
elimina ramas ni historia. Declara cuál de las dos arquitecturas que conviven
en el repositorio es la canónica, y archiva la otra con su motivo técnico, para
que ningún bloque futuro vuelva a redescubrir esta bifurcación.

No modifica `DEC-002`, `DEC-007`, `DEC-011`, `DEC-012`, `DEC-013`, `DEC-014`,
`DEC-015`, `DEC-016`, `PAY-007` ni ningún contrato físico.

## 1. Problema

El repositorio contiene **dos arquitecturas incompatibles para el mismo
producto**, y ninguna estaba declarada. Cada auditoría redescubre la segunda y
cada bloque nuevo vuelve a preguntarse dónde vive la lógica de negocio.

| Dimensión | `main` (canónica de facto) | Linaje hexagonal (`domain/cash-open-vertical-20260901`) |
|---|---|---|
| Lógica de negocio | dentro de los stores del runtime local | en `packages/domain` puro |
| Casos de uso | clases en `apps/pos-local-service/src/<módulo>/` | `packages/application/src/use-cases/` |
| Persistencia | SQL directo en el store | repositorios detrás de puertos |
| `packages/domain/src` | 7 archivos, 277 líneas | capa de dominio completa |
| `packages/application/src` | 5 archivos, 131 líneas | casos de uso + 8 puertos |
| Estado | `CANONICALLY_APPLIED`, CI verde en `6bdaf59` | detenido el 2026-09-02 |

## 2. Contexto verificado

| Hecho | Evidencia |
|---|---|
| `main` = `6bdaf59`, 415 commits | `git ls-remote origin refs/heads/main` |
| Payment V1, Cash V1, Sales V1, SSA y IPC comercial están integrados y probados | `MIGRATION_009/010/011`; 345 pruebas verdes en `pos-local-service` |
| El linaje hexagonal tiene 20 commits fuera de `main` y 86 archivos nuevos | `git rev-list origin/main..503aeb1` |
| Bifurcó en `ae93344` (2026-09-01) y se detuvo el 2026-09-02 | `git merge-base` |
| `main` avanzó 58 commits desde esa bifurcación | `git rev-list ae93344..origin/main` |
| El linaje hexagonal **no contiene** `apps/pos-local-service/src/cash/` | `git ls-tree -r 503aeb1` |
| Ambos linajes usan los mismos números de migración para esquemas distintos | §3 |

## 3. Por qué el linaje hexagonal no puede integrarse

No es un conflicto de texto resoluble. Es una **colisión de identidad de
migraciones**:

| Migración | En el linaje hexagonal | En `main` |
|---|---|---|
| `MIGRATION_007` | tablas de caja | proyección de session assertion |
| `MIGRATION_008` | tablas de caja | ampliación de `local_operation_audit.actor_type` |
| Tablas de caja | `cash_registers`, `cash_shifts`, `cash_movements` (plural) | `cash_register`, `cash_shift`, `cash_movement` (singular), en `MIGRATION_009/010` |

Cada migración se identifica por un checksum SHA-256 de su SQL
(`local-database.ts`). Integrar el otro linaje asignaría contenido distinto al
mismo número de versión y **corrompería el linaje de checksums**, que es el
mecanismo que protege la integridad de la base local instalada.

Existe además un segundo riesgo material: ambos linajes definen su propio
modelo de dinero. `main` usa TEXT escala-6 con aritmética `BigInt` y
restricciones `CHECK GLOB` en todas las tablas monetarias. Convivir con un
segundo modelo introduciría dos verdades sobre el mismo importe.

## 4. Decisión

### 4.1 Arquitectura canónica

**La arquitectura de `main` es la única canónica.** El runtime local
(`apps/pos-local-service/`) es donde viven las reglas de negocio, junto a su
persistencia SQLite.

### 4.2 Dónde vive la lógica

- Las reglas de un módulo viven en su directorio de `apps/pos-local-service/src/`.
- Un store SQLite puede contener reglas de negocio junto a su SQL. No se exige
  separar dominio puro.
- `packages/domain` y `packages/application` conservan únicamente lo que hoy
  contienen (autorización y sesión) y **no se amplían preventivamente**.

### 4.3 Cuándo se crea un puerto

Un puerto se crea **solo** cuando una escritura cruza la frontera de otro
módulo, y lo define el consumidor para que el proveedor no lo importe.

`CashPort` (`DEC-016` §10) es el precedente normativo: Payments declara lo que
necesita, `SqliteCashShiftStore` lo satisface estructuralmente, y `cash/` nunca
importa de `payments/`.

No se crean puertos para aislar la base de datos: hay exactamente un motor de
persistencia por plano y aislarlo no compra nada verificable.

### 4.4 Archivado del linaje hexagonal

El linaje se archiva en el commit `503aeb141ee323c822e5c95ad86022dbdb8f0f8a`,
cuya etiqueta prevista es `archive/cash-hexagonal-20260902`.

**La etiqueta no está publicada.** Los pushes a `refs/tags/*` son rechazados con
HTTP 403 por las credenciales de la sesión automatizada, y las herramientas de
tags disponibles son de sólo lectura. El archivado **no depende de la etiqueta**:
el SHA queda registrado en este documento y en
`docs/governance/materialization-state.md`, y la rama
`domain/cash-open-vertical-20260901` sigue apuntando a él. Para publicarla:

```
git tag -a archive/cash-hexagonal-20260902 503aeb141ee323c822e5c95ad86022dbdb8f0f8a \
  -m "Linaje hexagonal archivado (DEC-017 4.4)"
git push origin archive/cash-hexagonal-20260902
```

**No se elimina.** La rama, sus commits y su contenido permanecen íntegros en
Git. El archivado es de estado, no destructivo: deja de figurar como trabajo
pendiente y pasa a ser referencia de diseño localizable.

Conserva valor como **especificación**, no como origen de merge, para
capacidades que `main` todavía no materializa: modelos de `Catalog`,
`Inventory`, `CashCount` y `CashDifferenceReview`, y sus 16 suites de prueba.
Consultarlo está permitido; integrarlo por merge o `cherry-pick` está prohibido
sin una decisión arquitectónica nueva.

## 5. Qué no decide este documento

- No decide si Fiscal V1 es central o local — sigue abierto en
  `electronic-invoicing-v2` §19.
- No autoriza construir Catalog, Pricing, Tax, Inventory, transporte ni API central.
- No modifica el backlog ni ningún estado declarado en él.
- No declara `PRODUCTION_READY` de nada.

## 6. Consecuencia aceptada

Las reglas de negocio quedan acopladas al runtime local y **no serán
reutilizables desde una futura API central en PostgreSQL**.

Se acepta porque `DEC-007` ya fija que el plano local es la autoridad: la
central recibe hechos ya decididos a través del outbox y no vuelve a decidirlos.
No existe un segundo motor de reglas que mantener sincronizado.

Si en el futuro un módulo concreto necesitara reglas compartidas entre local y
central, la extracción de un dominio puro se hará **para ese módulo**, con
evidencia de la necesidad, y sin reescribir lo ya cerrado.

## 7. Qué no debe modificarse sin una decisión arquitectónica nueva

`apps/pos-local-service/src/payments/` · `.../cash/` · `.../sales/` ·
`.../session/` · `.../channel/server.ts` · `MIGRATION_001..011` en
`packages/database-sqlite/src/local-database.ts` · `packages/contracts/src/ipc*.ts`
