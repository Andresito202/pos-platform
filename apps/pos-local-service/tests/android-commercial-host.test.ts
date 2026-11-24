import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AndroidKeystoreKeyProvider } from "../src/security/android-keystore-key-provider.js";
import { AndroidCommercialHost } from "../src/android/android-commercial-host.js";

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
        payload: {},
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

  it("fails closed on BUSINESS native-request and token exchange without Central", async () => {
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
});
