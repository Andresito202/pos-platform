import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AndroidKeystoreKeyProvider } from "../src/security/android-keystore-key-provider.js";
import { AndroidCommercialHost } from "../src/android/android-commercial-host.js";
import { AndroidBusinessNativeCentralClient } from "../src/android/android-business-native-central.js";

describe("AndroidCommercialHost", () => {
  it("starts fail-closed without provision and rejects commercial requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-android-host-"));
    const provider = new AndroidKeystoreKeyProvider(Buffer.alloc(32, 7), "android");
    const host = new AndroidCommercialHost(directory, provider);
    try {
      await host.start();
      expect(host.status()).toMatchObject({
        state: "READY",
        commercial_access: "BLOCKED_PENDING_TRUSTED_PROVISIONING",
        engine: "EMBEDDED_NODE_SQLITE",
      });
      const denied = await host.handleRequest({
        protocol_version: "1.0.0",
        message_type: "catalog.item.list",
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { query: "", limit: 20, offset: 0 },
      });
      expect(denied).toMatchObject({
        status: "FAILED",
        result_code: "DEVICE_NOT_PROVISIONED",
      });
      expect((denied as { error: { user_message: string } }).error.user_message).toMatch(/aprovisionado/i);
    } finally {
      await host.stop();
      provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when packaged mode requires runtime files.json and it is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-android-host-"));
    const provider = new AndroidKeystoreKeyProvider(Buffer.alloc(32, 7), "android");
    const previous = process.env.ANDROID_REQUIRE_RUNTIME_MANIFEST;
    process.env.ANDROID_REQUIRE_RUNTIME_MANIFEST = "1";
    const host = new AndroidCommercialHost(directory, provider);
    try {
      await expect(host.start()).rejects.toThrow(/ANDROID_RUNTIME_MANIFEST_REQUIRED/);
      expect(host.status().state).toBe("FAILED");
    } finally {
      if (previous === undefined) delete process.env.ANDROID_REQUIRE_RUNTIME_MANIFEST;
      else process.env.ANDROID_REQUIRE_RUNTIME_MANIFEST = previous;
      await host.stop().catch(() => undefined);
      provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects unknown message types through IpcRequestSchema before the commercial handler", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-android-host-"));
    const provider = new AndroidKeystoreKeyProvider(Buffer.alloc(32, 5), "android");
    const host = new AndroidCommercialHost(directory, provider);
    try {
      await host.start();
      const denied = await host.handleRequest({
        protocol_version: "1.0.0",
        message_type: "totally.unknown.operation",
        request_id: randomUUID(),
        correlation_id: null,
        payload: {},
      });
      expect(denied).toMatchObject({
        status: "FAILED",
        result_code: "INVALID_REQUEST",
      });
    } finally {
      await host.stop();
      provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects operator login when no operator store is present", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-android-host-"));
    const provider = new AndroidKeystoreKeyProvider(Buffer.alloc(32, 9), "android");
    const host = new AndroidCommercialHost(directory, provider);
    try {
      await host.start();
      const denied = await host.handleRequest({
        protocol_version: "1.0.0",
        message_type: "local.operator.login",
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { username: "cajero.local", password: "x" },
      });
      expect(denied).toMatchObject({
        status: "FAILED",
        result_code: "OPERATOR_STORE_UNAVAILABLE",
      });
    } finally {
      await host.stop();
      provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on BUSINESS native-request and token exchange without Central client", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-android-host-"));
    const provider = new AndroidKeystoreKeyProvider(Buffer.alloc(32, 3), "android");
    const host = new AndroidCommercialHost(directory, provider);
    try {
      await host.start();
      const native = await host.handleRequest({
        protocol_version: "1.0.0",
        message_type: "android.business.native_request",
        request_id: randomUUID(),
        payload: {
          client_id: "android-commercial",
          redirect_uri: "https://central.camachoposcolombia.com/android/callback",
          code_challenge: "a".repeat(43),
          code_challenge_method: "S256",
          state: "b".repeat(43),
          purpose: "BUSINESS_NATIVE_AUTHORIZATION_V1",
        },
      });
      expect(native).toMatchObject({
        status: "FAILED",
        result_code: "BUSINESS_NATIVE_REQUEST_UNAVAILABLE",
      });
      const token = await host.handleRequest({
        protocol_version: "1.0.0",
        message_type: "android.business.token_exchange",
        request_id: randomUUID(),
        payload: {
          code: "c".repeat(64),
          code_verifier: "d".repeat(64),
          state: "e".repeat(43),
          client_id: "android-commercial",
          redirect_uri: "https://central.camachoposcolombia.com/android/callback",
        },
      });
      expect(token).toMatchObject({
        status: "FAILED",
        result_code: "BUSINESS_TOKEN_EXCHANGE_UNAVAILABLE",
      });
    } finally {
      await host.stop();
      provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed android.business payloads without calling Central", async () => {
    const directory = await mkdtemp(join(tmpdir(), "camacho-android-host-"));
    const provider = new AndroidKeystoreKeyProvider(Buffer.alloc(32, 1), "android");
    const host = new AndroidCommercialHost(directory, provider);
    try {
      await host.start();
      const denied = await host.handleRequest({
        protocol_version: "1.0.0",
        message_type: "android.business.native_request",
        request_id: randomUUID(),
        payload: { purpose: "NOT_A_REAL_PURPOSE" },
      });
      expect(denied).toMatchObject({
        status: "FAILED",
        result_code: "INVALID_REQUEST",
      });
    } finally {
      await host.stop();
      provider.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("AndroidBusinessNativeCentralClient", () => {
  it("composes challenge → DeviceProof native-request → selector without inventing SSA", async () => {
    const authorization = vi.fn(async () => "DeviceProof test");
    const credential = { authorization } as never;
    const challenge = "C".repeat(43);
    const selector = "R".repeat(43);
    const transport = vi.fn(async (url: URL, init?: RequestInit) => {
      const path = url.pathname;
      if (path === "/v1/commercial/native-request-challenges") {
        expect(init?.headers).not.toMatchObject({ authorization: expect.anything() });
        return new Response(
          JSON.stringify({
            challenge_id: "018f0000-0000-7000-8000-000000000099",
            challenge,
            expires_at: "2099-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (path === "/v1/commercial/native-requests") {
        expect(authorization).toHaveBeenCalled();
        return new Response(
          JSON.stringify({
            request: selector,
            expires_at: "2099-01-01T00:02:00.000Z",
            authorization_url: `https://central.camachoposcolombia.com/v1/commercial/login?request=${selector}`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${path}`);
    });
    const client = new AndroidBusinessNativeCentralClient(
      "https://central.camachoposcolombia.com",
      credential,
      transport as typeof fetch,
      5_000,
    );
    const result = await client.registerNativeRequest({
      client_id: "android-commercial",
      redirect_uri: "https://central.camachoposcolombia.com/android/callback",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      state: "b".repeat(43),
      purpose: "BUSINESS_NATIVE_AUTHORIZATION_V1",
    });
    expect(result.request).toBe(selector);
    expect(result.authorization_url).toContain(selector);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("maps Central 503 to CENTRAL_NATIVE_ROUTE_NOT_ACTIVATED", async () => {
    const credential = { authorization: async () => "DeviceProof test" } as never;
    const transport = vi.fn(async () => new Response("{}", { status: 503 }));
    const client = new AndroidBusinessNativeCentralClient(
      "https://central.camachoposcolombia.com",
      credential,
      transport as typeof fetch,
      5_000,
    );
    await expect(
      client.registerNativeRequest({
        client_id: "android-commercial",
        redirect_uri: "https://central.camachoposcolombia.com/android/callback",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        state: "b".repeat(43),
        purpose: "BUSINESS_NATIVE_AUTHORIZATION_V1",
      }),
    ).rejects.toThrow("CENTRAL_NATIVE_ROUTE_NOT_ACTIVATED");
  });

  it("exchanges token then fetches SSA via /v1/business-session/assertions", async () => {
    const authorization = vi.fn(async () => "DeviceProof test");
    const credential = { authorization } as never;
    const header = "x-commercial-business-access";
    const id = (n: string) => `018f0000-0000-7000-8000-00000000000${n}`;
    const now = Math.floor(Date.now() / 1000);
    const claims = Buffer.from(JSON.stringify({
      ver: 2,
      iss: "https://central.camachoposcolombia.com",
      aud: "camacho-commercial",
      sub: id("1"),
      sid: id("2"),
      tid: id("3"),
      mid: id("4"),
      did: id("5"),
      iid: id("6"),
      cid: id("7"),
      client_id: "android-commercial",
      fid: id("8"),
      iat: now,
      exp: now + 3600,
      jti: id("9"),
      cnf: { jkt: "a".repeat(43) },
    }), "utf8").toString("base64url");
    const accessToken = `hdr.${claims}.sig`;
    const refreshToken = "r".repeat(64);
    const transport = vi.fn(async (url: URL, init?: RequestInit) => {
      const path = url.pathname;
      const headers = init?.headers as Record<string, string>;
      if (path === "/v1/commercial/token") {
        expect(authorization).toHaveBeenCalled();
        return new Response(
          JSON.stringify({ accessToken, refreshToken }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (path === "/v1/business-session/assertions") {
        expect(headers[header]).toBe(accessToken);
        expect(authorization).toHaveBeenCalled();
        return new Response(
          JSON.stringify({ session_assertion: "SSA_PLACEHOLDER" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${path}`);
    });
    const client = new AndroidBusinessNativeCentralClient(
      "https://central.camachoposcolombia.com",
      credential,
      transport as typeof fetch,
      5_000,
    );
    const result = await client.exchangeToken({
      code: "c".repeat(64),
      code_verifier: "d".repeat(64),
      state: "e".repeat(43),
      client_id: "android-commercial",
      redirect_uri: "https://central.camachoposcolombia.com/android/callback",
    });
    expect(result.session_assertion).toEqual({ session_assertion: "SSA_PLACEHOLDER" });
    expect(result.access_token).toBe(accessToken);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
