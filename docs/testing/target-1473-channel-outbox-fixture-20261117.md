# TARGET #1473 — channel socket closed before response

**Repositorio:** Andresito202/pos-platform  
**Rama:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft)  
**Jobs:** TARGET foundation validation — Linux `TypeScript, SQLite and PostgreSQL 16.14` + Windows `Windows local runtime platform checks`

## HEADs

| Rol | SHA |
|---|---|
| Bloque 6 CI SUCCESS (último tip funcional aprobado del bloque) | `f7926274d24e998bb95703ce09afda62dd8e1b05` |
| HEAD fallido citado | `9c9cf45b28ff7cfb7987f13d3f6f5c0415981be6` |
| Fix TARGET #1473 | `a6df1f6e948bcc62a0444625b367261572daabe2` |
| Remediación electron-builder (conservada) | `c5a1f0699391effe0974dfebecdada2f599174c3` |

## Síntoma

Tres pruebas de `apps/pos-local-service/tests/channel.test.ts` fallan en Linux y Windows con el mismo mensaje:

- L237 — `uses the real client to negotiate TECH-003 and validate response identity` → `Error: local channel socket closed before response` (`packages/local-channel/src/client.ts:224`)
- L370 — `rejects client requests when the bounded client queue is saturated` → mismo error en el `first` status request
- L125 — `requires canonical TECH-003 handshake before status traffic` → helper `receive()` `socket closed before response`

## Causa raíz

En Bloque 7, `RuntimeStatusResultSchema` (`packages/contracts/src/ipc.ts`) pasó a exigir:

- `outbox_pending_count`
- `outbox_dead_letter_count`

El handler real (`local-channel-component.ts`) y varias fixtures ya los emiten. La fixture de prueba `compatibleResponse` en `channel.test.ts` **no** — quedó como en Bloque 6 (`service_version` / `protocol_version` / `service_state` / `schema_version` solamente).

Cadena fail-closed (sin relajar seguridad):

1. Handler de test devuelve status incompleto.
2. `LocalChannelServer.validateResponse` → `responseSchemaFor("runtime.status.get").parse(...)` (`apps/pos-local-service/src/channel/server.ts`).
3. Zod falla → `.catch(() => close())` cierra el socket.
4. Cliente observa cierre en `receiveOne()` (`client.ts:224`) / helper `receive()` (L125).

No es fallo de negociación TECH-003, autenticación, cola ni timeouts: es validación de contrato de respuesta tras el indicador real de outbox.

## Corrección

Únicamente alinear la fixture (sin tocar esquemas ni límites):

```ts
outbox_pending_count: 0,
outbox_dead_letter_count: 0,
```

en el `result` de `compatibleResponse` para `runtime.status.get`.

Commit: `a6df1f6e` — `fix(bloque-7): align channel fixture with outbox status schema`.

## Reproducción local (este entorno)

**FAIL** con fixture de `9c9cf45b` (3/3):

```text
FAIL ... negotiate TECH-003 ... L237  local channel socket closed before response (client.ts:224)
FAIL ... bounded client queue ... L370  local channel socket closed before response (client.ts:224)
FAIL ... requires canonical TECH-003 ... L125  socket closed before response
```

**PASS** con tip `a6df1f6e` (mismas tres):

```text
Tests  3 passed | 10 skipped (13)
```

Suite canal completa en tip: **12 passed | 1 skipped**.  
`channel-cancellation-lifecycle.test.ts`: **9 passed**.  
`electron-builder` tip: **26.18.1** (remediación conservada).

## Qué no se hizo

- No se relajó Zod / `RuntimeStatusResultSchema`.
- No se debilitó auth/IPC/colas.
- No se deshabilitaron pruebas ni se subieron timeouts.
- No se revirtió Bloque 6/7 ni FACTUS.
- No merge a `main`.

## CI exact-head

Claim tip del fix: `a6df1f6e948bcc62a0444625b367261572daabe2`.  
PASS remoto se declara sólo tras SUCCESS del HEAD exacto (no por inferencia local).
