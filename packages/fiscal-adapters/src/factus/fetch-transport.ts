import { HttpTransportError, type HttpRequest, type HttpResponse, type HttpTransport } from "./http.js";

/**
 * Transporte real sobre `fetch`.
 *
 * **No se usa en CI.** Existe para la suite de sandbox que ejecuta el
 * responsable en su máquina (`D-4`, nivel 2). Los contract tests inyectan un
 * fake determinista y nunca llegan aquí.
 *
 * Lo único no trivial que hace es decidir si la petición **llegó a salir**. Esa
 * distinción es la que separa un fallo reintentable de un desenlace incierto, y
 * equivocarse en ella puede duplicar un documento fiscal ante la DIAN. Se
 * resuelve por el lado conservador: si `fetch` falló después de establecer la
 * conexión, se asume que salió.
 */
export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly timeoutMs: number = 30_000) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const abort = (): void => timeout.abort();
    request.signal.addEventListener("abort", abort, { once: true });

    let sent = false;
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: timeout.signal,
      });
      // Hay respuesta: la petición salió, sin duda.
      sent = true;
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    } catch (error) {
      // Sin respuesta. Un aborto por tiempo ocurre con la petición ya enviada;
      // un fallo de resolución o de conexión, antes. Ante la duda, `true`: es
      // el lado que obliga a conciliar en vez de reemitir.
      const aborted = error instanceof Error && error.name === "AbortError";
      const code = aborted ? "READ_TIMEOUT" : "CONNECTION_FAILURE";
      throw new HttpTransportError(`factus transport ${code}`, code, sent || aborted);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  }
}
