import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DeviceEnrollmentRequestSchema,
  DeviceTrustChallengeSchema,
} from "@pos-platform/contracts";
import {
  CentralDeviceCredentialIssuer,
  canonicalDeviceTrustJson,
  createEnrollmentChallenge,
  type CentralDeviceEnrollmentRepository,
  type DeviceEnrollmentClock,
} from "../src/index.js";

const DEVICE = generateKeyPairSync("ed25519");
const WRONG_DEVICE = generateKeyPairSync("ed25519");
const ISSUER = generateKeyPairSync("ed25519");
const DEVICE_PUBLIC_KEY = DEVICE.publicKey.export({ type: "spki", format: "pem" }).toString();

const binding = {
  tenant_id: "44444444-4444-4444-8444-444444444444",
  company_id: "55555555-5555-4555-8555-555555555555",
  installation_id: "33333333-3333-4333-8333-333333333333",
  device_id: "22222222-2222-4222-8222-222222222222",
};

const NOW = new Date("2026-09-16T12:00:00.000Z");

function clock(): DeviceEnrollmentClock {
  return { now: () => NOW };
}

function challenge() {
  return DeviceTrustChallengeSchema.parse(createEnrollmentChallenge({
    ...binding,
    issued_at: "2026-09-16T11:59:00.000Z",
    expires_at: "2026-09-16T12:05:00.000Z",
  }));
}

function requestFor(challengeValue: ReturnType<typeof challenge>, signature = sign(
  null,
  Buffer.from(canonicalDeviceTrustJson(challengeValue)),
  DEVICE.privateKey,
).toString("base64url")) {
  return DeviceEnrollmentRequestSchema.parse({
    activation_id: "11111111-1111-4111-8111-111111111111",
    activation_secret: "A".repeat(43),
    ...binding,
    device_key_id: "device-key-1",
    device_public_key_pem: DEVICE_PUBLIC_KEY,
    challenge: challengeValue,
    proof: {
      challenge_id: challengeValue.challenge_id,
      device_key_id: "device-key-1",
      signature,
    },
    requested_at: "2026-09-16T12:00:00.000Z",
    version: 1,
  });
}

function repository(overrides: Partial<CentralDeviceEnrollmentRepository> = {}): CentralDeviceEnrollmentRepository {
  return {
    findDevice: async () => ({
      device_id: binding.device_id,
      installation_id: binding.installation_id,
      tenant_id: binding.tenant_id,
      company_id: binding.company_id,
      device_key_id: "device-key-1",
      device_public_key: DEVICE_PUBLIC_KEY,
      status: "PENDING" as const,
      trust_key_id: "DEVICE_TRUST_TEST",
      trust_key_purpose: "DEVICE_TRUST" as const,
    }),
    consumeActivationAndIssueCredential: async () => true,
    ...overrides,
  };
}

describe("CentralDeviceCredentialIssuer", () => {
  it("issues only after a valid pre-enrollment proof of possession", async () => {
    const issuer = new CentralDeviceCredentialIssuer(repository(), ISSUER.privateKey, clock());
    const challengeValue = challenge();
    const credentialId = await issuer.issue({
      request: requestFor(challengeValue),
      challenge: challengeValue,
      expires_at: "2026-09-17T12:00:00.000Z",
    });

    expect(credentialId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an invalid proof before consuming the one-shot activation", async () => {
    let consumeCalls = 0;
    const repo = repository({
      consumeActivationAndIssueCredential: async () => {
        consumeCalls += 1;
        return true;
      },
    });
    const issuer = new CentralDeviceCredentialIssuer(repo, ISSUER.privateKey, clock());
    const challengeValue = challenge();

    await expect(issuer.issue({
      request: requestFor(challengeValue, sign(
        null,
        Buffer.from(canonicalDeviceTrustJson(challengeValue)),
        WRONG_DEVICE.privateKey,
      ).toString("base64url")),
      challenge: challengeValue,
      expires_at: null,
    })).rejects.toThrow("ENROLLMENT_PROOF_INVALID");
    expect(consumeCalls).toBe(0);
  });

  it("fails closed when the activation is already consumed or otherwise not consumable", async () => {
    const issuer = new CentralDeviceCredentialIssuer(
      repository({ consumeActivationAndIssueCredential: async () => false }),
      ISSUER.privateKey,
      clock(),
    );
    const challengeValue = challenge();

    await expect(issuer.issue({
      request: requestFor(challengeValue),
      challenge: challengeValue,
      expires_at: null,
    })).rejects.toThrow("ACTIVATION_NOT_CONSUMABLE");
  });

  it("rejects an expired challenge before device proof verification", async () => {
    const issuer = new CentralDeviceCredentialIssuer(repository(), ISSUER.privateKey, clock());
    const expired = DeviceTrustChallengeSchema.parse(createEnrollmentChallenge({
      ...binding,
      issued_at: "2026-09-16T11:00:00.000Z",
      expires_at: "2026-09-16T11:30:00.000Z",
    }));

    await expect(issuer.issue({
      request: requestFor(expired),
      challenge: expired,
      expires_at: null,
    })).rejects.toThrow("ENROLLMENT_CHALLENGE_EXPIRED");
  });
});
