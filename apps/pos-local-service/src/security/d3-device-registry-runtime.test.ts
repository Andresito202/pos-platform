import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { DeviceRegistryEnrollmentRuntime, type DeviceRegistryRow } from "./d3-device-registry-runtime.js";

const device: DeviceRegistryRow = {
  device_id: "22222222-2222-4222-8222-222222222222",
  installation_id: "33333333-3333-4333-8333-333333333333",
  tenant_id: "44444444-4444-4444-8444-444444444444",
  company_id: "55555555-5555-4555-8555-555555555555",
  device_key_id: "device-key",
  device_public_key: "public-key",
  status: "PENDING",
  trust_key_id: "trust-key",
  trust_key_purpose: "DEVICE_TRUST",
};

const input = {
  activation_id: "11111111-1111-4111-8111-111111111111",
  device_id: device.device_id,
  request_checksum: "a".repeat(64),
  generation: 1,
  issued_at: "2026-09-16T12:00:00.000Z",
  expires_at: "2026-09-17T12:00:00.000Z",
};

describe("DeviceRegistryEnrollmentRuntime", () => {
  it("fails closed when the device is unknown", async () => {
    const keys = generateKeyPairSync("ed25519");
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => null,
      consumeActivationAndIssueCredential: async () => true,
    });
    await expect(runtime.issue({ ...input, issuer_private_key: keys.privateKey })).rejects.toThrow("DEVICE_UNKNOWN");
  });

  it("does not consume or issue when the activation cannot be committed", async () => {
    const keys = generateKeyPairSync("ed25519");
    let transactionCalls = 0;
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => device,
      consumeActivationAndIssueCredential: async () => {
        transactionCalls += 1;
        return false;
      },
    });

    await expect(runtime.issue({ ...input, issuer_private_key: keys.privateKey })).rejects.toThrow("ACTIVATION_NOT_CONSUMABLE");
    expect(transactionCalls).toBe(1);
  });

  it("uses one repository transaction for activation consumption and credential issuance", async () => {
    const keys = generateKeyPairSync("ed25519");
    const calls: string[] = [];
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => device,
      consumeActivationAndIssueCredential: async ({ activationId, requestChecksum, credential }) => {
        calls.push(`atomic:${activationId}:${requestChecksum}:${credential.generation}`);
        expect(credential.device.device_id).toBe(device.device_id);
        expect(credential.issuerSignature.length).toBeGreaterThan(0);
        return true;
      },
    });

    const credentialId = await runtime.issue({ ...input, issuer_private_key: keys.privateKey });
    expect(credentialId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toEqual([`atomic:${input.activation_id}:${input.request_checksum}:1`]);
  });
});
