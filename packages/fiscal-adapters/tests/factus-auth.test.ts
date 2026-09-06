import { describe, expect, it } from "vitest";
import { FactusAuthError, FactusAuthenticator, HttpTransportError } from "../src/index.js";
import {
  FAKE_REFERENCE,
  FakeCredentialResolver,
  FakeTransport,
  json,
  tokenResponse,
} from "./factus-fake.js";

const signal = new AbortController().signal;

function clock(start = 1_000_000) {
  let value = start;
  return { now: () => value, advance: (ms: number) => { value += ms; } };
}

describe("OAuth2 password grant", () => {
  it("envía los cuatro valores del cliente con grant_type=password", async () => {
    const transport = new FakeTransport([() => tokenResponse()]);
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", clock());

    expect(await auth.accessToken(FAKE_REFERENCE, signal)).toBe("fake-access-token");

    const request = transport.requests[0];
    expect(request?.url).toBe("https://api-sandbox.factus.com.co/oauth/token");
    const form = new URLSearchParams(request?.body ?? "");
    expect(form.get("grant_type")).toBe("password");
    expect([...form.keys()].sort()).toEqual([
      "client_id",
      "client_secret",
      "grant_type",
      "password",
      "username",
    ]);
  });

  it("usa la base de producción cuando el ambiente es producción", async () => {
    const transport = new FakeTransport([() => tokenResponse()]);
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "PRODUCTION", clock());
    await auth.accessToken(FAKE_REFERENCE, signal);
    expect(transport.requests[0]?.url).toBe("https://api.factus.com.co/oauth/token");
  });
});

describe("ciclo de vida del token", () => {
  it("reutiliza el token mientras siga vigente, sin volver a pedirlo", async () => {
    const transport = new FakeTransport([() => tokenResponse(3600)]);
    const resolver = new FakeCredentialResolver();
    const time = clock();
    const auth = new FactusAuthenticator(transport, resolver, "SANDBOX", time);

    await auth.accessToken(FAKE_REFERENCE, signal);
    time.advance(60_000);
    await auth.accessToken(FAKE_REFERENCE, signal);

    expect(transport.requests).toHaveLength(1);
    expect(resolver.calls).toBe(1);
  });

  it("obedece el `expires_in` devuelto, no un valor codificado", async () => {
    const transport = new FakeTransport([
      () => tokenResponse(60),
      () => tokenResponse(3600),
    ]);
    const time = clock();
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", time);

    await auth.accessToken(FAKE_REFERENCE, signal);
    // 40 s después, con `expires_in` de 60 y margen de 30, ya toca renovar.
    time.advance(40_000);
    await auth.accessToken(FAKE_REFERENCE, signal);

    expect(transport.requests).toHaveLength(2);
    expect(new URLSearchParams(transport.requests[1]?.body ?? "").get("grant_type")).toBe("refresh_token");
  });

  it("renueva con refresh_token y el refresh token recibido", async () => {
    const transport = new FakeTransport([
      () => tokenResponse(60),
      () => tokenResponse(3600),
    ]);
    const time = clock();
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", time);

    await auth.accessToken(FAKE_REFERENCE, signal);
    time.advance(40_000);
    await auth.accessToken(FAKE_REFERENCE, signal);

    const form = new URLSearchParams(transport.requests[1]?.body ?? "");
    expect(form.get("refresh_token")).toBe("fake-refresh-token");
    expect(form.has("password")).toBe(false);
  });

  it("si el refresh es rechazado, reautentica en vez de fallar", async () => {
    let call = 0;
    const transport = new FakeTransport([
      () => {
        call += 1;
        if (call === 1) return tokenResponse(60);
        if (call === 2) return json(401, { error: "invalid_grant" });
        return tokenResponse(3600);
      },
    ]);
    const time = clock();
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", time);

    await auth.accessToken(FAKE_REFERENCE, signal);
    time.advance(40_000);
    expect(await auth.accessToken(FAKE_REFERENCE, signal)).toBe("fake-access-token");

    expect(new URLSearchParams(transport.requests[2]?.body ?? "").get("grant_type")).toBe("password");
  });
});

describe("el error de autenticación no filtra la credencial", () => {
  it("un rechazo no adjunta el cuerpo de la respuesta", async () => {
    const transport = new FakeTransport([
      () => json(401, { error: "invalid_client", client_secret: "fake-client-secret" }),
    ]);
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", clock());

    await expect(auth.accessToken(FAKE_REFERENCE, signal)).rejects.toThrow(FactusAuthError);
    await expect(auth.accessToken(FAKE_REFERENCE, signal)).rejects.toThrow(
      /factus rejected the credential/,
    );

    const error = await auth.accessToken(FAKE_REFERENCE, signal).catch((caught: unknown) => caught);
    expect(JSON.stringify(error instanceof Error ? error.message : "")).not.toContain("fake-client-secret");
  });

  it("una respuesta de token con forma inesperada no se acepta a medias", async () => {
    const transport = new FakeTransport([() => json(200, { access_token: "x" })]);
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", clock());
    await expect(auth.accessToken(FAKE_REFERENCE, signal)).rejects.toThrow(
      /did not match the documented shape/,
    );
  });

  it("un fallo de transporte no se confunde con un rechazo de credencial", async () => {
    const transport = new FakeTransport([
      () => { throw new HttpTransportError("dns", "DNS_FAILURE", false); },
    ]);
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", clock());
    const error = await auth.accessToken(FAKE_REFERENCE, signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FactusAuthError);
    expect((error as FactusAuthError).retryableByReauthentication).toBe(false);
  });

  it("`forget` descarta el token en memoria", async () => {
    const transport = new FakeTransport([() => tokenResponse()]);
    const auth = new FactusAuthenticator(transport, new FakeCredentialResolver(), "SANDBOX", clock());
    await auth.accessToken(FAKE_REFERENCE, signal);
    auth.forget();
    await auth.accessToken(FAKE_REFERENCE, signal);
    expect(transport.requests).toHaveLength(2);
  });
});
