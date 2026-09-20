import {
  CentralTransportError,
  type CentralHttpRequest,
  type CentralHttpResponse,
  type CentralTransport,
} from "./central-transport.js";

/**
 * Transporte real sobre `fetch`.
 *
 * **No se usa en CI.** Las pruebas inyectan un doble determinista que implementa
 * `CentralTransport` y nunca llegan aquí. Existe para la ejecución contra una
 * autoridad real, que hoy no existe (`D3` sigue `DOCUMENTED`).
 *
 * Lo único no trivial es decidir si la petición **llegó a salir**. Se resuelve
 * por el lado conservador —ante la duda, `sent = true`— porque ése es el lado
 * que obliga a conciliar en lugar de asumir que no pasó nada. Mismo criterio y
 * misma razón que `FetchHttpTransport` en `@pos-platform/fiscal-adapters`.
 */
export class FetchCentralTransport implements CentralTransport {
  constructor(private readonly timeoutMs: number = 30_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive safe integer");
    }
  }

  async send(request: CentralHttpRequest): Promise<CentralHttpResponse> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.timeoutMs);
    timer.unref?.();
    const abort = (): void => deadline.abort();
    request.signal.addEventListener("abort", abort, { once: true });

    let sent = false;
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body,
        signal: deadline.signal,
      });
      // Hay respuesta: la petición salió, sin duda.
      sent = true;
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    } catch (error) {
      // Un aborto por tiempo ocurre con la petición ya enviada; un fallo de
      // resolución o de conexión, antes de enviarla.
      const aborted = error instanceof Error && error.name === "AbortError";
      const code = aborted ? "READ_TIMEOUT" : "CONNECTION_FAILURE";
      throw new CentralTransportError(`central transport ${code}`, code, sent || aborted);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  }
}
