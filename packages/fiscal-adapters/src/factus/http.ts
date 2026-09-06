/**
 * Transporte HTTP inyectado.
 *
 * El adapter no usa `fetch` directamente. La razón no es purismo: es que `D-4`
 * exige que los contract tests corran **en CI, sin red y sin credenciales**, y
 * eso sólo es posible si el transporte es un parámetro. El fake determinista de
 * las pruebas implementa esta misma interfaz.
 */

export interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly signal: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Fallo de transporte.
 *
 * `sentToProvider` es la distinción que decide si un fallo es recuperable o
 * incierto: si la petición **no llegó a salir** se puede reintentar sin riesgo;
 * si salió y no se conoce la respuesta, reintentar puede duplicar un documento
 * fiscal. `electronic-invoicing.md` §Idempotencia regla 5 lo exige.
 */
export class HttpTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly sentToProvider: boolean,
  ) {
    super(message);
    this.name = "HttpTransportError";
  }
}

export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}
