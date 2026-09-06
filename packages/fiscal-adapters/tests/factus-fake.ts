import type {
  FactusCredential,
  FactusCredentialResolver,
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from "../src/index.js";
import type { CredentialReference } from "../src/index.js";

/**
 * Fake determinista para los contract tests (`D-4`, nivel 1).
 *
 * Corre en CI, sin red y sin credenciales. Su techo de evidencia es
 * `MOCK_TESTED` y la escalera lo impone: `maxVerificationForSource
 * ("DETERMINISTIC_FAKE")`.
 *
 * **Lo que este fake codifica es nuestra expectativa de la respuesta de FACTUS,
 * no comportamiento observado.** La forma exacta del cuerpo de `/v2/bills/validate`
 * sigue `UNVERIFIED`: no se ha ejecutado una sola petición real. Estas pruebas
 * verifican que *el adapter* se comporta bien ante una respuesta dada; no
 * verifican que el proveedor produzca esa respuesta.
 */

/** Valores inventados que nunca salen del proceso ni se parecen a un secreto real. */
export const FAKE_CREDENTIAL: FactusCredential = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  username: "fake-username",
  password: "fake-password",
};

export const FAKE_REFERENCE: CredentialReference = {
  secretRef: "sec004:fiscal:factus:sandbox",
  version: "1",
};

export class FakeCredentialResolver implements FactusCredentialResolver {
  calls = 0;
  async resolve(): Promise<FactusCredential> {
    this.calls += 1;
    return FAKE_CREDENTIAL;
  }
}

export type Responder = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responders: readonly Responder[]) {}

  private index = 0;

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const responder = this.responders[Math.min(this.index, this.responders.length - 1)];
    this.index += 1;
    if (responder === undefined) throw new Error("fake transport has no responder");
    return responder(request);
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

export function tokenResponse(expiresInSeconds = 3600): HttpResponse {
  return json(200, {
    access_token: "fake-access-token",
    token_type: "Bearer",
    expires_in: expiresInSeconds,
    refresh_token: "fake-refresh-token",
  });
}

/** Responder que atiende `/oauth/token` y delega el resto. */
export function withAuth(next: Responder, expiresInSeconds = 3600): Responder {
  return (request) => (request.url.endsWith("/oauth/token") ? tokenResponse(expiresInSeconds) : next(request));
}
