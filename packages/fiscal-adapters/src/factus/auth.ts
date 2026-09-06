import {
  FactusTokenResponseSchema,
  type FactusCredential,
  type FactusCredentialResolver,
} from "./credential.js";
import { FACTUS_PATH, factusBaseUrl } from "./environment.js";
import { HttpTransportError, type HttpTransport } from "./http.js";
import type { CredentialReference } from "../credential.js";
import type { FiscalEnvironment } from "../provider.js";

/**
 * OAuth2 password grant con refresh (`provider-integration-matrix.md`).
 *
 * Regla que no se relaja: **se obedece siempre el `expires_in` devuelto**. No
 * se codifica un valor de ejemplo ni se asume una duración: la matriz lo dice
 * expresamente y un token caducado en medio de una emisión produce un
 * desenlace incierto, que es lo más caro de resolver.
 */

interface CachedToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtEpochMs: number;
}

/**
 * Margen antes de la caducidad. Renovar en el último milisegundo es apostar a
 * que la red no tarde nada; treinta segundos es el coste de no apostar.
 */
const RENEWAL_MARGIN_MS = 30_000;

export interface FactusAuthOptions {
  readonly now: () => number;
}

export class FactusAuthenticator {
  private token: CachedToken | undefined;

  constructor(
    private readonly transport: HttpTransport,
    private readonly resolver: FactusCredentialResolver,
    private readonly environment: FiscalEnvironment,
    private readonly options: FactusAuthOptions,
  ) {}

  /** Token válido, obteniéndolo o renovándolo según haga falta. */
  async accessToken(reference: CredentialReference, signal: AbortSignal): Promise<string> {
    const cached = this.token;
    if (cached !== undefined && this.options.now() + RENEWAL_MARGIN_MS < cached.expiresAtEpochMs) {
      return cached.accessToken;
    }

    if (cached !== undefined) {
      const refreshed = await this.refresh(cached.refreshToken, reference, signal);
      if (refreshed !== undefined) {
        this.token = refreshed;
        return refreshed.accessToken;
      }
      // Un refresh rechazado no es un fallo terminal: se reautentica. Pero el
      // token viejo se descarta primero, para no reusar credencial inválida.
      this.token = undefined;
    }

    const issued = await this.authenticate(reference, signal);
    this.token = issued;
    return issued.accessToken;
  }

  /** Descarta el token en memoria. Se llama al cerrar el adapter. */
  forget(): void {
    this.token = undefined;
  }

  private async authenticate(
    reference: CredentialReference,
    signal: AbortSignal,
  ): Promise<CachedToken> {
    const credential = await this.resolver.resolve(reference);
    return this.requestToken(
      {
        grant_type: "password",
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
        username: credential.username,
        password: credential.password,
      },
      signal,
    );
  }

  private async refresh(
    refreshToken: string,
    reference: CredentialReference,
    signal: AbortSignal,
  ): Promise<CachedToken | undefined> {
    const credential: FactusCredential = await this.resolver.resolve(reference);
    try {
      return await this.requestToken(
        {
          grant_type: "refresh_token",
          client_id: credential.clientId,
          client_secret: credential.clientSecret,
          refresh_token: refreshToken,
        },
        signal,
      );
    } catch (error) {
      if (error instanceof FactusAuthError && error.retryableByReauthentication) return undefined;
      throw error;
    }
  }

  private async requestToken(
    form: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<CachedToken> {
    let response;
    try {
      response = await this.transport.send({
        method: "POST",
        url: `${factusBaseUrl(this.environment)}${FACTUS_PATH.token}`,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(form).toString(),
        signal,
      });
    } catch (error) {
      const transport = error instanceof HttpTransportError ? error : undefined;
      throw new FactusAuthError(
        "factus authentication transport failure",
        transport?.code ?? "TRANSPORT_FAILURE",
        false,
      );
    }

    if (response.status === 401 || response.status === 400) {
      // El cuerpo puede contener eco de la credencial enviada. No se adjunta.
      throw new FactusAuthError("factus rejected the credential", "CREDENTIAL_REJECTED", true);
    }
    if (response.status !== 200) {
      throw new FactusAuthError(
        `factus authentication returned ${response.status}`,
        "UNEXPECTED_STATUS",
        false,
      );
    }

    const parsed = FactusTokenResponseSchema.safeParse(safeJson(response.body));
    if (!parsed.success) {
      throw new FactusAuthError(
        "factus token response did not match the documented shape",
        "MALFORMED_TOKEN_RESPONSE",
        false,
      );
    }

    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      // `expires_in` viene en segundos y se obedece tal cual.
      expiresAtEpochMs: this.options.now() + parsed.data.expires_in * 1_000,
    };
  }
}

/**
 * Error de autenticación **sin cuerpo de respuesta**.
 *
 * Deliberadamente no transporta el `body`: la respuesta de un rechazo de
 * credencial puede contener eco de lo enviado, y este error acaba en logs.
 * §12.4 del gate exige redacción; aquí simplemente no hay nada que redactar.
 */
export class FactusAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryableByReauthentication: boolean,
  ) {
    super(message);
    this.name = "FactusAuthError";
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}
