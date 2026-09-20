# Auditoría de duplicidad entre ramas históricas — 2026-09-20

> **Si llegas aquí a preguntarte si `feat/selective-pr79-payment-cash-sale` o
> `fix/runtime-status-envelope` tienen trabajo que rescatar: la respuesta está
> medida abajo. No repitas la auditoría.**

## Veredicto

De los **25 commits sueltos** que esas dos ramas tienen sobre la línea activa
(`4` y `21`), **un solo cambio era trabajo real perdido**, y se restauró el
mismo día. Todo lo demás ya está en la línea activa, casi siempre en una
versión **posterior y mejor**.

| Ramas auditadas | Commits sueltos | Ficheros tocados | Trabajo realmente ausente |
|---|---|---|---|
| `feat/selective-pr79-payment-cash-sale` | 4 | 9 | 1 prueba (cubierta por otra) |
| `fix/runtime-status-envelope` | 21 | 12 | 2 documentos históricos |
| **Ambas** | **25** | **14 únicos** | **1 regresión real → `D-29`** |

## Regla de interpretación — el error que esta auditoría corrige

Dos métricas se confunden con «trabajo pendiente» y **ninguna lo es**:

1. **`git rev-list --count HEAD..<rama>` distinto de cero** significa que esa
   rama conserva historia que la línea activa no reprodujo commit a commit. No
   significa que falte una capacidad.
2. **`git cherry HEAD <rama>` marcando `+`** compara *patch-ids*. Si la línea
   activa rehízo el mismo cambio con otra implementación, sale `+` aunque la
   capacidad esté completa y mejor. Medido aquí: **4 de 4** y **20 de 21**
   parches salen `+`, y sin embargo sólo faltaba uno de verdad.

**Para saber si falta algo se compara capacidad, no parches:** ¿existe el
fichero en la línea activa? ¿hay prueba que cubra el comportamiento? ¿qué dice
el contrato del consumidor?

### El error concreto que motivó esta auditoría

Una revisión externa concluyó que `central-sync-gate.ts` era «un archivo nuevo
de 183 líneas» y `central-sync-server.ts` «286 líneas nuevas», y recomendó no
descartarlos sin revisar. **Las dos afirmaciones eran falsas**, y por la misma
causa: se miró el contenido *de la rama histórica* sin comprobar si la línea
activa ya lo tenía.

| Fichero | Rama histórica | Línea activa | Realidad |
|---|---|---|---|
| `tools/target-migrations/src/central-sync-gate.ts` | 183 líneas | **238** | La activa evolucionó: exige `CENTRAL_SYNC_BASE_URL` y falla cerrado, en vez de cablear `http://127.0.0.1:8787`; usa `connectionString` en vez de `PGHOST`/`PGPORT` con valores por defecto |
| `tools/target-migrations/src/central-sync-server.ts` | 286 (`runtime-status-envelope`) / 411 (`selective-pr79`) | **411** | **Idéntico byte a byte** al de `selective-pr79`. Cero trabajo perdido |

## Medición completa — todos los ficheros de los 25 commits

Comando:

```bash
for b in feat/selective-pr79-payment-cash-sale fix/runtime-status-envelope; do
  git diff --name-only $(git merge-base HEAD origin/$b) origin/$b | sort -u | while read f; do
    git cat-file -e HEAD:"$f" 2>/dev/null \
      && { diff -q <(git show HEAD:"$f") <(git show origin/$b:"$f") >/dev/null \
           && echo "IDÉNTICO $f" || echo "EVOLUCIONÓ $f"; } \
      || echo "AUSENTE $f"
  done
done
```

**Ausentes en la línea activa — los 3 únicos, de 14 ficheros:**

| Fichero | Qué es | Disposición |
|---|---|---|
| `apps/pos-desktop/tests/renderer/SalePanel.cash-tendered.test.tsx` | Prueba de «efectivo recibido» | **No se rescata.** El comportamiento está cubierto en `SalePanel.test.tsx`: envía `tendered_amount` `"5000.000000"` manteniendo `amount` `"3500.000000"`, y vacío significa «el importe justo». Lo único que la histórica añadía era afirmar el vuelto mostrado |
| `docs/audits/P0-runtime-closure-2026-09-16.md` | Auditoría histórica | **No se rescata.** Documento de un estado ya superado |
| `docs/audits/payment-cashshift-sale-create-2026-09-16.md` | Auditoría histórica | **No se rescata.** Ídem |

