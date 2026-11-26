import * as z from "zod";
import {
  CommercialAccessClaimsSchema,
  CommercialHttpV2,
  CommercialRefreshRequestSchema,
  CommercialRevokeRequestSchema,
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
  readonly refreshToken: string;
};

type NativeTokenResponse = {
  accessToken?: string;
  refreshToken?: string;
  access_token?: string;
  refresh_token?: string;
};

type AndroidDeviceProofProvider = Pick<CommercialDeviceCredentialProvider,
  "authorization" | "refreshPossession" | "revokePossession" | "sessionAssertionPossession" | "authorizationSnapshotPossession">;

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
    private readonly credential: AndroidDeviceProofProvider,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
    private readonly registration?: { clientId: string; redirectUri: string; audience: string },
    private readonly acceptManagedLicense?: () => Promise<void>,
  ) {
    this.origin = validateCommercialHttpsOrigin(origin);
    if (!(credential instanceof Object) || typeof credential.authorization !== "function") {
      throw new Error("ANDROID_NATIVE_DEVICE_CREDENTIAL_REQUIRED");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error("ANDROID_NATIVE_TIMEOUT_REQUIRED");
    }
  }

  get clientId(): string | undefined {
    return this.registration?.clientId;
  }

  async registerNativeRequest(raw: unknown): Promise<AndroidNativeRequestResult> {
    const material = AndroidNativeRequestMaterialSchema.parse(raw);
    this.assertRegistration(material);
    await this.acceptManagedLicense?.();
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
    this.assertRegistration(material);
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
    const token = await this.postJson<NativeTokenResponse>("/v1/commercial/token", body, true);
    return this.fetchArtifacts(token, material.client_id);
  }

  async refresh(raw: string, sessionId: string, userId: string): Promise<AndroidTokenExchangeResult> {
    const { clientId, audience } = this.requireRegistration();
    const material = CommercialRefreshRequestSchema.parse({ grant_type: "refresh_token", client_id: clientId, refresh_token: raw });
    const token = await this.postJson<NativeTokenResponse>("/v1/commercial/refresh", JSON.stringify(material), true,
      {}, { token: raw, audience, clientId: material.client_id });
    return this.fetchArtifacts(token, material.client_id, { sessionId, userId });
  }

  async revoke(raw: string): Promise<void> {
    const { clientId, audience } = this.requireRegistration();
    const material = CommercialRevokeRequestSchema.parse({ client_id: clientId, refresh_token: raw });
    const response = await this.postJson<{ revoked?: boolean }>("/v1/commercial/revoke", JSON.stringify(material), true,
      {}, { token: raw, audience, clientId: material.client_id });
    if (response.revoked !== true) throw new Error("CENTRAL_TOKEN_REVOCATION_REJECTED");
  }

  private async fetchArtifacts(token: NativeTokenResponse, clientId: string, expected?: { sessionId: string; userId: string }): Promise<AndroidTokenExchangeResult> {
    const accessToken = token.accessToken ?? token.access_token;
    const refreshToken = token.refreshToken ?? token.refresh_token;
    if (typeof accessToken !== "string" || typeof refreshToken !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(refreshToken)) {
      throw new Error("CENTRAL_TOKEN_CREDENTIALS_REJECTED");
    }
    const payload = accessToken.split(".")[1];
    if (!payload) throw new Error("CENTRAL_ACCESS_TOKEN_REJECTED");
    const claims = CommercialAccessClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    const assertionBody = JSON.stringify({ session_id: claims.sid });
    if (claims.iss !== this.origin || claims.aud !== this.registration?.audience || claims.client_id !== clientId ||
        claims.exp <= Math.floor(Date.now() / 1000) || (expected && (claims.sid !== expected.sessionId || claims.sub !== expected.userId))) {
      throw new Error("CENTRAL_ACCESS_BINDING_REJECTED");
    }
    const assertion = await this.postJson<unknown>(
      "/v1/business-session/assertions",
      assertionBody,
      true,
      { [CommercialHttpV2.accessHeader]: accessToken },
      { token: accessToken, audience: claims.aud, clientId },
    );
    const snapshot = await this.postJson<unknown>(
      "/v1/business-session/authorization", assertionBody, true,
      { [CommercialHttpV2.accessHeader]: accessToken },
      { token: accessToken, audience: claims.aud, clientId },
    );
    // Shape validation is not signature verification; the local authority must
    // Verify both signed objects before activation. The refresh token remains in the service.
    const ssa = z.object({ session_assertion: SignedSessionAssertionSchema }).parse(assertion).session_assertion;
    const sas = z.object({ authorization_snapshot: SignedAuthorizationSnapshotSchema }).parse(snapshot).authorization_snapshot;
    if (ssa.claims.session_id !== claims.sid || ssa.claims.user_id !== claims.sub || sas.claims.user_id !== claims.sub) {
      throw new Error("CENTRAL_SESSION_ARTIFACT_BINDING_REJECTED");
    }
    return { session_assertion: ssa, authorization_snapshot: sas, refreshToken };
  }

  private requireRegistration() {
    if (!this.registration) throw new Error("ANDROID_NATIVE_REGISTRATION_MISMATCH");
    return this.registration;
  }

  private assertRegistration(material: {client_id: string; redirect_uri: string}): void {
    if (!this.registration || material.client_id !== this.registration.clientId || material.redirect_uri !== this.registration.redirectUri) throw new Error("ANDROID_NATIVE_REGISTRATION_MISMATCH");
  }

  private async postJson<T>(
    path:
      | "/v1/commercial/native-request-challenges"
      | "/v1/commercial/native-requests"
      | "/v1/commercial/token"
      | "/v1/commercial/refresh"
      | "/v1/commercial/revoke"
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
    if (path === "/v1/commercial/refresh" || path === "/v1/commercial/revoke") {
      if (!possession) throw new Error("COMMERCIAL_POSSESSION_REQUIRED");
      const context = { ...possession, origin: this.origin, requestId, correlationId, body };
      headers.authorization = path === "/v1/commercial/refresh"
        ? await this.credential.refreshPossession(context)
        : await this.credential.revokePossession(context);
    } else if (path === "/v1/business-session/assertions" || path === "/v1/business-session/authorization") {
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
