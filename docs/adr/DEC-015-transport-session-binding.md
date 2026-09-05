# DEC-015 — Vinculación de sesión de transporte

## Estado

`RATIFICADA` el 2026-09-05. Cierra `PD-2`, que `DEC-014` §4 dejó abierta en su
dimensión de mecanismo.

**No introduce persistencia ni migración.** `MIGRATION_001`–`010` permanecen
intactas y `MIGRATION_011` no existe. La justificación de por qué no hace falta
está en §6, y es la parte de esta decisión que más conviene revisar.

No modifica `DEC-011`, `DEC-012`, `DEC-013` ni `DEC-014` §3 y §5. No toca
Payment, CashCount, Inventory ni `RT-009`. `BLOQUE 4C` y `BLOQUE 4D` no se
editan: sus casos de uso se consumen tal como quedaron.

## 1. El problema exacto

`DEC-014` §4.2 documentó que la flecha `transport sessionId → SSA activa` no
tenía realización posible. Cuatro hechos la bloqueaban:

1. `local_session_assertion` tiene `PRIMARY KEY (user_id, installation_id, device_id)`.
2. `SessionAssertionStore.loadActive(binding)` exige `userId` **como entrada**.
3. `AuthorizationSnapshotStore.loadActive(binding)` exige `userId` igualmente, y
   los cinco casos de uso reciben un `StoredAuthorizationSnapshot`.
4. El `session_id` del marco de transporte lo genera el **cliente**
   (`LocalChannelClient`: `randomUUID()`).

El punto 4 es el decisivo. No basta con encontrar *dónde* guardar el vínculo: hay
que encontrar una clave que el llamador no pueda elegir. Indexar identidad por un
valor que el cliente escoge convierte «conozco el identificador de otro» en «soy
ese otro».

## 2. Tres identificadores que no deben confundirse

| Identificador | Quién lo crea | Alcance | ¿Sirve como clave de identidad? |
|---|---|---|---|
| `transport session_id` | **El cliente** (`randomUUID()`) | Marco del canal | **No.** Elegible por el llamador |
| `SSA.claims.session_id` | La **autoridad central** | Sesión de negocio | No. Es un dato *de* la sesión, no una prueba de conexión |
| `connectionId` | **El servidor**, por conexión aceptada | Socket | **Sí** |

Confundir los dos primeros con el tercero es el error que esta decisión
previene. El `transport session_id` sigue existiendo y sigue sirviendo a lo suyo
—correlación y ventana anti-replay— pero **no gobierna identidad**.

## 3. Decisión — `SERVER-ASSIGNED CONNECTION BINDING`

El servidor asigna a cada conexión aceptada un `connectionId` (`randomUUID()`) y
lo entrega al handler dentro de `ChannelRequestContext`.

```
socket aceptado
  → connectionId = randomUUID()            (servidor, en memoria)
  → session.activate: SSA verificada       (Ed25519 + binding de config)
  → bind(connectionId → identidad)         (SessionBindingRegistry)
  → cash/sale: resolve(connectionId)       → user_id → SAS → Use Case
  → socket close → release(connectionId)
```

La propiedad que lo sostiene: **el `connectionId` no viaja por el cable.** No se
envía en la petición, no se devuelve en la respuesta y no es observable desde el
renderer ni desde el proceso Electron. Un llamador no puede presentarlo,
adivinarlo ni reproducirlo, porque no lo presenta en absoluto: lo aporta el
transporte.

Esto es estrictamente más fuerte que un token portador. Un token existe en algún
lugar del cliente y puede robarse; aquí no hay nada que robar. La única forma de
usar un vínculo es poseer la conexión sobre la que se creó.

## 4. Dónde vive cada pieza

