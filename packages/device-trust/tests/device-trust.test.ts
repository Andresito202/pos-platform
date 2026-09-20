import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SignedDeviceTrustCredentialSchema,
  SignedDeviceTrustOperationalKeySchema,
  type DeviceTrustChallenge,
  type DeviceTrustCredentialClaims,
  type DeviceTrustOperationalKeyClaims,
} from "@pos-platform/contracts";
import {
  DeviceTrustVerifier,
  unsignedDeviceTrustChallengeBytes,
  unsignedDeviceTrustCredentialBytes,
  unsignedDeviceTrustOperationalKeyBytes,
  type DeviceTrustBinding,
  type DeviceTrustClock,
} from "../src/index.js";

const ROOT = generateKeyPairSync("ed25519");
const OPERATIONAL = generateKeyPairSync("ed25519");
const DEVICE = generateKeyPairSync("ed25519");
const NOW = new Date("2026-09-16T12:00:00.000Z");

const binding: DeviceTrustBinding = {
  tenantId: "44444444-4444-4444-8444-444444444444",
  companyId: "55555555-5555-4555-8555-555555555555",
  installationId: "33333333-3333-4333-8333-333333333333",
  deviceId: "22222222-2222-4222-8222-222222222222",
};

const devicePublicKeyPem = DEVICE.publicKey.export({ type: "spki", format: "pem" }).toString();

const operationalClaims: DeviceTrustOperationalKeyClaims = {
  key_id: "DEVICE_TRUST_TEST",
  key_purpose: "DEVICE_TRUST",
  public_key_pem: OPERATIONAL.publicKey.export({ type: "spki", format: "pem" }).toString(),
  status: "ACTIVE",
  valid_from: "2026-09-16T11:00:00.000Z",
  version: 1,
};

const signedOperationalKey = SignedDeviceTrustOperationalKeySchema.parse({
  claims: operationalClaims,
  signature: sign(null, unsignedDeviceTrustOperationalKeyBytes(operationalClaims), ROOT.privateKey).toString("base64url"),
});

const credentialClaims: DeviceTrustCredentialClaims = {
  credential_id: "66666666-6666-4666-8666-666666666666",
  key_id: operationalClaims.key_id,
  tenant_id: binding.tenantId,
  company_id: binding.companyId,
  installation_id: binding.installationId,
  device_id: binding.deviceId,
  device_public_key_pem: devicePublicKeyPem,
  issued_at: "2026-09-16T11:30:00.000Z",
  not_before: "2026-09-16T11:30:00.000Z",
  expires_at: "2026-09-17T11:30:00.000Z",
  version: 1,
};

const signedCredential = SignedDeviceTrustCredentialSchema.parse({
  claims: credentialClaims,
  signature: sign(null, unsignedDeviceTrustCredentialBytes(credentialClaims), OPERATIONAL.privateKey).toString("base64url"),
});

function clock(acceptCount?: { value: number }): DeviceTrustClock {
  return {
    now: () => NOW,
    accept: () => {
      if (acceptCount) acceptCount.value += 1;
    },
  };
}

/**
 * Altera la firma **garantizando** que los bytes cambian.
 *
 * Dos intentos anteriores fallaron y la razón importa. El original era
 * `slice(0, -1) + "A"`: si la firma ya terminaba en «A» no cambiaba nada.
 * El segundo intento —cambiar ese último carácter por otro distinto— tampoco
 * bastó, y ahí está lo fino: una firma Ed25519 son 64 bytes = 512 bits, y en
 * base64url **el último carácter sólo aporta 2 bits significativos**; los
 * otros 4 son relleno que el decodificador descarta. `A` (`000000`) y `B`
 * (`000001`) comparten los 2 bits altos, así que decodifican a los mismos 64
 * bytes: la firma «manipulada» seguía siendo válida y el verificador la
 * aceptaba con razón.
 *
 * Medido: con el tamper por carácter, 2 de 5 suites en rojo. Manipular el
 * **byte** es la única forma de garantizar que la firma cambia.
 */
function tamperSignature(signature: string): string {
  const bytes = Buffer.from(signature, "base64url");
  bytes[0] = bytes[0]! ^ 0xff;
  return bytes.toString("base64url");
}

function verifier(status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED" = "ACTIVE", trustClock: DeviceTrustClock = clock()): DeviceTrustVerifier {
  return new DeviceTrustVerifier(
    ROOT.publicKey,
    new Map([[operationalClaims.key_id, {
      key: OPERATIONAL.publicKey,
      status,
      validFrom: operationalClaims.valid_from,
    }]]),
    trustClock,
  );
}

