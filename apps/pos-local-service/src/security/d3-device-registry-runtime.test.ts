import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  SignedDeviceTrustCredentialSchema,
} from "@pos-platform/contracts";
import {
  DeviceRegistryEnrollmentRuntime,
  activationSecretChecksum,
  type DeviceRegistryRow,
} from "./d3-device-registry-runtime.js";

const deviceKeyPair = generateKeyPairSync("ed25519");
const issuerKeyPair = generateKeyPairSync("ed25519");
const devicePublicKeyPem = deviceKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const device: DeviceRegistryRow = {
  device_id: "22222222-2222-4222-8222-222222222222",
  installation_id: "33333333-3333-4333-8333-333333333333",
  tenant_id: "44444444-4444-4444-8444-444444444444",
  company_id: "55555555-5555-4555-8555-555555555555",
  device_key_id: "DEVICE_KEY_TEST",
  device_public_key: devicePublicKeyPem,
  status: "PENDING",
  trust_key_id: "DEVICE_TRUST_TEST",
  trust_key_purpose: "DEVICE_TRUST",
};

const input = {
  activation_id: "11111111-1111-4111-8111-111111111111",
  activation_secret: "activation-secret-that-is-long-enough-123456",
  device_id: device.device_id,
  issued_at: "2026-09-16T12:00:00.000Z",
  expires_at: "2026-09-17T12:00:00.000Z",
};

describe("DeviceRegistryEnrollmentRuntime", () => {
  it("fails closed when the device is unknown", async () => {
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => null,
      consumeActivationAndIssueCredential: async () => true,
    });
    await expect(runtime.issue({ ...input, issuer_private_key: issuerKeyPair.privateKey })).rejects.toThrow("DEVICE_UNKNOWN");
  });

  it("passes only the activation secret hash to the repository boundary", async () => {
    let observedHash = "";
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => device,
      consumeActivationAndIssueCredential: async ({ activationSecretChecksum, credential }) => {
        observedHash = activationSecretChecksum;
        expect(credential.signedCredential.claims.device_public_key_pem).toBe(devicePublicKeyPem);
        expect(credential.signedCredential.claims.key_id).toBe(device.trust_key_id);
        expect(credential.signedCredential.claims.not_before).toBe(credential.signedCredential.claims.issued_at);
        expect(SignedDeviceTrustCredentialSchema.safeParse(credential.signedCredential).success).toBe(true);
        return false;
      },
    });

    await expect(runtime.issue({ ...input, issuer_private_key: issuerKeyPair.privateKey })).rejects.toThrow("ACTIVATION_NOT_CONSUMABLE");
    expect(observedHash).toBe(activationSecretChecksum(input.activation_secret));
    expect(observedHash).not.toBe(input.activation_secret);
  });

  it("issues the canonical signed DeviceTrust credential before the atomic repository commit", async () => {
    const calls: string[] = [];
    const runtime = new DeviceRegistryEnrollmentRuntime({
      findDevice: async () => device,
      consumeActivationAndIssueCredential: async ({ activationId, activationSecretChecksum, credential }) => {
        calls.push("repository");
        expect(activationId).toBe(input.activation_id);
        expect(activationSecretChecksum).toBe(activationSecretChecksumForTest());
        expect(credential.activationId).toBe(input.activation_id);
        expect(credential.signedCredential.claims.credential_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(credential.signedCredential.signature.length).toBeGreaterThan(0);
        calls.push("signed");
        return true;
      },
    });

    const credentialId = await runtime.issue({ ...input, issuer_private_key: issuerKeyPair.privateKey });
    expect(credentialId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toEqual(["repository", "signed"]);
  });
});

function activationSecretChecksumForTest(): string {
  return activationSecretChecksum(input.activation_secret);
}
