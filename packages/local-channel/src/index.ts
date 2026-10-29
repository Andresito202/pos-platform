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
 */
export * from "./framing.js";
export * from "./canonical-json.js";
export * from "./replay-state.js";
export * from "./authenticator.js";
export * from "./endpoint.js";
export * from "./response-schemas.js";
export * from "./client.js";
export * from "./windows-production.js";
export { prepareWindowsHandoffReceiver, windowsHandoffReplaySessionId } from "./windows-handoff.js";
export type { WindowsHandoffRevocationAuthority } from "./windows-handoff.js";
export * from "./windows-native-pipe.js";
export * from "./windows-service-signer.js";
export * from "./windows-scm-client.js";
export {sealSignedWindowsHandoffCandidate,openWindowsHandoff,sealSignedWindowsHandoffForCurrentService,verifySignedWindowsHandoffCandidate,openWindowsHandoffCandidateForCurrentRecipient} from "./windows-handoff.js";
