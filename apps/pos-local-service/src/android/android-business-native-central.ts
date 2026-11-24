import { randomUUID } from "node:crypto";
import * as z from "zod";
import { validateCommercialHttpsOrigin } from "@pos-platform/contracts";
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
  readonly session_assertion: unknown;
  readonly access_token?: string;
  readonly refresh_token?: string;
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
    const token = await this.postJson<{
      session_assertion?: unknown;
      access_token?: string;
      refresh_token?: string;
    }>("/v1/commercial/token", body, true);
    if (token.session_assertion === undefined || token.session_assertion === null) {
      throw new Error("CENTRAL_TOKEN_SSA_MISSING");
    }
    return {
      session_assertion: token.session_assertion,
      ...(typeof token.access_token === "string" ? { access_token: token.access_token } : {}),
      ...(typeof token.refresh_token === "string" ? { refresh_token: token.refresh_token } : {}),
    };
  }

  private async postJson<T>(
    path: "/v1/commercial/native-request-challenges" | "/v1/commercial/native-requests" | "/v1/commercial/token",
    body: string,
    requireDeviceProof: boolean,
  ): Promise<T> {
    const requestId = randomUUID();
    const correlationId = randomUUID();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
    };
    if (requireDeviceProof) {
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
