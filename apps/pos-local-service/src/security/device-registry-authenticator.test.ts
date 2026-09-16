import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@pos-platform/local-channel";
import { createHash } from "node:crypto";
import { DeviceRegistryAuthenticator, type DeviceRegistryRecord } from "./device-registry-authenticator.js";

const ids = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  installation_id: "33333333-3333-4333-8333-333333333333",
  device_id: "44444444-4444-4444-8444-444444444444",
  credential_id: "55555555-5555-4555-8555-555555555555",
};

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const rawPublic = publicDer.subarray(publicDer.length - 32);
  const now = "2026-09-16T12:00:00.000Z";
  const credential = {
    ...ids,
    device_key_id: "device-key-1",
    trust_key_id: "trust-key-1",
    key_purpose: "DEVICE_TRUST" as const,
    status: "ACTIVE" as const,
    generation: 1,
    issued_at: "2026-09-16T11:00:00.000Z",
    expires_at: "2026-09-16T13:00:00.000Z",
    credential_checksum: createHash("sha256").update("credential").digest("hex"),
    issuer_signature: "issuer-signature",
  };
  return { privateKey, rawPublic, credential, now };
}

function requestFixture(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], credentialId: string) {
  const challenge = "A".repeat(64);
  const body = {
    challenge,
    credential_id: credentialId,
    device_id: ids.device_id,
    installation_id: ids.installation_id,
    tenant_id: ids.tenant_id,
    company_id: ids.company_id,
  };
  const digest = createHash("sha256").update(canonicalJson(body)).digest("hex");
  const proof_signature = sign(null, Buffer.from(digest, "utf8"), privateKey).toString("base64url");
  return { ...body, proof_signature };
}

describe("DeviceRegistryAuthenticator", () => {
  it("accepts an active credential with valid proof and binding", async () => {
    const f = fixture();
    const registry: DeviceRegistryRecord = {
      credential: f.credential,
      device_public_key: f.rawPublic.toString("base64url"),
    };
    const authenticator = new DeviceRegistryAuthenticator(
      { getCredential: async () => registry },
      { now: () => new Date(f.now) },
    );
    await expect(authenticator.authenticate(requestFixture(f.privateKey, ids.credential_id))).resolves.toBeUndefined();
  });

  it("fails closed for an unknown credential", async () => {
    const f = fixture();
    const authenticator = new DeviceRegistryAuthenticator(
      { getCredential: async () => null },
      { now: () => new Date(f.now) },
    );
    await expect(authenticator.authenticate(requestFixture(f.privateKey, ids.credential_id))).rejects.toThrow("DEVICE_CREDENTIAL_UNKNOWN");
  });

  it("rejects a binding mismatch before proof acceptance", async () => {
    const f = fixture();
    const authenticator = new DeviceRegistryAuthenticator(
      { getCredential: async () => ({ credential: f.credential, device_public_key: f.rawPublic.toString("base64url") }) },
      { now: () => new Date(f.now) },
    );
    const request = requestFixture(f.privateKey, ids.credential_id);
    await expect(authenticator.authenticate({ ...request, company_id: "66666666-6666-4666-8666-666666666666" })).rejects.toThrow("DEVICE_SCOPE_MISMATCH");
  });

  it("rejects revoked credentials", async () => {
    const f = fixture();
    const revoked = { ...f.credential, status: "REVOKED" as const };
    const authenticator = new DeviceRegistryAuthenticator(
      { getCredential: async () => ({ credential: revoked, device_public_key: f.rawPublic.toString("base64url") }) },
      { now: () => new Date(f.now) },
    );
    await expect(authenticator.authenticate(requestFixture(f.privateKey, ids.credential_id))).rejects.toThrow("DEVICE_CREDENTIAL_REVOKED");
  });
});
