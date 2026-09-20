import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  DeviceTrustVerifier,
  TrustedClockGuard,
  unsignedDeviceTrustChallengeBytes,
  unsignedDeviceTrustCredentialBytes,
  unsignedDeviceTrustOperationalKeyBytes,
} from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-device-trust-"));
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const binding = {
  tenantId: "018f0000-0000-7000-8000-000000000001",
  companyId: "018f0000-0000-7000-8000-000000000002",
  installationId: "018f0000-0000-7000-8000-000000000003",
  deviceId: "018f0000-0000-7000-8000-000000000004",
};

/** El mismo vinculo en la forma que exigen los *claims* de la credencial. */
const bindingClaims = {
  tenant_id: binding.tenantId,
  company_id: binding.companyId,
  installation_id: binding.installationId,
  device_id: binding.deviceId,
};

/**
 * El reto **no lleva comercio**: se emite contra una instalacion y un equipo,
 * no contra una razon social. Su esquema rechaza `company_id`.
 */
const challengeBinding = {
  tenant_id: binding.tenantId,
  installation_id: binding.installationId,
  device_id: binding.deviceId,
};

/** `TrustedClockGuard` solo aporta `accept`; el reloj se compone con la hora fija. */
function clockAt(database: LocalDatabase, at: string) {
  const guard = new TrustedClockGuard(database);
  return { now: () => new Date(at), accept: (value: Date) => { guard.accept(value); } };
}

function makeFixture(now = "2026-09-16T12:00:00Z") {
  const root = generateKeyPairSync("ed25519");
  const operational = generateKeyPairSync("ed25519");
  const device = generateKeyPairSync("ed25519");
  const operationalClaims = {
    key_id: "DEVICE_TRUST_KEY_1",
    key_purpose: "DEVICE_TRUST" as const,
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }).toString(),
    status: "ACTIVE" as const,
    valid_from: "2026-09-01T00:00:00Z",
    version: 1,
  };
  const signedOperational = {
    claims: operationalClaims,
    signature: sign(null, unsignedDeviceTrustOperationalKeyBytes(operationalClaims), root.privateKey).toString("base64url"),
  };
  const credentialClaims = {
    credential_id: "018f0000-0000-7000-8000-000000000005",
    key_id: "DEVICE_TRUST_KEY_1",
    ...bindingClaims,
    device_public_key_pem: device.publicKey.export({ type: "spki", format: "pem" }).toString(),
    issued_at: "2026-09-01T00:00:00Z",
    not_before: "2026-09-01T00:00:00Z",
    expires_at: "2026-10-01T00:00:00Z",
    version: 1,
  };
  const signedCredential = {
    claims: credentialClaims,
    signature: sign(null, unsignedDeviceTrustCredentialBytes(credentialClaims), operational.privateKey).toString("base64url"),
  };
  const challenge = {
    challenge_id: "018f0000-0000-7000-8000-000000000006",
    ...challengeBinding,
    nonce: Buffer.from("01234567890123456789012345678901").toString("base64url"),
    issued_at: "2026-09-16T11:59:00Z",
    expires_at: "2026-09-16T12:01:00Z",
  };
  const proof = {
    credential_id: credentialClaims.credential_id,
    key_id: credentialClaims.key_id,
    challenge_id: challenge.challenge_id,
    signature: sign(null, unsignedDeviceTrustChallengeBytes(challenge), device.privateKey).toString("base64url"),
  };
  return { root, operational, device, signedOperational, signedCredential, challenge, proof, now };
}

function verifierFor(database: LocalDatabase, fixture: ReturnType<typeof makeFixture>) {
  return new DeviceTrustVerifier(
    fixture.root.publicKey,
    new Map([["DEVICE_TRUST_KEY_1", {
      key: fixture.operational.publicKey,
      status: "ACTIVE" as const,
      validFrom: "2026-09-01T00:00:00Z",
    }]]),
    clockAt(database, fixture.now),
  );
}

describe("D-3 device trust verifier", () => {
  it("validates the root-signed operational key, credential and proof-of-possession", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const fixture = makeFixture();
    const verifier = verifierFor(database, fixture);

    expect(verifier.verifyOperationalKey(fixture.signedOperational).decision).toBe("VALID");
    expect(verifier.verifyCredential(fixture.signedCredential, binding).decision).toBe("VALID");
    expect(verifier.verifyProof(
      fixture.signedCredential,
      fixture.challenge,
      fixture.proof,
      binding,
    ).decision).toBe("VALID");
    database.close();
  });

  it("fails closed for unknown, revoked and not-yet-valid operational keys", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const fixture = makeFixture();
    const verifier = verifierFor(database, fixture);
    expect(verifier.verifyCredential(fixture.signedCredential, { ...binding, deviceId: "018f0000-0000-7000-8000-000000000099" }).decision).toBe("CREDENTIAL_BINDING_MISMATCH");

    const unknown = makeFixture();
    const unknownVerifier = new DeviceTrustVerifier(
      unknown.root.publicKey,
      new Map(),
      clockAt(database, unknown.now),
    );
    expect(unknownVerifier.verifyCredential(unknown.signedCredential, binding).decision).toBe("UNKNOWN_KEY");

    const revokedVerifier = new DeviceTrustVerifier(
      fixture.root.publicKey,
      new Map([["DEVICE_TRUST_KEY_1", {
        key: fixture.operational.publicKey,
        status: "REVOKED" as const,
        validFrom: "2026-09-01T00:00:00Z",
      }]]),
      clockAt(database, fixture.now),
    );
    expect(revokedVerifier.verifyCredential(fixture.signedCredential, binding).decision).toBe("KEY_REVOKED");
    database.close();
  });

  it("rejects tampered credentials, altered challenges and expired challenges", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const fixture = makeFixture();
    const verifier = verifierFor(database, fixture);

    expect(verifier.verifyCredential({
      ...fixture.signedCredential,
      claims: { ...fixture.signedCredential.claims, device_id: "018f0000-0000-7000-8000-000000000099" },
    }, binding).decision).toBe("CREDENTIAL_SIGNATURE_INVALID");

    const alteredChallenge = { ...fixture.challenge, device_id: "018f0000-0000-7000-8000-000000000099" };
    expect(verifier.verifyProof(
      fixture.signedCredential,
      alteredChallenge,
      fixture.proof,
      binding,
    ).decision).toBe("CHALLENGE_BINDING_MISMATCH");

    const expiredFixture = makeFixture("2026-09-16T12:02:00Z");
    const expiredVerifier = verifierFor(database, expiredFixture);
    expect(expiredVerifier.verifyProof(
      expiredFixture.signedCredential,
      expiredFixture.challenge,
      expiredFixture.proof,
      binding,
    ).decision).toBe("CHALLENGE_EXPIRED");
    database.close();
  });
});
