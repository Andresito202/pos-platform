# DEC-014 — Contrato IPC comercial V1 y vinculación de sesión

## Estado

`RATIFICADA PARCIALMENTE` el 2026-09-05 sobre `HEAD = 3f89eb3`.

| Decisión | Resultado |
|---|---|
| `PD-1` — contrato IPC comercial V1 | **`RATIFICADA`** (§3) |
| `PD-2` — modelo de vinculación SSA ↔ IPC | **`RATIFICADA COMO MODELO` · `BLOQUEADA COMO MECANISMO`** (§4) |
| `PD-3` — alcance de `SandboxCatalogStore` | **`RATIFICADA`** (§5) |

Este documento **no autoriza implementar handlers**. Cierra las decisiones que
`POST-4D RECONCILIATION` identificó como bloqueantes y deja constancia exacta de
la que no puede cerrarse sin infraestructura que hoy no existe.

> **Nota superviniente (2026-09-05).** `PD-2` quedó **`RESUELTA`** por `DEC-015`,
> que elige `SERVER-ASSIGNED CONNECTION BINDING`: la clave del vínculo no es el
> `sessionId` de transporte —que el cliente elige— sino un `connectionId` que
> asigna el servidor y que nunca viaja por el cable. `DEC-015` §6 justifica que
> el mecanismo no requiere persistencia ni `MIGRATION_011`. Con ello
> **`BLOQUE 4E IMPLEMENTATION READY = YES`**. El texto de §4 se conserva íntegro
> como registro del análisis que llevó al bloqueo; prevalece `DEC-015`.

`BLOQUE 4E IMPLEMENTATION READY = NO`. La causa es `PD-2` y está acotada en §4.4.
*(Superado por `DEC-015`.)*

No modifica `DEC-011`, `DEC-012` ni `DEC-013`. No altera `BLOQUE 4C` ni
`BLOQUE 4D`. No toca Payment, CashCount, Inventory ni `RT-009`. No crea
migraciones: `MIGRATION_001`–`010` permanecen intactas y `MIGRATION_011` no
existe.

## 1. Contexto

`BLOQUE 4C` materializó `UC-SALES-001` y `BLOQUE 4D` materializó `UC-CASH-001` y
`UC-CASH-002`. Los tres casos de uso están implementados, probados y cerrados por
gate. Ninguno es alcanzable: `LocalChannelComponent` atiende cuatro
`message_type` —`runtime.handshake`, `runtime.status.get`,
`operation.result.get`, `operation.confirm`— y ninguno de ellos los invoca.

La infraestructura de sesión también está materializada:
`SessionActivationService`, `SqliteSessionAssertionStore`,
`SessionAssertionVerifier`, la tabla `local_session_assertion`
(`MIGRATION_007`) y el actor `'USER'` en `local_operation_audit`
(`MIGRATION_008`). Tampoco es alcanzable por la misma razón.

Falta el contrato que permita atarlos. Esa es la materia de este documento.

## 2. Principio rector

**El renderer no es autoridad de seguridad.** Transporta intención. No transporta
identidad, ámbito ni autorización.

El precedente ya está establecido y no se inventa aquí: el handler de
`operation.confirm` deriva `tenant_id`, `company_id`, `branch_id`, `device_id` e
`installation_id` de la configuración local, y fija `actor_id` al `device_id`
—nunca lee esos campos del sobre recibido, aunque `RequestEnvelope` los declare
opcionales—.

`DEC-011:28` ya prohibió derivar autoridad de variables de entorno, del
`device_id` o de un seed local. Este documento extiende la misma prohibición al
llamador IPC: **un llamador no puede afirmar quién es.**

## 3. `PD-1` — Contrato IPC comercial V1 — `RATIFICADA`

### 3.1 Métodos canónicos

Cinco métodos, correspondientes uno a uno con componentes ya materializados:

| `message_type` | Componente destino | Estado del componente |
|---|---|---|
| `session.activate` | `SessionActivationService.activate` | `MATERIALIZED` |
| `session.recover` | `SessionActivationService.recover` | `MATERIALIZED` |
| `cash.shift.open` | `OpenCashShiftUseCase.execute` | `MATERIALIZED` (4D) |
| `cash.shift.close` | `CloseCashShiftUseCase.execute` | `MATERIALIZED` (4D) |
| `sale.create` | `CreateSaleUseCase.execute` | `MATERIALIZED` (4C) |

### 3.2 Corrección de nomenclatura — dos fronteras, dos espacios de nombres

La petición de ratificación nombró los métodos con prefijo `pos:`. La
verificación halló que ese prefijo pertenece a **otra frontera**. Se corrige
explícitamente en vez de adoptarlo, porque adoptarlo habría roto la convención
vigente de la capa de servicio.

