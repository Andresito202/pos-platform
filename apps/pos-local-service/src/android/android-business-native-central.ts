import * as z from "zod";
import {
  CommercialAccessClaimsSchema,
  CommercialHttpV2,
  SignedSessionAssertionSchema,
  SignedAuthorizationSnapshotSchema,
  uuidV7,
  validateCommercialHttpsOrigin,
} from "@pos-platform/contracts";
import type { CommercialDeviceCredentialProvider } from "../security/commercial-device-credential.js";

const Opaque43 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const OpaqueState = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);

/** PKCE material from Android custody. Challenge is obtained from Central. */
export const AndroidNativeRequestMaterialSchema = z.strictObject({
  client_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  redirect_uri: z.string().url(),
  code_challenge: Opaque43,
  code_challenge_method: z.literal("S256"),
  state: OpaqueState,
  purpose: z.literal("BUSINESS_NATIVE_AUTHORIZATION_V1"),
});

export const AndroidTokenExchangeMaterialSchema = z.strictObject({
  code: z.string().regex(/^[A-Za-z0-9._~-]{16,512}$/),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  state: OpaqueState,
  client_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
  redirect_uri: z.string().url(),
});

export type AndroidNativeRequestMaterial = z.infer<typeof AndroidNativeRequestMaterialSchema>;
export type AndroidTokenExchangeMaterial = z.infer<typeof AndroidTokenExchangeMaterialSchema>;

export type AndroidNativeRequestResult = {
  readonly request: string;
  readonly expires_at: string;
  readonly authorization_url: string;
};

export type AndroidTokenExchangeResult = {
  readonly session_assertion: z.infer<typeof SignedSessionAssertionSchema>;
  readonly authorization_snapshot: z.infer<typeof SignedAuthorizationSnapshotSchema>;
};

/**
 * DeviceProof composition for Android BUSINESS native-requests / token.
 * Does not mint SSA. Requires enrolled CommercialDeviceCredentialProvider and a
 * live Central origin. Fail-closed when Central returns non-200 or the body is
 * not the canonical selector / assertion shape.
 */
export class AndroidBusinessNativeCentralClient {
  private readonly origin: string;

