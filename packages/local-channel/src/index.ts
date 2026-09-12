/**
 * Protocolo del canal local — la mecánica que cliente y servidor comparten.
 *
 * `DEC-010` §129 fija el transporte: un canal local no expuesto a la red,
 * named pipe de Windows con ACL acotada. `DEC-014` §88 nombra a sus dos
 * extremos: **Electron main ↔ POS Local Service**. Vivían los dos en el
 * servicio, de modo que el extremo cliente era inalcanzable para la capa
 * `desktop`, que `module-boundaries.json` acota a `contracts` y `observability`.
 *
 * Este paquete contiene **sólo lo que ambos extremos ejecutan**: enmarcado,
 * serialización canónica, firma y verificación, anti-replay, resolución del
 * endpoint y el cliente. El contrato del protocolo —`LocalChannelFrameSchema`,
 * el handshake, el versionado y las uniones `IpcRequest`/`IpcResponse`— sigue
 * viviendo en `@pos-platform/contracts`: aquí no se declara protocolo, se
 * implementa el que ya estaba declarado.
 *
 * **Lo que no está aquí es deliberado.** `server.ts`, `windows-pipe-security.ts`
 * y `local-channel-component.ts` se quedan en el servicio: endurecer la DACL de
 * un pipe que no se crea, o gobernar el ciclo de vida de un servidor que no se
 * levanta, no es trabajo de un cliente. Son 1 121 de las 1 661 líneas del módulo
 * original.
 */
export * from "./framing.js";
export * from "./canonical-json.js";
export * from "./replay-state.js";
export * from "./authenticator.js";
export * from "./endpoint.js";
export * from "./response-schemas.js";
export * from "./client.js";
