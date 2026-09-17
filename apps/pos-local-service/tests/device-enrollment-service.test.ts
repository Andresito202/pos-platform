import { generateKeyPairSync } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import {
  CentralDeviceCredentialIssuer,
  DeviceTrustVerifier,
  canonicalDeviceTrustJson,
  type CentralDeviceEnrollmentRepository,
} from "@pos-platform/device-trust";
import {
  DeviceEnrollmentService,
  DeviceIdentity,
  EncryptedFileSecretStore,
  InsecureDerivedKeyProvider,
} from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-device-enrollment-"));
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

const ISSUER = generateKeyPairSync("ed25519");
const ROOT = generateKeyPairSync("ed25519");
const TRUST_KEY_ID = "DEVICE_TRUST_TEST";

async function fixture() {
  const dir = await directory();
  const database = LocalDatabase.open({ dataDirectory: dir });
  const secretDir = join(dir, "security");
  const store = new EncryptedFileSecretStore(
    secretDir,
    new InsecureDerivedKeyProvider(secretDir),
    `test-device:${binding.installationId}:${binding.deviceId}`,
  );
  const identity = DeviceIdentity.create(store);
  store.destroy();
  return { dir, database, identity };
}

function activation(overrides: Record<string, unknown> = {}) {
  return {
    activation_id: "018f0000-0000-7000-8000-000000000010",
    tenant_id: binding.tenantId,
    company_id: binding.companyId,
    installation_id: binding.installationId,
    device_id: binding.deviceId,
    activation_secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
    status: "ISSUED" as const,
    issued_at: "2026-09-16T11:00:00Z",
    expires_at: "2026-09-16T13:00:00Z",
    version: 1,
    ...overrides,
  };
}

function verifier(): DeviceTrustVerifier {
  return new DeviceTrustVerifier(
    ROOT.publicKey,
    new Map([[TRUST_KEY_ID, {
      key: ISSUER.publicKey,
      status: "ACTIVE",
      validFrom: "2026-09-16T11:00:00Z",
    }]]),
    {
      now: () => new Date("2026-09-16T12:00:00Z"),
      accept: () => undefined,
    },
  );
}

describe("D-3 device enrollment coordinator", () => {
  it("creates one canonical request with challenge proof and does not persist the activation secret", async () => {
    const { database, identity } = await fixture();
    const service = new DeviceEnrollmentService(database, identity, binding, () => new Date("2026-09-16T12:00:00Z"));

    const prepared = service.prepare(activation());
    expect(prepared.decision).toBe("READY");
    expect(prepared.request?.device_key_id).toBe(identity.deviceKeyId());
    expect(prepared.request?.device_public_key_pem).toBe(identity.publicKeyPem());
    expect(prepared.request?.challenge.device_id).toBe(binding.deviceId);
    expect(prepared.request?.proof.challenge_id).toBe(prepared.request?.challenge.challenge_id);
    expect(prepared.request?.proof.signature).toBeTruthy();

    const audit = database.native.prepare("SELECT details_json FROM local_security_audit").all() as Array<{ details_json: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details_json).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    database.close();
  });

  it("fails closed for wrong binding, revoked and expired activations", async () => {
    const { database, identity } = await fixture();
    const service = new DeviceEnrollmentService(database, identity, binding, () => new Date("2026-09-16T12:00:00Z"));

    expect(service.prepare(activation({ device_id: "018f0000-0000-7000-8000-000000000099" })).decision).toBe("BINDING_MISMATCH");
    expect(service.prepare(activation({ status: "REVOKED" })).decision).toBe("ACTIVATION_REVOKED");
    expect(service.prepare(activation({ expires_at: "2026-09-16T11:59:59Z" })).decision).toBe("ACTIVATION_EXPIRED");
    database.close();
  });

  it("accepts only a centrally issued credential with a valid operational signature", async () => {
    const { database, identity } = await fixture();
    const service = new DeviceEnrollmentService(database, identity, binding, () => new Date("2026-09-16T12:00:00Z"));
    const prepared = service.prepare(activation());
    expect(prepared.request).not.toBeNull();

    const devicePublicKey = identity.publicKeyPem();
    const repository: CentralDeviceEnrollmentRepository = {
      findDevice: async () => ({
        device_id: binding.deviceId,
        installation_id: binding.installationId,
        tenant_id: binding.tenantId,
        company_id: binding.companyId,
        device_key_id: identity.deviceKeyId(),
        device_public_key: devicePublicKey,
        status: "PENDING",
        trust_key_id: TRUST_KEY_ID,
        trust_key_purpose: "DEVICE_TRUST",
      }),
      consumeActivationAndIssueCredential: async () => true,
    };
    const issuer = new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, {
      now: () => new Date("2026-09-16T12:00:00Z"),
    });
    const centralResult = await issuer.issue({
      request: prepared.request!,
      challenge: prepared.request!.challenge,
      expires_at: "2026-09-17T12:00:00Z",
    });

    const completed = service.complete(centralResult, verifier());
    expect(completed.credential_id).toBe(centralResult.credential_id);
    expect(completed.credential).not.toBeNull();
    expect(service.prepare(activation()).decision).toBe("ALREADY_ENROLLED");
    database.close();
  });

  it("rejects a credential whose operational signature is invalid", async () => {
    const { database, identity } = await fixture();
    const service = new DeviceEnrollmentService(database, identity, binding, () => new Date("2026-09-16T12:00:00Z"));
    service.prepare(activation());

    const credential = SignedDeviceTrustCredentialSchema.parse({
      claims: {
        credential_id: "018f0000-0000-7000-8000-000000000011",
        key_id: TRUST_KEY_ID,
        tenant_id: binding.tenantId,
        company_id: binding.companyId,
        installation_id: binding.installationId,
        device_id: binding.deviceId,
        device_public_key_pem: identity.publicKeyPem(),
        issued_at: "2026-09-16T12:00:00Z",
        not_before: "2026-09-16T12:00:00Z",
        expires_at: "2026-09-17T12:00:00Z",
        version: 1,
      },
      signature: "A".repeat(86),
    });

    expect(() => service.complete({
      status: "ENROLLED",
      activation_id: activation().activation_id,
      credential_id: credential.claims.credential_id,
      credential,
      enrolled_at: "2026-09-16T12:01:00Z",
      reason: null,
      version: 1,
    }, verifier())).toThrow("CREDENTIAL_SIGNATURE_INVALID");
    expect(service.prepare(activation()).decision).toBe("PENDING");
    database.close();
  });

  it("does not treat a rejected result as successful enrollment", async () => {
    const { database, identity } = await fixture();
    const service = new DeviceEnrollmentService(database, identity, binding, () => new Date("2026-09-16T12:00:00Z"));
    service.prepare(activation());

    expect(() => service.complete({
      status: "REJECTED",
      activation_id: activation().activation_id,
      credential_id: null,
      credential: null,
      enrolled_at: "2026-09-16T12:01:00Z",
      reason: "CENTRAL_REJECTED",
      version: 1,
    }, verifier())).toThrow("CENTRAL_REJECTED");
    expect(service.prepare(activation()).decision).toBe("PENDING");
    database.close();
  });
});