describe("DeviceTrustVerifier", () => {
  it("verifies the root-signed operational key", () => {
    const result = verifier().verifyOperationalKey(signedOperationalKey);
    expect(result.decision).toBe("VALID");
    expect(result.value?.key_id).toBe(operationalClaims.key_id);
  });

  it("distinguishes an invalid root signature from a credential signature failure", () => {
    const tampered = { ...signedOperationalKey, signature: tamperSignature(signedOperationalKey.signature) };
    const result = verifier().verifyOperationalKey(tampered);
    expect(result.decision).toBe("OPERATIONAL_KEY_SIGNATURE_INVALID");
    expect(result.value).toBeNull();
  });

  it("verifies a credential and its installation/device binding", () => {
    const result = verifier().verifyCredential(signedCredential, binding);
    expect(result.decision).toBe("VALID");
    expect(result.value?.device_id).toBe(binding.deviceId);
  });

  it("preserves signed credential claims when the binding is rejected", () => {
    const result = verifier().verifyCredential(signedCredential, {
      ...binding,
      deviceId: "77777777-7777-4777-8777-777777777777",
    });
    expect(result.decision).toBe("CREDENTIAL_BINDING_MISMATCH");
    expect(result.value?.credential_id).toBe(credentialClaims.credential_id);
  });

  it("fails closed for a revoked operational key", () => {
    const result = verifier("REVOKED").verifyCredential(signedCredential, binding);
    expect(result.decision).toBe("KEY_REVOKED");
    expect(result.value).toBeNull();
  });

  it("evaluates the trusted clock once for a proof verification", () => {
    const acceptCount = { value: 0 };
    const challenge: DeviceTrustChallenge = {
      challenge_id: "88888888-8888-4888-8888-888888888888",
      tenant_id: binding.tenantId,
      installation_id: binding.installationId,
      device_id: binding.deviceId,
      nonce: Buffer.from("challenge-nonce-for-d3-clock-test").toString("base64url"),
      issued_at: "2026-09-16T11:59:00.000Z",
      expires_at: "2026-09-16T12:05:00.000Z",
    };
    const proof = {
      credential_id: credentialClaims.credential_id,
      key_id: credentialClaims.key_id,
      challenge_id: challenge.challenge_id,
      signature: sign(null, unsignedDeviceTrustChallengeBytes(challenge), DEVICE.privateKey).toString("base64url"),
    };

    const result = verifier("ACTIVE", clock(acceptCount)).verifyProof(signedCredential, challenge, proof, binding);
    expect(result.decision).toBe("VALID");
    expect(acceptCount.value).toBe(1);
  });

  it("verifies device proof of possession over the canonical challenge bytes", () => {
    const challenge: DeviceTrustChallenge = {
      challenge_id: "88888888-8888-4888-8888-888888888888",
      tenant_id: binding.tenantId,
      installation_id: binding.installationId,
      device_id: binding.deviceId,
      nonce: Buffer.from("challenge-nonce-for-d3-trust-verifier-test").toString("base64url"),
      issued_at: "2026-09-16T11:59:00.000Z",
      expires_at: "2026-09-16T12:05:00.000Z",
    };
    const proof = {
      credential_id: credentialClaims.credential_id,
      key_id: credentialClaims.key_id,
      challenge_id: challenge.challenge_id,
      signature: sign(null, unsignedDeviceTrustChallengeBytes(challenge), DEVICE.privateKey).toString("base64url"),
    };

    const result = verifier().verifyProof(signedCredential, challenge, proof, binding);
    expect(result.decision).toBe("VALID");
    expect(result.value?.device_id).toBe(binding.deviceId);
  });

  it("rejects a tampered proof without accepting the credential", () => {
    const challenge: DeviceTrustChallenge = {
      challenge_id: "88888888-8888-4888-8888-888888888888",
      tenant_id: binding.tenantId,
      installation_id: binding.installationId,
      device_id: binding.deviceId,
      nonce: Buffer.from("challenge-nonce-for-d3-tamper-test").toString("base64url"),
      issued_at: "2026-09-16T11:59:00.000Z",
      expires_at: "2026-09-16T12:05:00.000Z",
    };
    const proof = {
      credential_id: credentialClaims.credential_id,
      key_id: credentialClaims.key_id,
      challenge_id: challenge.challenge_id,
      signature: sign(null, unsignedDeviceTrustChallengeBytes(challenge), DEVICE.privateKey).toString("base64url"),
    };
    const tamperedProof = { ...proof, signature: tamperSignature(proof.signature) };

    const result = verifier().verifyProof(signedCredential, challenge, tamperedProof, binding);
    expect(result.decision).toBe("PROOF_SIGNATURE_INVALID");
    expect(result.value?.credential_id).toBe(credentialClaims.credential_id);
  });
});
