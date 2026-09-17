import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { DeviceRegistryEnrollmentRuntime } from "./d3-device-registry-runtime.js";

describe("DeviceRegistryEnrollmentRuntime", () => {
  it("fails closed when the device is unknown", async () => {
    const keys = generateKeyPairSync("ed25519");
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => null,
      consumeActivation: async () => true,
      issueCredential: async () => undefined,
    });
    await expect(runtime.issue({
      activation_id: "11111111-1111-4111-8111-111111111111",
      device_id: "22222222-2222-4222-8222-222222222222",
      request_checksum: "a".repeat(64),
      generation: 1,
      issued_at: "2026-09-16T12:00:00.000Z",
      expires_at: "2026-09-17T12:00:00.000Z",
      issuer_private_key: keys.privateKey,
    })).rejects.toThrow("DEVICE_UNKNOWN");
  });

  it("does not issue a credential when activation is not consumable", async () => {
    const keys = generateKeyPairSync("ed25519");
    const issue = async () => {
      throw new Error("ISSUANCE_SHOULD_NOT_RUN");
    };
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => ({
        device_id: "22222222-2222-4222-8222-222222222222",
        installation_id: "33333333-3333-4333-8333-333333333333",
        tenant_id: "44444444-4444-4444-8444-444444444444",
        company_id: "55555555-5555-4555-8555-555555555555",
        device_key_id: "device-key",
        device_public_key: "public-key",
        status: "PENDING" as const,
        trust_key_id: "trust-key",
        trust_key_purpose: "DEVICE_TRUST" as const,
      }),
      consumeActivation: async () => false,
      issueCredential: issue,
    });
    await expect(runtime.issue({
      activation_id: "11111111-1111-4111-8111-111111111111",
      device_id: "22222222-2222-4222-8222-222222222222",
      request_checksum: "b".repeat(64),
      generation: 1,
      issued_at: "2026-09-16T12:00:00.000Z",
      expires_at: "2026-09-17T12:00:00.000Z",
      issuer_private_key: keys.privateKey,
    })).rejects.toThrow("ACTIVATION_NOT_CONSUMABLE");
  });
});