| Pieza | Archivo | Rol |
|---|---|---|
| `ChannelRequestContext`, `connectionId`, `onConnectionClosed` | `channel/server.ts` | Asigna identidad de conexión y avisa de su muerte |
| `SessionBindingRegistry` | `session/session-binding-registry.ts` | Mapa `connectionId → identidad`, con expiración |
| `loadActiveByDevice` | `session/sqlite-session-assertion-store.ts` | Localiza la SSA del dispositivo **sin recibir `user_id`** |
| `CommercialComponent` | `commercial/commercial-component.ts` | Construye casos de uso y sostiene el registro |
| `CommercialRequestHandler` | `commercial/commercial-request-handler.ts` | Los cinco handlers |

## 5. Contrato

### 5.1 `session.activate` establece el vínculo

Único punto que crea un vínculo, y sólo tras `ACTIVATED`.

`user_id` se toma de `claims.user_id` de la SSA presentada. Eso **no** la
convierte en autoridad del llamador:

1. La firma Ed25519 cubre esos claims y se verifica en la capa confiable.
2. `installation_id` y `device_id` los impone la configuración local. Una SSA
   auténtica emitida para otro terminal es `BINDING_MISMATCH`.
3. `SqliteSessionAssertionStore.activate` vuelve a comparar claims contra
   binding.
4. Una `key_id` desconocida es `SIGNATURE_INVALID`.

Presentar una SSA por una vía no confiable es seguro porque su autoridad no
proviene de la vía. Lo máximo que un llamador puede hacer es activar una sesión
**legítimamente emitida por la central para este terminal**, que es exactamente
lo que la operación significa.

### 5.2–5.4 `cash.shift.open`, `cash.shift.close`, `sale.create` consumen el vínculo

```
identity = bindings.resolve(connectionId)      // no hay entrada del llamador
  ausente        → SESSION_NOT_BOUND           (AUTHENTICATION)
snapshot = authorizationStore.loadActive({ identity.userId, config… })
  ausente        → AUTHORIZATION_SNAPSHOT_UNAVAILABLE
useCase.execute(scope(config), identity.ssaSessionId, snapshot, payload)
```

`scope` sale íntegro de la configuración local. El `sessionId` que llega a la
auditoría es el `session_id` de la SSA —la sesión de negocio autenticada—, no el
del transporte.

### 5.5 `session.recover` restablece sólo mediante SSA verificada

La petición **no aporta binding**: `loadActiveByDevice(installationId, deviceId)`
ancla la consulta en configuración y obtiene el `user_id` de la fila. Después
`SessionActivationService.recover` vuelve a verificar la firma. Sin
re-verificación no hay vínculo.

Si el dispositivo tiene más de una sesión vigente el resultado es `AMBIGUOUS` y
**no se elige ninguna**. Escoger sería adivinar de quién es la sesión, que es la
suplantación que este contrato existe para impedir.

### 5.6 La desconexión invalida el vínculo

`socket.once("close")` invoca `onConnectionClosed(connectionId)` y el componente
llama a `release`. Detener el componente hace `clear()`.

Además, `resolve` comprueba `offline_valid_until` en **cada** resolución y borra
el vínculo vencido: una conexión que sobreviva a su SSA deja de tener identidad
sin que nadie la desconecte. Sin gracia offline, igual que `DEC-012` §21.

### 5.7 Una conexión no vinculada nunca obtiene identidad

`resolve` devuelve `null` y la operación se rechaza como `SESSION_NOT_BOUND`.
No existe ruta alternativa: los handlers no leen identidad de ningún otro sitio.

### 5.8 Reconexión y multiconexión

- **Reconexión:** conexión nueva ⇒ `connectionId` nuevo ⇒ sin vínculo. Debe
  volver a activarse o recuperarse. Un `connectionId` anterior no es reutilizable
  porque el cliente nunca lo conoció.
- **Multiconexión:** cada socket tiene su propio `connectionId` y su propio
  vínculo. Dos conexiones no se ven entre sí, y una no hereda nada de la otra por
  el hecho de existir.
- **Rebind:** vincular de nuevo una conexión reemplaza su vínculo. Una conexión
  sostiene como mucho una sesión.

