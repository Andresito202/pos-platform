import {
  CentralTransportError,
  type CentralHttpRequest,
  type CentralHttpResponse,
  type CentralTransport,
} from "./central-transport.js";

/**
 * Transporte real sobre `fetch`.
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
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body,
        redirect: "error",
        signal: deadline.signal,
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    } catch (error) {
      // A failed fetch does not distinguish a pre-send network failure from
      // a dropped response after the server committed the request. Mark the
      // result as uncertain; operation-level idempotency handles safe retries.
      const aborted = error instanceof Error && error.name === "AbortError";
      const code = aborted ? "READ_TIMEOUT" : "CONNECTION_FAILURE";
      throw new CentralTransportError(`central transport ${code}`, code, true);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  }
}
