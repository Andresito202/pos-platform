# DEC-023 — Transporte saliente del outbox hacia la autoridad central (`D-2`)

Estado:

`DONE`

---

## Contexto

`DurableSyncStore` ya sabía hacer todo lo difícil: reclamar un lote contiguo
(`claimBatch`), asentar una respuesta verificando su correspondencia
(`recordResponse`), penalizar un fallo con backoff y dead-letter
(`recordTransportFailure`) y rescatar despachos interrumpidos por un reinicio
(`recoverInterruptedDispatches`). `packages/contracts/src/sync.ts` fijaba la
forma del lote y de su respuesta; `packages/contracts/src/http.ts` fijaba el
sobre HTTP del canal dispositivo↔central.

Entre reclamar y asentar **no había nada**. El tablero lo registraba como
«cero cliente HTTP en `src/sync/`», y era exacto: el outbox acumulaba sin
destino.

## Decisión

Se materializa el despacho saliente como **una pieza sola** —`SyncDispatcher`—
que cierra el ciclo `claimBatch → POST → recordResponse | recordTransportFailure`
y no hace nada más.

### 1. El transporte es un parámetro, no `fetch`

`CentralTransport` es un puerto; `FetchCentralTransport` su adapter real. Los
contract tests corren **en CI, sin red y sin credenciales**, inyectando un doble
que implementa el puerto. Es el mismo criterio, y por la misma razón, que el
adapter FACTUS ya aplicaba.

El puerto se **declara en `src/sync/` y no se importa** de
`@pos-platform/fiscal-adapters`, aunque `module-boundaries.json` lo permitiría
(`runtime` → `adapter`). Acoplar el sync al espacio `factus/` ataría dos
integraciones que no comparten ciclo de vida ni cadencia de cambio, y el puerto
de allí documenta desenlaces frente a la DIAN. Se prefiere una duplicación de
treinta líneas, declarada en el comentario, a esa dependencia.

### 2. Simetría de contrato: el cliente se valida con el esquema del servidor

Antes de enviar, el dispatcher valida `{contract_headers, received_body_bytes,
body}` con `createCentralDeviceHttpRequestSchema` —el mismo esquema con que la
autoridad lo validará— y descarta el envío si no pasa. Al recibir, valida con
`createCentralHttpResponseSchema`.

No es purismo: `CentralHttpRequestHeadersSchema` es `strictObject`, de modo que
una cabecera de más o de menos se detecta **en CI, sin servidor**. Se comprobó
por mutación: añadir una sola cabecera fuera del contrato hace caer 8 de las 14
pruebas.

### 3. Sin idempotencia de envelope

El envelope admite `operation_id` + `idempotency_key`, y **no se usan**.
`claimBatch` genera un `batch_id` nuevo en cada reclamación, así que una
idempotencia de lote sería falsa: el mismo contenido reintentado llevaría otra
clave. La idempotencia real es por operación —`SyncOperation.idempotency_key`—
y ya viaja dentro del payload.

### 4. Invariante: ningún lote queda inmovilizado

Un lote reclamado queda `IN_FLIGHT`, y sólo `recoverInterruptedDispatches()` —que
corre en el arranque— lo rescata. Por tanto **toda** salida de `dispatchOnce`
termina en `recordResponse` o en `recordTransportFailure`, incluido el `catch`
de lo imprevisto. Hay una prueba que recorre cuatro clases de fallo —conexión,
cuerpo no-JSON, envelope vacío y excepción del transporte— y comprueba que
ninguna deja filas en `IN_FLIGHT`.

### 5. Controles que el contrato no da

`createCentralHttpResponseSchema` comprueba que la respuesta sea coherente
**consigo misma**, no que sea *esta* respuesta. Se añade la comprobación de que
`body.request_id` coincide con el `request_id` emitido: sin ella, la respuesta a
otra petición en vuelo podría asentarse sobre este lote.

### 6. Fail-closed sobre la credencial de dispositivo