| Frontera | Convención | Ejemplos vigentes |
|---|---|---|
| Renderer ↔ Electron main | prefijo `pos:` (`IPC_ALLOWED_CHANNELS`, `RT-007`) | `pos:runtime.status.get`, `pos:operation.confirm` |
| Electron main ↔ POS Local Service | sin prefijo (`IpcMessageTypeSchema`) | `runtime.handshake`, `operation.confirm` |

Correspondencia ratificada:

| Canal Electron | `message_type` de servicio |
|---|---|
| `pos:session.activate` | `session.activate` |
| `pos:session.recover` | `session.recover` |
| `pos:cash.shift.open` | `cash.shift.open` |
| `pos:cash.shift.close` | `cash.shift.close` |
| `pos:sale.create` | `sale.create` |

Ambos conjuntos quedan ratificados en su frontera respectiva. No son
intercambiables. `runtime.handshake` sienta el precedente de que no todo
`message_type` se expone al renderer: la pertenencia al allowlist es una decisión
independiente.

### 3.3 Ubicación del contrato

`packages/contracts/src/ipc-commercial.ts`, exportado desde `index.ts`.

**Módulo separado y deliberadamente desconectado de la unión.** Los esquemas no
se añaden a `IpcMessageTypeSchema` ni a `IpcRequestSchema` /`IpcResponseSchema`.
Dos razones, y la segunda es dura:

1. Un `message_type` presente en la unión anuncia una ruta que ningún handler
   atiende.
2. `LocalChannelComponent.handle` discrimina sobre `IpcRequest` con un `switch`
   sin `default` y con retorno por rama. Ampliar la unión sin ampliar el `switch`
   **rompe el typecheck**, y ese cambio pertenece al bloque de implementación —no
   a la ratificación de un contrato—.

La incorporación a la unión, al `switch` y al allowlist es acto del bloque de
implementación.

### 3.4 Lo que el llamador no puede aportar

Los cinco esquemas de petición rechazan, en el sobre, los campos de identidad que
`RequestEnvelope` declara opcionales para otros usos:

`tenant_id` · `company_id` · `branch_id` · `device_id` · `actor_id`

La prohibición es **estructural, no convencional**. `strictObject` rechaza el
campo inesperado en el payload y `forbidCallerAssertedIdentity` rechaza el campo
de sobre. Se sigue el criterio ya aplicado en `session-assertion.ts`: «la
separación no depende de una convención sino de la forma del contrato».

Tampoco son expresables, por ausencia en el contrato: `actor_type`, `user_id`,
permisos, roles, asignaciones y precios.

| Dato | Origen confiable |
|---|---|
| `tenant_id`, `company_id`, `branch_id` | configuración local |
| `device_id`, `installation_id` | configuración local |
| `user_id` | claims **verificados** de la SSA activa |
| `actor_type` | literal `'USER'` en el caso de uso; nunca parámetro |
| permisos | `evaluatePermission()` sobre el SAS |
| precio unitario | catálogo, resuelto por la capa confiable |

Que el precio no viaje en `sale.create` es deliberado: si viajara, el llamador
fijaría lo que se cobra.

### 3.5 SSA en `session.activate` — por qué no contradice §2

`session.activate` recibe el sobre SSA firmado en el payload. Esto **no** es
«aceptar un SSA arbitrario del renderer»:

1. La SSA se autentica por su propia firma Ed25519, verificada por
   `SessionAssertionVerifier` en la capa confiable.
2. `user_id` se toma de los claims **verificados**, nunca de un campo del sobre.
3. `SqliteSessionAssertionStore.activate` vuelve a comparar claims contra
   binding; una discrepancia es `BINDING_MISMATCH`.
4. `installation_id` y `device_id` los aporta la configuración local.

Transportar un artefacto autoautenticado por una vía no confiable es seguro
precisamente porque su autoridad no proviene de la vía. Un llamador no puede
fabricar una SSA válida sin la clave privada central, que el POS no posee
(`DEC-013` §3.2).

### 3.6 Resultados y errores

Cada resultado enumera exactamente las variantes del caso de uso destino, sin
añadir ni omitir ninguna. Los campos no aplicables a una variante son `nullable`
y se pueblan sólo donde el caso de uso los produce.

Un caso merece registro explícito: `cash.shift.close` con resultado
`IDEMPOTENT` devuelve `expected_cash`, `counted_amount` y `difference_amount` en
`null`. No es una omisión del contrato: `MIGRATION_009` no persiste
`counted_amount` en la fila del turno —no existe tabla de arqueo— y un reintento
no puede reconstruirlos. Es el hallazgo `M3` del gate de `4D`, y el contrato lo
expresa en vez de fingir un dato ausente.

Los errores de transporte y validación usan `ContractErrorSchema` con las
categorías ya existentes; este documento no introduce categorías nuevas.

