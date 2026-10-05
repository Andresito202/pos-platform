import { generateKeyPairSync } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";
import { DeviceTrustCredentialStore } from "../src/security/device-trust-credential-store.js";

const dirs: string[] = [];
const testDeviceKey = generateKeyPairSync("ed25519");
const testDevicePublicKeyPem = testDeviceKey.publicKey.export({ type: "spki", format: "pem" }) as string;
const TEST_DEVICE_KEY_PEM = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const credential = SignedDeviceTrustCredentialSchema.parse({
  claims: {
    credential_id: "018f0000-0000-7000-8000-000000000011",
    key_id: "DEVICE_TRUST_TEST",
    tenant_id: "018f0000-0000-7000-8000-000000000001",
    company_id: "018f0000-0000-7000-8000-000000000002",
    installation_id: "018f0000-0000-7000-8000-000000000003",
    device_id: "018f0000-0000-7000-8000-000000000004",
    device_public_key_pem: TEST_DEVICE_KEY_PEM,
    issued_at: "2099-09-16T12:00:00Z",
    not_before: "2099-09-16T12:00:00Z",
    expires_at: "2099-09-17T12:00:00Z",
    version: 1,
  },
  signature: "A".repeat(86),
});

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("persists and reloads only the signed D-3 credential through the encrypted store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pos-d3-credential-"));
  dirs.push(dir);
  const first = new DeviceTrustCredentialStore(new EncryptedFileSecretStore(dir, new InsecureDerivedKeyProvider(dir), "pos-local-service.device-trust-credential.v1:test"));
  expect(first.has()).toBe(false);
  first.save(credential);
  expect(first.load()).toEqual(credential);

  const raw = readFileSync(join(dir, "device-trust-credential.secret"), "utf8");
  expect(raw).not.toContain(credential.claims.device_id);
  expect(raw).not.toContain(credential.signature);

  const reopened = new DeviceTrustCredentialStore(new EncryptedFileSecretStore(dir, new InsecureDerivedKeyProvider(dir), "pos-local-service.device-trust-credential.v1:test"));
  expect(reopened.load()).toEqual(credential);
});