`CentralHttpRequestHeadersSchema` exige `authorization`, e
`integration-contracts.md:208` exige «autenticación de dispositivo conforme a
`DEC-008`». **Nada de eso está materializado**: no hay registro del dispositivo
contra la autoridad ni emisión de credencial.

`DeviceCredentialProvider` declara el puerto y
`UnprovisionedDeviceCredentialProvider` —la implementación por defecto en
producción— **se niega**. Misma disciplina que `sessionSigningKeys` en `main.ts`:
se prefiere la negativa explícita a fabricar una autenticación que nadie ha
provisto.

La credencial se pide **antes** de reclamar el lote. Reclamar primero y
descubrir después la falta de credencial consumiría un intento de reintento por
cada tic del temporizador, castigando al outbox por una carencia que no es suya.

**La credencial no llega nunca por variable de entorno.** Un secreto en el
entorno del proceso es legible por cualquier diagnóstico, acaba en volcados de
memoria y sobrevive en el historial del shell
(`secret-key-and-support-management.md:39`, `security-model.md:155`).

### 7. Configuración: sólo el origen, y sólo sobre TLS

`POS_CENTRAL_BASE_URL` es la única entrada nueva, es opcional y debe ser
`https://` (`DEC-007:1563`, `integration-contracts.md:372`). No se admite
excepción para pruebas: las pruebas inyectan un doble y nunca abren un socket.

Ausente significa «este equipo no tiene autoridad a la que hablar»: no se
construye el componente, el outbox acumula durablemente y eso es el
comportamiento correcto de un sistema local-first sin conexión (`DEC-007`).

La cadencia de despacho **no** se expone por entorno. Un valor mal elegido
castiga a la autoridad o retrasa la conciliación, y no hay caso de uso que
justifique que cada instalación lo decida.

## Lo que esta decisión NO hace

1. **No crea la autoridad central.** `D3` sigue `DOCUMENTED` y
   `packages/database-postgres` sigue sin `src`.
2. **No introduce entrada.** Sólo salida: no se reciben snapshots maestros, ni
   SSA, ni SAS. `MasterSnapshotVerifier` sigue sin cablear.
3. **No toca `G1`.** El despacho usa el `SyncScope` de configuración local, el
   mismo nivel de confianza con que `operation.confirm` opera hoy como actor
   `DEVICE`. No necesita sesión ni `TrustedSigningKey`.
4. **No cambia la política de reintento.** La fija `RetryPolicy` dentro del
   store; el dispatcher sólo aporta el código de error.
5. **No añade dependencias.** `fetch` es del runtime.

## Limitación conocida, aceptada

Un rechazo permanente de la autoridad —una `VALIDATION` no reintentable— se
trata como un fallo más y consume los reintentos hasta acabar en `DEAD_LETTER`.
Distinguirlo exigiría que `DurableSyncStore` expusiera una vía de dead-letter
inmediata, y modificar el store no es alcance de `D-2`. El desenlace es seguro
—no se pierde nada y la operación es recuperable con `requeueDeadLetter`— pero
tarda más de lo necesario. Queda registrado, no disimulado.

## Peldaño que esto acredita

**`TESTED`, y no más.** La regla 1 de la escalera del tablero —«una capacidad
probada que el runtime no instancia se queda en `TESTED`»— aplica literalmente:
`main.ts` sólo construye `CentralSyncComponent` cuando existe
`POS_CENTRAL_BASE_URL`, y ninguna instalación real puede tenerlo mientras no
exista autoridad.

**Un doble no es evidencia de que el transporte funcione contra un servidor
real.** Lo que las 18 pruebas acreditan es que el cliente respeta el contrato y
que ninguna rama de error corrompe el outbox. Nada más.

## Documentos relacionados

- `docs/adr/DEC-007-local-first-data-authority.md`
- `docs/adr/DEC-008-device-trust-license-activation.md`
- `docs/architecture/integration-contracts.md`
- `docs/security/secret-key-and-support-management.md`
- `docs/governance/tablero-materializacion.md`
