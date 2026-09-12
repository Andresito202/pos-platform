import {
  LocalChannelClient,
  type LocalChannelAuthenticator,
} from "@pos-platform/local-channel";
import type { ContractVersionRange } from "@pos-platform/contracts";
import type { ServiceChannel } from "./channel-bridge.js";

/**
 * El adaptador que faltaba: satisface el puerto `ServiceChannel` que
 * `ChannelBridge` ya recibía inyectado, hablando el protocolo del canal local
 * en vez de inventar otro.
 *
 * Es deliberadamente delgado. Todo lo que hace de protocolo —enmarcado, MAC,
 * anti-replay, handshake, correlación de respuestas— lo pone
 * `LocalChannelClient`, el mismo que usa el servicio: **no hay una segunda
 * implementación del protocolo en el Desktop**, que es justo lo que la
 * separación en `@pos-platform/local-channel` vino a permitir.
 *
 * Lo que este adaptador **no** hace, y no debe hacer: conocer SQLite, conocer
 * casos de uso, leer el secreto del canal. El material criptográfico llega ya
 * montado dentro del `LocalChannelAuthenticator`; de dónde sale es una decisión
 * de aprovisionamiento, no de transporte.
 */
/**
 * La parte de `LocalChannelClient` que el adaptador usa. Se nombra
 * estructuralmente —no con la clase— para que una prueba pueda sustituirla sin
 * un cast: el adaptador sólo delega dos métodos y no necesita nada más.
 */
export type LocalChannelExchange = Pick<LocalChannelClient, "request" | "close">;

export class LocalServiceChannel implements ServiceChannel {
  constructor(private readonly client: LocalChannelExchange) {}

  request(requestInput: unknown): Promise<unknown> {
    return this.client.request(requestInput);
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export interface LocalServiceChannelOptions {
  readonly endpoint: string;
  /**
   * Ya construido. El adaptador **no** carga secretos: recibir el autenticador
   * hecho mantiene fuera del Desktop toda decisión sobre dónde vive la clave.
   */
  readonly authenticator: LocalChannelAuthenticator;
  readonly protocolRange: ContractVersionRange;
  /** Sobre `runtime.handshake` que el canal negocia al conectar. */
  readonly handshake: unknown;
  readonly timeoutMs?: number;
}

/**
 * Conecta y negocia antes de entregar el canal. Si el handshake falla, el
 * llamador recibe el error y **no** obtiene un canal a medio abrir: un POS que
 * cree estar conectado y no lo está es peor que uno que sabe que no lo está
 * (`DEC-010` §156).
 */
export async function connectLocalServiceChannel(
  options: LocalServiceChannelOptions,
): Promise<ServiceChannel> {
  const client = options.timeoutMs === undefined
    ? new LocalChannelClient(options.endpoint, options.authenticator, options.protocolRange)
    : new LocalChannelClient(
      options.endpoint,
      options.authenticator,
      options.protocolRange,
      options.timeoutMs,
    );
  await client.connect(options.handshake);
  return new LocalServiceChannel(client);
}
