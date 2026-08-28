import { createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  DeviceIdentity,
  EncryptedFileSecretStore,
  LicenseVerifier,
  TrustedClockGuard,
  unsignedLicenseBytes,
  type SecretStoreKeyProvider,
} from "../src/index.js";

const directories: string[] = [];
async function directory() {
  const value = await mkdtemp(join(tmpdir(), "pos-security-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const installationId = "018f0000-0000-7000-8000-000000000001";
const deviceId = "018f0000-0000-7000-8000-000000000002";

function testKeyProvider(key: Buffer): SecretStoreKeyProvider {
  return {
    protection: "TEST_ONLY",
    loadKey: () => Buffer.from(key),
  };
}

function claims() {
  return {
    license_id: "018f0000-0000-7000-8000-000000000003",
    tenant_id: "018f0000-0000-7000-8000-000000000004",
    company_id: "018f0000-0000-7000-8000-000000000005",
    installation_id: installationId,
    device_id: deviceId,
    mode: "HYBRID" as const,
    entitlements: ["SALES"],
    issued_at: "2026-08-01T00:00:00Z",
    not_before: "2026-08-01T00:00:00Z",
    expires_at: "2026-08-20T00:00:00Z",
    offline_grace_until: "2026-08-30T00:00:00Z",
    key_id: "LICENSE_KEY_1",
  };
}

describe("local security", () => {
  it("encrypts device identity, derives stable device_key_id and detects secret tampering", async () => {
    const dir = await directory();
    mkdirSync(join(dir, "secrets"));
    const store = new EncryptedFileSecretStore(join(dir, "secrets"), testKeyProvider(randomBytes(32)), installationId);
    expect(store.protection).toBe("TEST_ONLY");
    const identity = DeviceIdentity.create(store);
    const reloaded = DeviceIdentity.load(store);
    expect(reloaded.publicKeyPem()).toBe(identity.publicKeyPem());
    expect(reloaded.deviceKeyId()).toBe(identity.deviceKeyId());
    expect(identity.deviceKeyId()).toMatch(/^DEVICE_KEY_[A-F0-9]{64}$/);

    const path = join(dir, "secrets", "device-identity.secret");
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.ciphertext = value.ciphertext.replace(/^./, value.ciphertext[0] === "A" ? "B" : "A");
    writeFileSync(path, JSON.stringify(value));
    expect(() => DeviceIdentity.load(store)).toThrow("authentication failed");
  });

  it("verifies signature, device binding, expiry and offline grace through the trusted clock", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const pair = generateKeyPairSync("ed25519");
    const value = claims();
    const signed = {
      claims: value,
      signature: sign(null, unsignedLicenseBytes(value), pair.privateKey).toString("base64url"),
    };
    const verifier = new LicenseVerifier(
      new Map([["LICENSE_KEY_1", { key: createPublicKey(pair.privateKey), status: "ACTIVE" as const }]]),
      new TrustedClockGuard(database),
      () => new Date("2026-08-25T00:00:00Z"),
    );

    expect(verifier.verify(signed, { installationId, deviceId }, false).decision).toBe("VALID_OFFLINE_GRACE");
    expect(verifier.verify(signed, { installationId, deviceId }, true).decision).toBe("EXPIRED");
    expect(verifier.verify(
      signed,
      { installationId, deviceId: "018f0000-0000-7000-8000-000000000099" },
      true,
    ).decision).toBe("BINDING_MISMATCH");
    expect(verifier.verify(
      { ...signed, claims: { ...value, entitlements: ["ADMIN"] } },
      { installationId, deviceId },
      true,
    ).decision).toBe("SIGNATURE_INVALID");
    database.close();
  });

  it("rejects a revoked signing key before accepting a signed license", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const pair = generateKeyPairSync("ed25519");
    const value = claims();
    const signed = {
      claims: value,
      signature: sign(null, unsignedLicenseBytes(value), pair.privateKey).toString("base64url"),
    };
    const verifier = new LicenseVerifier(
      new Map([["LICENSE_KEY_1", { key: createPublicKey(pair.privateKey), status: "REVOKED" as const }]]),
      new TrustedClockGuard(database),
      () => new Date("2026-08-10T00:00:00Z"),
    );
    expect(verifier.verify(signed, { installationId, deviceId }, true).decision).toBe("SIGNING_KEY_REVOKED");
    database.close();
  });

  it("persists trusted time and rejects material rollback", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const guard = new TrustedClockGuard(database);
    guard.accept(new Date("2026-08-28T12:00:00Z"));
    expect(() => guard.accept(new Date("2026-08-28T11:00:00Z"))).toThrow("rollback");
    database.close();

    const reopened = LocalDatabase.open({ dataDirectory: dir });
    expect(() => new TrustedClockGuard(reopened).accept(new Date("2026-08-28T11:00:00Z"))).toThrow("rollback");
    reopened.close();
  });
});