## 4. `PD-2` — Vinculación SSA ↔ IPC — `RATIFICADA COMO MODELO`, `BLOQUEADA COMO MECANISMO`

### 4.1 Modelo ratificado

Se ratifica **`SESSION-BOUND SSA LOOKUP`** como dirección canónica de derivación:

```
transport sessionId → capa confiable → SSA activa verificada
                    → application user_id → SAS → Use Case
```

Se ratifican igualmente las dos prohibiciones:

1. `MUST NOT` transportarse la SSA completa como autoridad en cada petición.
2. `MUST NOT` el renderer determinar `user_id`.

### 4.2 El mecanismo no existe — evidencia

La flecha `transport sessionId → SSA activa` **no tiene realización posible con
la infraestructura actual**. Cuatro hechos verificados en código:

1. **La clave de la SSA no incluye la sesión de transporte.**
   `local_session_assertion` (`MIGRATION_007`) tiene
   `PRIMARY KEY (user_id, installation_id, device_id)`. No hay columna de sesión
   de transporte ni índice que la relacione.

2. **Toda lectura exige `user_id` como entrada.**
   `SessionAssertionStore.loadActive(binding)` y `highestAcceptedSequence(binding)`
   reciben `SessionBinding = { userId, installationId, deviceId }`. Se pide como
   entrada exactamente el dato que hay que derivar.

3. **El mismo bloqueo afecta a la autorización.**
   `AuthorizationSnapshotStore.loadActive(binding)` toma
   `SnapshotBinding { userId, … }`. Los cinco casos de uso reciben un
   `StoredAuthorizationSnapshot`; sin `user_id` no puede obtenerse.

4. **El `sessionId` de transporte lo elige el cliente.**
   `LocalChannelClient` lo genera con `randomUUID()` y
   `LocalChannelAuthenticator.sign` lo acepta como parámetro. Sólo alimenta la
   ventana anti-replay (`replayStateStore.accept`). No es una identidad
   establecida por el servidor. Vincular identidad a un valor elegido por el
   cliente sería, en sí mismo, el agujero que §2 prohíbe.

Además, el `session_id` que la SSA lleva en sus claims es el identificador de
sesión **emitido centralmente**: no es el `session_id` del marco de transporte, y
confundirlos sería tratar dos espacios de identificadores distintos como uno.

### 4.3 Consecuencia por método

| Método | ¿Implementable hoy? | Razón |
|---|---|---|
| `session.activate` | **SÍ** | `user_id` procede de los claims verificados de la SSA entrante; no requiere sesión previa |
| `session.recover` | **NO** | `recover(binding)` exige `userId` |
| `cash.shift.open` | **NO** | exige `StoredAuthorizationSnapshot` → exige `userId` |
| `cash.shift.close` | **NO** | ídem |
| `sale.create` | **NO** | ídem |

`session.activate` es la única superficie que el bloqueo no alcanza, y por
construcción: es el acto que **establece** la sesión, no el que la consume.

### 4.4 Lo que debe decidirse — no se decide aquí

Cerrar `PD-2` exige una decisión formal separada que defina un **vínculo
confiable, establecido por el servidor, entre una conexión de transporte y la
sesión activada sobre ella**. Como mínimo debe fijar:

1. Quién crea el vínculo, y en qué acto (la activación es el candidato natural:
   es el único momento en que la capa confiable conoce `user_id` autenticado).
2. Dónde reside —memoria del proceso o fila durable— y qué ocurre al reiniciar.
2. bis. Si es durable, si exige migración (**afectaría a `MIGRATION_011`**, que
   este documento no crea ni autoriza).
3. Su vigencia y su relación con `offline_valid_until`; una sesión de transporte
   `MUST NOT` sobrevivir a la SSA que la respalda.
4. Su comportamiento ante reconexión, multi-conexión y cierre de sesión.
5. Por qué el valor sobre el que se indexa no es falsificable por el llamador
   —el punto que descarta el `sessionId` de transporte tal como existe hoy—.

**No se inventa aquí ninguna de esas respuestas.** Producir un mecanismo sin esa
decisión sería exactamente la clase de invención que `DEC-012` §2 rechazó al
negarse a derivar identidad de la mera presencia de un artefacto en disco.

Queda registrado como **`DEC-015` pendiente — vinculación de sesión de
transporte**, prerequisito de `BLOQUE 4E` salvo en el alcance de §4.5.

### 4.5 Alcance implementable sin `DEC-015`

Se deja constancia, sin autorizarlo, de que existe un subconjunto coherente:
`session.activate` únicamente. Habilitarlo requiere autorización propia y no se
concede en este documento.

## 5. `PD-3` — Alcance de `SandboxCatalogStore` — `RATIFICADA`