Los **11 restantes** existen en la línea activa y evolucionaron. Dos son más
pequeños que su versión histórica, y ahí estaba lo único que sí faltaba.

## `D-29` — la regresión real, medida y restaurada

`apps/pos-local-service/tests/sync-store.test.ts` tenía en la rama histórica una
prueba que la línea activa no tenía:

```
"persists payload_checksum from canonical payload bytes, ignoring a supplied wrong checksum"
```

Y `durable-sync-store.ts` había perdido lo que esa prueba fijaba:

```diff
  enqueue(input: unknown): EnqueueResult {
-   const parsed = SyncOperationSchema.parse(input);
-   const operation: SyncOperation = { ...parsed, payload_checksum: checksum(parsed.payload) };
+   const operation = SyncOperationSchema.parse(input);
```

### Por qué importa

`central-sync-server.ts:92` hace exactamente esto:

```ts
if (payloadChecksum(operation.payload) !== operation.payload_checksum) {
  throw Object.assign(new Error("payload checksum mismatch"),
                      { code: "SYNC.PAYLOAD_CHECKSUM_MISMATCH" });
}
```

Los almacenes (`sqlite-catalog-store`, `sqlite-cash-shift-store`,
`sqlite-sale-store`, `sqlite-customer-store`, `sqlite-credit-store`, …) pasan
`payload_checksum: input.requestChecksum`, que digiere **la petición**
—`idempotency_key`, `operator_user_id`, importes— y **no el payload**. Los dos
algoritmos son el mismo `sha256(canonicalJson(x))` sobre objetos distintos.

Consecuencia: **toda** operación del outbox sería rechazada por el central.

### Cómo se midió — no se infirió

Sonda temporal sobre SQLite real, encolando como lo hace cualquier almacén y
recalculando como lo hace el central:

```
persistido : 01bdbf7907c73419fc5e2e4b069437c1368b1667a948727ea01d5dfdc1b68107
central rec: 6f2848ce496c64c3d236a4a9759a0c03dc3969e05e702839a3dad0a3e7bedd5f
COINCIDEN  : false
```

### Disposición

**Restaurado el 2026-09-20**, con su comentario y su prueba. Verificado que la
prueba muerde: reintroduciendo la regresión, `sync-store.test.ts` pasa de 6/6 a
**1 failed | 5 passed**. La suite completa de `pos-local-service` sigue en
**857 passed | 5 skipped**, así que la restauración no rompe nada.

### Por qué no lo detectó ninguna puerta

Porque el **Central Sync Persistence Gate** es la única que compara los dos
lados, y **no se ha ejecutado nunca de verdad**: CI no asigna runner desde el
2026-09-14 (los runs terminan en 3 segundos con `failure`). La regresión entró
en la unificación del 2026-09-20 y ninguna prueba local la cubría, porque la
prueba que la cubría se perdió en la misma unificación.

## Las tres ramas absorbidas

`claude/pos-camacho-bloque-4c-ld43py`, `_audit-temp` y
`audit/branch-deprecation-record` tienen **0 commits sueltos** sobre la línea
activa y son ancestros estrictos de ella. Borrarlas no pierde un solo commit.
Comandos y SHAs en `branch-deprecation-audit-2026-09-16.md`.

## Qué NO cubre esta auditoría

- **No se auditaron las demás ramas históricas** (`wip/*`, `domain/*`,
  `claude/*`), que conservan linaje por `DEC-018` y no son trabajo a continuar.
- **No se ejecutó el Central Sync Persistence Gate de extremo a extremo**: exige
  PostgreSQL y un runner. La corrección de `D-29` está medida contra el
  algoritmo del servidor, no contra el servidor en marcha →
  `REQUIRES_LOCAL_VERIFICATION`.
- **No se comparó el contenido semántico commit a commit** de los 25, sino el
  estado final de los 14 ficheros que tocan. Para la pregunta «¿qué falta?» esa
  es la comparación correcta; para «¿por qué se hizo así?» hay que leer los
  commits.

## Conclusión operativa

**No mergear ninguna de las dos ramas.** No queda nada que rescatar: el único
trabajo real ya volvió, extraído selectivamente y con evidencia, que es el
único procedimiento que la regla dominante admite.
