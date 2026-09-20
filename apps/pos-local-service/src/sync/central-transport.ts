/**
 * Transporte HTTP saliente hacia la API central (`D-2`).
 *
 * El puerto se declara aquí y no se importa de `@pos-platform/fiscal-adapters`
 * aunque su forma sea casi la misma. `module-boundaries.json` permite que
 * `runtime` dependa de `adapter`, así que importarlo sería legal; lo que no
 * sería sano es que `sync/` dependa del espacio `factus/`, cuyo puerto documenta
 * desenlaces frente a la DIAN y evoluciona con el proveedor fiscal. Se prefiere
 * una duplicación de treinta líneas, declarada, a acoplar dos integraciones que
 * no comparten ciclo de vida ni cadencia de cambio.
 *
 * El transporte es un parámetro, no una importación de `fetch`, por el mismo
 * motivo que allí: los contract tests deben correr en CI **sin red y sin
 * credenciales**, y eso sólo es posible si el doble implementa esta interfaz.
 */

export interface CentralHttpRequest {
  readonly method: "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface CentralHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Fallo de transporte.
 *
 * `sent` distingue «no llegó a salir» de «salió y no sé qué pasó». El outbox
 * tolera ambos —cada operación lleva `idempotency_key` y el inbox inserta con
 * `INSERT OR IGNORE`, de modo que un reintento no duplica nada— pero la
 * distinción se conserva porque decide el código de error que queda escrito en
 * `local_sync_outbox.last_error_code`, y un diagnóstico que confunda las dos
 * manda a soporte al sitio equivocado.
 */
export class CentralTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly sent: boolean,
  ) {
    super(message);
    this.name = "CentralTransportError";
  }
}

export interface CentralTransport {
  send(request: CentralHttpRequest): Promise<CentralHttpResponse>;
}