## 6. Por qué no hay persistencia ni `MIGRATION_011`

La pregunta obligada de `DEC-014` §4.4.2bis era si el vínculo necesita almacén
durable. No lo necesita, y persistirlo sería incorrecto:

1. **Un vínculo no puede sobrevivir a su conexión**, y una conexión no sobrevive
   al proceso. Una fila que describiera el vínculo de una conexión inexistente
   sería un estado que §5.6 declara inexpresable.
2. **Lo durable ya está persistido**: la SSA vive en `local_session_assertion`
   (`MIGRATION_007`) con su firma. Tras un reinicio, `session.recover` la
   reverifica y reconstruye el vínculo. La durabilidad está en la evidencia
   criptográfica, no en la asociación efímera.
3. **Persistir abriría un vector nuevo**: un vínculo restaurado desde disco es,
   por definición, un vínculo que nadie estableció verificando una firma en esta
   sesión. Eso contradice §5.5.

Por tanto el mecanismo se resuelve íntegramente con el ciclo de vida del
transporte y la SSA existente, como `DEC-014` §4.4 admitía como preferible.

## 7. Claves de firma — carencia declarada, no resuelta

`SessionAssertionVerifier` recibe un `ReadonlyMap<key_id, TrustedSigningKey>`. El
runtime **no tiene hoy vía de aprovisionamiento de claves**: no existe tabla de
claves de firma ni store que las lea. Es la misma carencia `LIC-003` / `DEV-003`
que ya afecta a licencia y snapshot de autorización, y **no se inventa aquí**.

Consecuencia operativa, explícita: en `main.ts` el mapa se construye vacío, de
modo que en producción `session.activate` **falla cerrado** (`SIGNATURE_INVALID`)
hasta que exista aprovisionamiento. Las pruebas inyectan claves de test.

Se prefiere esa negativa a fabricar una confianza que nadie ha provisto. Queda
registrado como dependencia de `BLOQUE 4E` para operación real; no lo es para la
corrección del mecanismo, que sí queda cerrada.

## 8. Modelo de amenazas

| Amenaza | Resultado |
|---|---|
| Petición sin activar sesión | `SESSION_NOT_BOUND` |
| `connectionId` inventado o de otra conexión | No existe ruta: el llamador no lo transmite |
| Reutilizar el `transport session_id` de otro | Irrelevante: no gobierna identidad |
| `user_id`/`tenant_id`/`actor_id` en la petición | Rechazado por el contrato (`DEC-014` §3.4) |
| SSA sin firma válida | `SIGNATURE_INVALID`, sin vínculo |
| SSA auténtica de otro dispositivo | `BINDING_MISMATCH`, sin vínculo |
| Reenvío de una SSA ya aceptada | `SEQUENCE_REPLAY`, sin vínculo |
| Operar tras expirar la SSA | `resolve` borra el vínculo vencido |
| Operar tras desconectar | `release` en el cierre del socket |
| Dos sesiones vivas en el dispositivo | `recover` devuelve `AMBIGUOUS` y no elige |
| Sesión sin autorización vigente | `AUTHORIZATION_SNAPSHOT_UNAVAILABLE` |
| Sesión válida sin el permiso | `UNAUTHORIZED` de `evaluatePermission()` |

Cada fila tiene prueba en `tests/commercial-ipc.test.ts`.

## 9. Alcance

`BLOQUE 4E IMPLEMENTATION READY = YES` para los cinco métodos ratificados en
`DEC-014` §3.1.

Fuera de alcance, sin cambios: Payment, CashCount, proyecciones reales de
`CATALOG` / `PRICING` / `TAX` (`DEC-013` sigue `NO-GO`), `RT-009` y el
aprovisionamiento de claves de §7. `SandboxCatalogStore` permanece limitado al
alcance sandbox de `DEC-014` §5. La venta sigue terminando en
`READY_FOR_PAYMENT`.

Ningún `SEC-Gxx` cambia de estado por este documento.