`SandboxCatalogStore` queda autorizado **exclusivamente** para
`SANDBOX ENVIRONMENT / CONTROLLED V1 TEST PATH`.

Restricciones, todas verificables:

1. `MUST NOT` interpretarse como materialización de `CATALOG`.
2. `MUST NOT` convertirse en `CatalogSnapshotStore`, ni renombrarse a él.
3. `MUST NOT` crearse tablas de `CATALOG`, `PRICING` ni `TAX`.
4. `MUST NOT` crearse `CatalogSnapshotStore`, `PricingSnapshotStore` ni
   `TaxSnapshotStore`.
5. `MUST NOT` usarse en `PRODUCTION` ni en `STAGING`.
6. `MUST NOT` derivarse de esta ratificación ninguna modificación de `DEC-013`,
   cuyo `MATERIALIZATION GATE` permanece **`NO-GO`** para `CATALOG`, `PRICING` y
   `TAX`.

**Dependencia temporal declarada.** Su única función es permitir que un futuro
`sale.create` ejecute el camino V1 controlado. `DEC-013` §12 fija que el payload
`CATALOG` es el reemplazo completo del ámbito y §24.16 deja `PRICING` y `TAX`
fuera de la primera materialización; nada de eso cambia. Cuando la proyección
`CATALOG` real se materialice, `SandboxCatalogStore` `MUST` retirarse del camino
de ejecución.

Las versiones de política que `4C` fijó —`SANDBOX_PRICE_V1`,
`TAX_POLICY_EXCLUDED_V1`, `PRICING_PIPELINE_V1`,
`NEAREST_50_HALF_AWAY_FROM_ZERO_V1`— son declaraciones explícitas de ese carácter
acotado y no se modifican.

## 6. Verificación de consistencia

Ejecutada sobre `HEAD = 3f89eb3`.

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Nombres IPC no contradicen contratos existentes | **PASS** con corrección §3.2 |
| 2 | Sin contradicción con `RT-007` | **PASS** — allowlist no se modifica |
| 3 | Sin contradicción con `DEC-012` | **PASS** — SSA/actor `'USER'` respetados |
| 4 | Sin contradicción con `DEC-013` | **PASS** — gate `NO-GO` intacto (§5) |
| 5 | `CASH_SHIFT_OPEN` / `CASH_SHIFT_CLOSE` sin cambios | **PASS** — viven en los casos de uso; el contrato IPC no los nombra |
| 6 | Sale sigue terminando en `READY_FOR_PAYMENT` | **PASS** — sin confirmación ni cobro |
| 7 | Payment sin cambios | **PASS** — no referenciado |
| 8 | `4C` y `4D` intactos | **PASS** — sin ediciones |
| 9 | `MIGRATION_001`–`010` intactas | **PASS** |
| 10 | `MIGRATION_011` no creada | **PASS** |
| 11 | Sin cambios en código de negocio | **PASS** — sólo contrato y documentación |

## 7. Frontera del bloque de implementación

**Archivos que el bloque de implementación podrá modificar:**

- `packages/contracts/src/ipc.ts` — incorporar los cinco `message_type` a
  `IpcMessageTypeSchema` y a las uniones
- `apps/pos-local-service/src/channel/local-channel-component.ts` — cinco `case`
  y la resolución de identidad confiable
- `apps/pos-desktop/src/ipc-allowlist.ts` — canales `pos:` correspondientes
- `apps/pos-desktop/src/channel-bridge.ts` · `preload-api.ts` — puente
- `apps/pos-local-service/tests/` — pruebas de integración nuevas
- `packages/contracts/src/ipc-commercial.ts` — sólo correcciones derivadas de la
  implementación

**Archivos explícitamente prohibidos:**

- `packages/database-sqlite/src/local-database.ts` — ninguna migración
- `apps/pos-local-service/src/cash/**` — `4D` cerrado
- `apps/pos-local-service/src/sales/**` — `4C` cerrado
- `apps/pos-local-service/src/session/**` · `src/security/**` — sin `DEC-015`
- `docs/adr/DEC-011` · `DEC-012` · `DEC-013`
- cualquier archivo de Payment, CashCount o Inventory

**Impacto en migraciones: CERO.** Si `DEC-015` resuelve `PD-2` con almacenamiento
durable, la migración correspondiente será alcance de esa decisión, no de ésta.

## 8. Gobernanza

Este documento cierra `PD-1` y `PD-3`, y cierra `PD-2` sólo en su dimensión de
modelo. La dimensión de mecanismo queda abierta como `DEC-015`.

`BLOQUE 4E IMPLEMENTATION READY = NO` mientras `DEC-015` no se ratifique, salvo
que se autorice por separado el alcance acotado de §4.5.

Ningún `SEC-Gxx` cambia de estado por este documento.