  constructor(
    origin: string,
    private readonly credential: CommercialDeviceCredentialProvider,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {
    this.origin = validateCommercialHttpsOrigin(origin);
    if (!(credential instanceof Object) || typeof credential.authorization !== "function") {
      throw new Error("ANDROID_NATIVE_DEVICE_CREDENTIAL_REQUIRED");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error("ANDROID_NATIVE_TIMEOUT_REQUIRED");
    }
  }

  async registerNativeRequest(raw: unknown): Promise<AndroidNativeRequestResult> {
    const material = AndroidNativeRequestMaterialSchema.parse(raw);
    const challengeBody = JSON.stringify({
      client_id: material.client_id,
      redirect_uri: material.redirect_uri,
      code_challenge: material.code_challenge,
      code_challenge_method: material.code_challenge_method,
      state: material.state,
    });
    const challenge = await this.postJson<{
      challenge_id?: string;
      challenge?: string;
      expires_at?: string;
    }>("/v1/commercial/native-request-challenges", challengeBody, false);
    if (
      typeof challenge.challenge_id !== "string"
      || !/^[0-9a-f-]{36}$/i.test(challenge.challenge_id)
      || typeof challenge.challenge !== "string"
      || !Opaque43.safeParse(challenge.challenge).success
    ) {
      throw new Error("CENTRAL_NATIVE_CHALLENGE_REJECTED");
    }

    const registerBody = JSON.stringify({
      purpose: material.purpose,
      challenge_id: challenge.challenge_id,
      challenge: challenge.challenge,
      client_id: material.client_id,
      redirect_uri: material.redirect_uri,
      code_challenge: material.code_challenge,
      code_challenge_method: material.code_challenge_method,
      state: material.state,
    });
    const registered = await this.postJson<{
      request?: string;
      expires_at?: string;
      authorization_url?: string;
    }>("/v1/commercial/native-requests", registerBody, true);
    if (
      typeof registered.request !== "string"
      || !Opaque43.safeParse(registered.request).success
      || typeof registered.expires_at !== "string"
      || typeof registered.authorization_url !== "string"
    ) {
      throw new Error("CENTRAL_NATIVE_REQUEST_REJECTED");
    }
    const url = new URL(registered.authorization_url);
    if (
      url.origin !== this.origin
      || url.pathname !== "/v1/commercial/login"
      || url.searchParams.get("request") !== registered.request
    ) {
      throw new Error("CENTRAL_NATIVE_AUTHORIZATION_URL_REJECTED");
    }
    return {
      request: registered.request,
      expires_at: registered.expires_at,
      authorization_url: registered.authorization_url,
    };
  }

  async exchangeToken(raw: unknown): Promise<AndroidTokenExchangeResult> {
    const material = AndroidTokenExchangeMaterialSchema.parse(raw);
    const body = JSON.stringify({
      grant_type: "authorization_code",
      code: material.code,
      code_verifier: material.code_verifier,
      state: material.state,
      client_id: material.client_id,
      redirect_uri: material.redirect_uri,
    });
    // Historical Central contract: /token returns device-bound access/refresh;
    // SSA is issued separately via /v1/business-session/assertions.
    const token = await this.postJson<{
      accessToken?: string;
      refreshToken?: string;
      access_token?: string;
      refresh_token?: string;
    }>("/v1/commercial/token", body, true);
    const accessToken = token.accessToken ?? token.access_token;
    const refreshToken = token.refreshToken ?? token.refresh_token;
    if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
      throw new Error("CENTRAL_TOKEN_CREDENTIALS_REJECTED");
    }
    const payload = accessToken.split(".")[1];
    if (!payload) throw new Error("CENTRAL_ACCESS_TOKEN_REJECTED");
    const claims = CommercialAccessClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    const assertionBody = JSON.stringify({ session_id: claims.sid });
    if (claims.iss !== this.origin || claims.client_id !== material.client_id || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("CENTRAL_ACCESS_BINDING_REJECTED");
    const assertion = await this.postJson<unknown>(
      "/v1/business-session/assertions",
      assertionBody,
      true,
      { [CommercialHttpV2.accessHeader]: accessToken },
      { token: accessToken, audience: claims.aud, clientId: material.client_id },
    );
    const snapshot = await this.postJson<unknown>(
      "/v1/business-session/authorization", assertionBody, true,
      { [CommercialHttpV2.accessHeader]: accessToken },
      { token: accessToken, audience: claims.aud, clientId: material.client_id },
    );
    // Shape validation is not signature verification; the local authority must
    // verify both signed objects before activation. Never export bearer tokens.
    return {
      session_assertion: SignedSessionAssertionSchema.parse(z.object({session_assertion: z.unknown()}).parse(assertion).session_assertion),
      authorization_snapshot: SignedAuthorizationSnapshotSchema.parse(z.object({authorization_snapshot: z.unknown()}).parse(snapshot).authorization_snapshot),
    };
  }

  private async postJson<T>(
    path:
      | "/v1/commercial/native-request-challenges"
      | "/v1/commercial/native-requests"
      | "/v1/commercial/token"
      | "/v1/business-session/assertions"
      | "/v1/business-session/authorization",
    body: string,
    requireDeviceProof: boolean,
    extraHeaders: Record<string, string> = {},
    possession?: { token: string; audience: string; clientId: string },
  ): Promise<T> {
    // Central commercial HTTPS requires UUID request ids and UUID v7 correlation.
    const requestId = uuidV7();
    const correlationId = uuidV7();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
      ...extraHeaders,
    };
    if (path === "/v1/business-session/assertions" || path === "/v1/business-session/authorization") {
      if (!possession) throw new Error("COMMERCIAL_POSSESSION_REQUIRED");
      const context = { ...possession, origin: this.origin, requestId, correlationId, body };
      headers.authorization = path === "/v1/business-session/assertions"
        ? await this.credential.sessionAssertionPossession(context)
        : await this.credential.authorizationSnapshotPossession(context);
    } else if (requireDeviceProof) {
      headers.authorization = await this.credential.authorization({
        method: "POST",
        path,
        requestId,
        correlationId,
        body,
      });
    }
    const response = await this.transport(new URL(path, this.origin), {
      method: "POST",
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers,
    });
    if (response.status === 503) throw new Error("CENTRAL_NATIVE_ROUTE_NOT_ACTIVATED");
    if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("application/json")) {
      throw new Error("CENTRAL_NATIVE_HTTP_REJECTED");
    }
    const text = await response.text();
    if (text.length > 32 * 1024) throw new Error("CENTRAL_NATIVE_BODY_TOO_LARGE");
    return JSON.parse(text) as T;
  }
}
