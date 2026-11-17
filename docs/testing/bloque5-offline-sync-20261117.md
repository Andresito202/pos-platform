# Bloque 5 — Offline + sincronización multicaja (evidencia interna)

**Repositorio:** Andresito202/pos-platform  
**Rama única:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft — no fusionar)  
**HEAD inicial aprobado (pre-bloque):** `dcd753054670bcd13036a79e685d01aaf4911e52`  
**HEAD funcional Bloque 5:** `b895d8a79789780274c70e86ecfa4c1c11b56717`  
**Modo:** aprovechar el motor outbox/Central Sync existente. Sin segundo sync engine, sin otra DB local, sin Bloque 6, sin merge a `main`.

## Política de inventario en desconexiones simultáneas (explícita)

Cada caja escribe su propio SQLite. Las reservas (`MIGRATION_024`) coordinan stock **dentro de la misma base/dispositivo**.

Cuando dos o más cajas de la misma sucursal operan offline **sin** reservas previas coordinadas por Central:

- cada caja puede aceptar ventas contra su proyección local;
- **no** se afirma prevención absoluta de sobreventa global;
- la reconciliación ocurre al sincronizar eventos (idempotencia + causalidad); no se usa last-write-wins genérico sobre hechos comerciales.

Fuente previa alineada: `docs/testing/shared-inventory-20261115.md` (§ Sync Central y concurrencia distribuida).

## Defecto corregido en este bloque

| Defecto | Evidencia | Corrección |
|---|---|---|
| Reintentos del outbox sin jitter pese a DEC-007 / `integration-contracts.md` | `retryDelayMs` sólo exponencial | `RetryPolicy.jitterRatio` (default `0.2`) + jitter uniforme sobre el delay exponencial en `DurableSyncStore` |

No se creó otro motor de sincronización.

## Operaciones offline verificadas (sobre implementaciones existentes)

| Operación | Cómo se verificó | Nivel de claim |
|---|---|---|
| Persistencia outbox sin Central | `bloque5-offline-sync-e2e` — PENDING sin dispatch | TESTED (local) |
| Reinicio con IN_FLIGHT | recover → RETRY_WAIT → DELIVERED idempotente | TESTED |
| Pérdida de transporte + backoff | TRANSPORT_FAILED → IDLE hasta `next_attempt_at` → DELIVERED | TESTED |
| Retransmisión tras ACK | segundo `dispatchOnce` = IDLE | TESTED |
| Rechazo durable | SERVER_REJECTED → inbox + checkpoint; outbox ACKNOWLEDGED (no borrado silencioso) | TESTED |
| Dead-letter + requeue autorizado | agotamiento → DEAD_LETTER → `requeueDeadLetter` → DELIVERED | TESTED |
| Sync parcial / orden causal | RETRY_WAIT bloquea claim hasta backoff | TESTED |
| Aislamiento empresa en misma DB física | `claimBatch` por scope company/device | TESTED |
| Multicaja 3×3 (Salsamentaria/Farmacia/Pastelería) | 9 SQLite independientes; una offline mientras otras sync; reconexión | TESTED |
| Venta/pago cash + reinicio DB | regresiones `payment.test.ts` / `sale.test.ts` (existentes) | TESTED (regresión) |
| Anti-tamper `operation_id` | colisión con payload distinto lanza | TESTED |
| Jitter DEC-007 | `sync-store` delay 1000 + 50% = 1500ms | TESTED |

No se simularon facturas DIAN ni confirmaciones electrónicas sin proveedor.

## Rendimiento (motor local — no certificación VPS)

Objetivo operativo del enunciado: **10 empresas × 3 cajas × 100 ventas = 3.000** agregadas, sync concurrente.

| Métrica | Resultado observado (esta VM) |
|---|---|
| Enqueue + deliver 3000 ops / 30 DBs | PASS en suite Bloque 5 (< soft budget 120s/180s; corrida ~4–5s suite completa) |
| Duplicados post-ACK | 0 (checkpoint = 100 por caja; IDLE final) |
| Capacidad producción VPS | **NO declarada** (sin medición en infra equivalente; Docker/Postgres lab no disponible aquí) |

## Pruebas ejecutadas en este entorno

### PASS (observado)

```text
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm --filter @pos-platform/pos-local-service exec vitest run \
  tests/bloque5-offline-sync-e2e.test.ts \
  tests/sync-store.test.ts \
  tests/sync-dispatcher.test.ts \
  tests/central-sync-component.test.ts \
  tests/payment.test.ts \
  tests/sale.test.ts
→ 132 passed

pnpm --filter @pos-platform/pos-local-service exec vitest run \
  tests/bloque4-sector-license-e2e.test.ts \
  tests/bloque5-offline-sync-e2e.test.ts
→ 18 passed (regresión Bloque 4 + Bloque 5)

pnpm test:contracts → 343 passed
pnpm test:migrations:sqlite → 13 passed
```

### SKIP / fuera de este runner

| Prueba | Motivo |
|---|---|
| `central-sync:gate` / fallo PostgreSQL real | Docker no disponible en este entorno (`DOCKER_NO`) |
| Certificación VPS / Android / FACTUS / FNE / hardware | Fuera de alcance Bloque 5 |
| Prevención absoluta sobreventa multicaja offline | Política explícita: no afirmable sin coordinación Central |

### CI exact-head

Debe acreditarse contra el **HEAD final** de este bloque en la rama activa (workflows del PR #106). Verde en un commit anterior no sustituye el HEAD exacto.

## Riesgos pendientes (no cerrados)

1. Receptor Central tipado para todos los eventos de inventario/reserva aún no es certificación `END_TO_END` productiva.
2. Stock compartido entre cajas offline sin reserva previa sigue sujeto a sobreventa relativa (política arriba).
3. `CentralSyncComponent` no re-sonda si el arranque fue `NOT_AUTHENTICATED` (credencial ausente ≠ caída de red); documentado en el componente — no se amplió vigencia offline.
4. Gate PostgreSQL Central Sync: pendiente de ejecución con Docker/lab en CI del HEAD.

## Estado

**BLOQUE_5_CERRADO_INTERNO** — cierre interno de implementación/pruebas locales sobre el motor existente.  
**No** es certificación comercial ni `PRODUCTION`.  
**No** iniciar Bloque 6. **No** fusionar a `main`.
