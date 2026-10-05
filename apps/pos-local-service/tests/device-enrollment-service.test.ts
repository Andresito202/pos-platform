import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { LocalDatabase as LocalDatabaseType } from "@pos-platform/database-sqlite";
import { SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import { CentralDeviceCredentialIssuer, DeviceTrustVerifier, type CentralDeviceEnrollmentRepository } from "@pos-platform/device-trust";
import { DeviceEnrollmentService, DeviceIdentity, EncryptedFileSecretStore, InsecureDerivedKeyProvider, DeviceTrustCredentialStore } from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "pos-device-enrollment-")); directories.push(value); return value; }
afterEach(() => { for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true }); });
const binding = { tenantId: "018f0000-0000-7000-8000-000000000001", companyId: "018f0000-0000-7000-8000-000000000002", installationId: "018f0000-0000-7000-8000-000000000003", deviceId: "018f0000-0000-7000-8000-000000000004" };
const ISSUER = generateKeyPairSync("ed25519");
const ROOT = generateKeyPairSync("ed25519");
const TRUST_KEY_ID = "DEVICE_TRUST_TEST";

async function fixture() {
  const dir = await directory();
  const database = LocalDatabase.open({ dataDirectory: dir });
  const secretDir = join(dir, "security");
  await mkdir(secretDir, { recursive: true });
  const provider = new InsecureDerivedKeyProvider(secretDir);
  const identityStore = new EncryptedFileSecretStore(secretDir, provider, `test-device:${binding.installationId}:${binding.deviceId}`);
  const identity = DeviceIdentity.create(identityStore);
  identityStore.destroy();
  const credentialStore = new DeviceTrustCredentialStore(new EncryptedFileSecretStore(secretDir, provider, `test-credential:${binding.installationId}:${binding.deviceId}`));
  return { dir, database, identity, credentialStore };
}
function activation(overrides: Record<string, unknown> = {}) { return { activation_id: "018f0000-0000-7000-8000-000000000010", tenant_id: binding.tenantId, company_id: binding.companyId, installation_id: binding.installationId, device_id: binding.deviceId, activation_secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", status: "ISSUED" as const, issued_at: "2026-09-16T11:00:00Z", expires_at: "2026-09-16T13:00:00Z", version: 1, ...overrides }; }
function service(database: LocalDatabaseType, identity: DeviceIdentity, credentialStore: DeviceTrustCredentialStore) { return new DeviceEnrollmentService(database, identity, binding, () => new Date("2026-09-16T12:00:00Z"), credentialStore); }
function verifier(): DeviceTrustVerifier { return new DeviceTrustVerifier(ROOT.publicKey, new Map([[TRUST_KEY_ID, { key: ISSUER.publicKey, status: "ACTIVE", validFrom: "2026-09-16T11:00:00Z" }]]), { now: () => new Date("2026-09-16T12:00:00Z"), accept: () => undefined }); }

describe("D-3 device enrollment coordinator", () => {
  it("creates one canonical request without persisting the activation secret", async () => {
    const { database, identity, credentialStore } = await fixture(); const enrollment = service(database, identity, credentialStore); const prepared = enrollment.prepare(activation());
    expect(prepared.decision).toBe("READY"); expect(prepared.request?.device_key_id).toBe(identity.deviceKeyId());
    const audit = database.native.prepare("SELECT details_json FROM local_security_audit").all() as Array<{ details_json: string }>;
    expect(audit).toHaveLength(1); expect(audit[0]?.details_json).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ"); database.close();
  });
  it("fails closed for wrong binding, revoked and expired activations", async () => {
    const { database, identity, credentialStore } = await fixture(); const enrollment = service(database, identity, credentialStore);
    expect(enrollment.prepare(activation({ device_id: "018f0000-0000-7000-8000-000000000099" })).decision).toBe("BINDING_MISMATCH");
    expect(enrollment.prepare(activation({ status: "REVOKED" })).decision).toBe("ACTIVATION_REVOKED"); expect(enrollment.prepare(activation({ expires_at: "2026-09-16T11:59:59Z" })).decision).toBe("ACTIVATION_EXPIRED"); database.close();
  });
  it("accepts only a centrally issued credential and persists the verified signed object", async () => {
    const { database, identity, credentialStore } = await fixture(); const enrollment = service(database, identity, credentialStore); const prepared = enrollment.prepare(activation());
    const repository: CentralDeviceEnrollmentRepository = { findDevice: async () => ({ device_id: binding.deviceId, installation_id: binding.installationId, tenant_id: binding.tenantId, company_id: binding.companyId, device_key_id: identity.deviceKeyId(), device_public_key: identity.publicKeyPem(), status: "PENDING", trust_key_id: TRUST_KEY_ID, trust_key_purpose: "DEVICE_TRUST" }), consumeActivationAndIssueCredential: async () => true };
    const issuer = new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, { now: () => new Date("2026-09-16T12:00:00Z") });
    const centralResult = await issuer.issue({ request: prepared.request!, challenge: prepared.request!.challenge, expires_at: "2026-09-17T12:00:00Z" });
    const completed = enrollment.complete(centralResult, verifier()); expect(completed.credential_id).toBe(centralResult.credential_id); expect(credentialStore.load()).toEqual(centralResult.credential); expect(enrollment.prepare(activation()).decision).toBe("ALREADY_ENROLLED"); database.close();
  });
  it("rejects a credential whose operational signature is invalid", async () => {
    const { database, identity, credentialStore } = await fixture(); const enrollment = service(database, identity, credentialStore); enrollment.prepare(activation());
    const credential = SignedDeviceTrustCredentialSchema.parse({ claims: { credential_id: "018f0000-0000-7000-8000-000000000011", key_id: TRUST_KEY_ID, tenant_id: binding.tenantId, company_id: binding.companyId, installation_id: binding.installationId, device_id: binding.deviceId, device_public_key_pem: identity.publicKeyPem(), issued_at: "2026-09-16T12:00:00Z", not_before: "2026-09-16T12:00:00Z", expires_at: "2026-09-17T12:00:00Z", version: 1 }, signature: "A".repeat(86) });
    expect(() => enrollment.complete({ status: "ENROLLED", activation_id: activation().activation_id, credential_id: credential.claims.credential_id, credential, enrolled_at: "2026-09-16T12:01:00Z", reason: null, version: 1 }, verifier())).toThrow("CREDENTIAL_SIGNATURE_INVALID"); expect(enrollment.prepare(activation()).decision).toBe("PENDING"); database.close();
  });
  it("does not treat a rejected result as successful enrollment", async () => {
    const { database, identity, credentialStore } = await fixture(); const enrollment = service(database, identity, credentialStore); enrollment.prepare(activation());
    expect(() => enrollment.complete({ status: "REJECTED", activation_id: activation().activation_id, credential_id: null, credential: null, enrolled_at: "2026-09-16T12:01:00Z", reason: "CENTRAL_REJECTED", version: 1 }, verifier())).toThrow("CENTRAL_REJECTED"); expect(enrollment.prepare(activation()).decision).toBe("PENDING"); database.close();
  });
});
