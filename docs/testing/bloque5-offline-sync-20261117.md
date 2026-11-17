# Bloque 5 — Informe definitivo (cierre interno)

**Repositorio:** Andresito202/pos-platform  
**Rama única:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft — no fusionar a `main`, no Bloque 6, no FACTUS)  
**Estado:** **BLOQUE_5_CERRADO_INTERNO**

| Referencia | SHA |
|---|---|
| HEAD inicial aprobado (pre-bloque) | `dcd753054670bcd13036a79e685d01aaf4911e52` |
| Tip funcional + CI exact-head | `8ae99fea1607c79665f3b869c21dee573da53e25` |
| Tip funcional (código Bloque 5) | `b895d8a79789780274c70e86ecfa4c1c11b56717` |

Motor: **únicamente** `DurableSyncStore` + `SyncDispatcher` + `CentralSyncComponent` existentes. Sin segundo sync engine, sin otra DB local, sin rediseño de pantallas ni login.

## CI exact-head (`8ae99fea`) — 6/6 SUCCESS

Workflows de PR observados contra `8ae99fea1607c79665f3b869c21dee573da53e25` (2026-11-17T17:33:26Z):

| # | Workflow | Run | Conclusión |
|---|---|---|---|
| 1 | TARGET foundation validation | [44138285139](https://github.com/Andresito202/pos-platform/actions/runs/44138285139) | success |
| 2 | CodeQL SAST | [44138284811](https://github.com/Andresito202/pos-platform/actions/runs/44138284811) | success |
| 3 | D-3 Live Security E2E | [44138284625](https://github.com/Andresito202/pos-platform/actions/runs/44138284625) | success |
| 4 | G1.2 Live Session Bootstrap | [44138284650](https://github.com/Andresito202/pos-platform/actions/runs/44138284650) | success |
| 5 | Central Sync Persistence Gate | [44138284705](https://github.com/Andresito202/pos-platform/actions/runs/44138284705) | success |
| 6 | strix-penetration-test | [44138284631](https://github.com/Andresito202/pos-platform/actions/runs/44138284631) | success |

**6/6 SUCCESS** en workflows de PR. Check-runs del mismo SHA: 9 success · 2 skipped · **0 failed** (skipped: Main push governance, FACTUS sandbox).

| Check (detalle TARGET / hermanos) | Conclusión |
|---|---|
| TypeScript, SQLite and PostgreSQL 16.14 | success |
| Repository policy, dependency inventory and vulnerability audit | success |
| Central Sync persistence and idempotency gate | success |
| Windows local runtime platform checks | success |
| Windows real POS Local Service session bootstrap | success |
| d3-live-security-e2e | success |
| CodeQL JavaScript and TypeScript | success |
| Strix AI penetration test | success |
| Provenance evidence | success |
| Main push governance | skipped |
| FACTUS sandbox exceptional | skipped |

Nota: el tip documental posterior `6cbc19d6` falló TARGET por flake de UI `App.test.tsx` (SUPERVISOR → `transfer-review-panel`), **ajeno al motor outbox/Central Sync**. No invalida el claim CI de `8ae99fea`. No se re-ejecutaron suites Bloque 5 ya aprobadas.

## Defectos corregidos en el bloque

| Defecto | Corrección |
|---|---|
| Outbox sin jitter (DEC-007 / integration-contracts) | `RetryPolicy.jitterRatio` default `0.2` en `DurableSyncStore` |
| CI tip `cfe3d0fe` bloqueado por advisory npm picomatch | Excepciones temporales en `tools/ci/dependency-vulnerability-policy.json` (ver abajo) |

## Operación offline, persistencia y recuperación (TESTED)

Suite `apps/pos-local-service/tests/bloque5-offline-sync-e2e.test.ts` + regresiones sale/payment/sync (ejecutadas en el agente; no re-ejecutadas en este cierre documental):

| Capacidad | Evidencia | Claim |
|---|---|---|
| Venta/outbox sin Central | PENDING sin dispatch; no se pierde la fila | TESTED |
| Persistencia SQLite + reinicio | reopen DB; IN_FLIGHT → `recoverInterruptedDispatches` → RETRY_WAIT | TESTED |
| Recuperación post-crash de despacho | retransmit → DELIVERED; segundo dispatch IDLE | TESTED |
| Pérdida de transporte | TRANSPORT_FAILED → backoff → DELIVERED | TESTED |
| Idempotencia / no duplicar tras ACK | checkpoint estable; IDLE final | TESTED |
| Sync parcial / orden causal | RETRY_WAIT bloquea claim de posteriores | TESTED |
| REJECTED durable | inbox `SERVER_REJECTED` + checkpoint; outbox no borrado | TESTED |
| Dead-letter + requeue autorizado | DEAD_LETTER → requeue → DELIVERED | TESTED |
| Anti-tamper | colisión `operation_id` con payload distinto lanza | TESTED |
| Jitter | delay 1000 + 50% → 1500 ms (`sync-store`) | TESTED |
| Venta/pago cash + reopen | regresiones `sale.test.ts` / `payment.test.ts` | TESTED |
| Gate Central lab (Postgres) | check CI “Central Sync persistence…” success en exact-head | VERIFIED (lab) |

No se simularon facturas DIAN ni confirmaciones electrónicas sin proveedor.

## Sincronización automática

- `CentralSyncComponent`: sonda inicial + intervalo tras outcome distinto de `NOT_AUTHENTICATED`.
- Reintentos: backoff exponencial + jitter en el store; retransmisión segura vía idempotency_key + inbox `INSERT OR IGNORE`.
- `NOT_AUTHENTICATED` al boot (credencial ausente) **no** arma timer — no es caída de red; no se amplió vigencia offline.

## Multicaja, aislamiento e inventario

| Escenario | Resultado | Claim |
|---|---|---|
| 3 empresas × 3 cajas (Salsamentaria / Farmacia / Pastelería) | 9 SQLite; scopes independientes; sync concurrente; una caja offline mientras otras drenan; reconexión | TESTED |
| Aislamiento entre empresas | `claimBatch` no contamina company/device | TESTED |
| Inventario en desconexión simultánea | Política explícita: reservas 024 = misma DB; **no** prevención absoluta de sobreventa global entre cajas aisladas | DOCUMENTED + TESTED (aislamiento DB) |

## Rendimiento (30 cajas / 3.000 ventas — motor local)

Objetivo: **10 empresas × 3 cajas × 100 ventas = 3.000** agregadas, sync concurrente.

| Métrica | Observado (VM del agente) |
|---|---|
| Enqueue + deliver 3000 ops / 30 DBs | PASS (suite Bloque 5; soft budgets 120s/180s) |
| Duplicados post-ACK | 0 (checkpoint = 100/caja; IDLE) |
| Capacidad VPS / producción | **NO declarada** |

## Excepciones temporales de seguridad

Archivo: `tools/ci/dependency-vulnerability-policy.json`

| Advisory | Package | Versions | Expira |
|---|---|---|---|
| `GHSA-fc5q-39xc-vjpf` | picomatch | 4.0.5, 4.0.7 | `2026-12-17T17:30:00Z` |

Alcance: tooling Vite/Vitest/tinyglobby (dev/build), no runtime outbox/Central Sync. Remoción cuando exista release parchado forzado en lockfile.

## Riesgos pendientes (no cerrados)

1. Consumers Central tipados para inventario/reservas — no `END_TO_END` productivo.
2. Sobreventa relativa multicaja offline sin coordinación previa.
3. Provenance `LOCAL_DEVICE` / corte criptográfico; DEC-024 TLS (PROPOSED).
4. `NOT_AUTHENTICATED` al boot no re-sonda hasta reinicio con credencial.
5. Excepciones picomatch temporales (arriba).
6. Certificación comercial / VPS / Android / FACTUS / FNE / hardware — fuera de alcance.
7. Flake tip documental `6cbc19d6`: `App.test.tsx` SUPERVISOR no encuentra `transfer-review-panel` bajo carga CI (Inventario permanece `aria-current=page`). Fuera del alcance funcional de Bloque 5; no se parcheó aquí sin fix verificado.

## Pruebas PASS / SKIP (cierre)

**PASS (agente, no re-ejecutados aquí):** typecheck local-service; bloque5 + sync-store + sync-dispatcher + central-sync-component + sale + payment (132); bloque4+5 (18); contracts 343; migrations sqlite 13; vulnerability gate local con excepciones.

**PASS (CI exact-head `8ae99fea`):** matriz de 9 success arriba, incluye Central Sync lab gate.

**SKIP:** FACTUS sandbox; Main push governance; capacidad VPS; sobreventa global absoluta offline.

## Estado final

**BLOQUE_5_CERRADO_INTERNO**  
No certificación comercial. No `PRODUCTION`. No iniciar Bloque 6. No fusionar a `main`. No intervenir FACTUS.
