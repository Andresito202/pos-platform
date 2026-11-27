import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CentralDeviceCredentialIssuer, DeviceTrustVerifier, verifyDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { LocalDatabaseComponent } from "../src/local-database-component.js";
import { AndroidKeystoreKeyProvider } from "../src/security/android-keystore-key-provider.js";
import { CommercialDeviceCredentialProvider } from "../src/security/commercial-device-credential.js";
import { DeviceEnrollmentService } from "../src/security/device-enrollment-service.js";
import { DeviceTrustCredentialStore } from "../src/security/device-trust-credential-store.js";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { LocalSecurityComponent } from "../src/security/local-security-component.js";
import { SYNC_BATCH_PATH } from "../src/sync/sync-dispatcher.js";

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`;

it("signs the exact Sync batch only for the enrolled Android device and configured branch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pos-android-sync-"));
  const keys = new AndroidKeystoreKeyProvider(randomBytes(32), "android");
  const database = new LocalDatabaseComponent(directory);
  const binding = { tenantId: id(1), companyId: id(2), installationId: id(3), deviceId: id(4) };
  const branchId = id(5);
  const security = new LocalSecurityComponent(database, binding, keys, directory);
  const secretStore = new EncryptedFileSecretStore(directory, keys, "sync-credential-test");
  const credentials = new DeviceTrustCredentialStore(secretStore);
  try {
    await database.start();
    await security.start();
    const issuerKey = generateKeyPairSync("ed25519");
    const now = new Date();
    const expires = new Date(now.getTime() + 60_000).toISOString();
    const since = new Date(now.getTime() - 1_000).toISOString();
    const verifier = new DeviceTrustVerifier(issuerKey.publicKey,
      new Map([["DEVICE_SYNC", { key: issuerKey.publicKey, status: "ACTIVE", validFrom: since }]]),
      { now: () => new Date(), accept: () => undefined });
    const provider = new CommercialDeviceCredentialProvider(security, database, credentials, verifier, binding);
    const scope = { tenant_id: binding.tenantId, company_id: binding.companyId, installation_id: binding.installationId,
      device_id: binding.deviceId, branch_id: branchId };
    const payload = { sale_id: id(6), total_minor: 1200 };
    const batch = { ...scope, batch_id: id(7), checkpoint_local_sequence: null, operations: [{
      ...scope, operation_id: id(8), session_id: id(9), actor_id: id(10), aggregate_type: "SALE",
      aggregate_id: id(6), operation_type: "SALE_CREATED", authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: 1, idempotency_key: "android-sync-proof:1", expected_version: null,
      payload_schema_version: "1.0.0", payload, payload_checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      causation_id: null, correlation_id: id(11), occurred_at_local: now.toISOString(), recorded_at_local: now.toISOString(),
    }] };
    const context = { method: "POST" as const, path: SYNC_BATCH_PATH, requestId: id(12), correlationId: id(13),
      body: JSON.stringify({ payload: batch }) };
    await expect(provider.syncAuthorization(branchId, context)).rejects.toThrow("DEVICE_TRUST_NOT_PROVISIONED");
    const enrollment = new DeviceEnrollmentService(database.database, security.identity, binding, () => now, credentials);
    const request = enrollment.prepare({ activation_id: id(14), tenant_id: binding.tenantId, company_id: binding.companyId,
      installation_id: binding.installationId, device_id: binding.deviceId, activation_secret: "A".repeat(48),
      status: "ISSUED", issued_at: since, expires_at: expires, version: 1 }).request!;
    const issuer = new CentralDeviceCredentialIssuer({
      findDevice: async () => ({ device_id: binding.deviceId, installation_id: binding.installationId, tenant_id: binding.tenantId,
        company_id: binding.companyId, device_key_id: security.deviceKeyId, device_public_key: security.identity.publicKeyPem(),
        status: "PENDING", trust_key_id: "DEVICE_SYNC", trust_key_purpose: "DEVICE_TRUST" }),
      consumeActivationAndIssueCredential: async () => true,
    }, issuerKey.privateKey, { now: () => now });
    const enrolled = enrollment.complete(await issuer.issue({ request, challenge: request.challenge, expires_at: expires }), verifier);
    const proof = await provider.syncAuthorization(branchId, context);
    const deviceKey = createPublicKey(security.identity.publicKeyPem());
    expect(verifyDeviceRequestAuthorization(proof, context, deviceKey)?.credentialId).toBe(enrolled.credential_id);
    expect(verifyDeviceRequestAuthorization(proof, { ...context, body: context.body + " " }, deviceKey)).toBeNull();
    await expect(provider.syncAuthorization(id(15), context)).rejects.toThrow("COMMERCIAL_SYNC_PROOF_SCOPE_REJECTED");
    await expect(provider.syncAuthorization(branchId, { ...context, path: "/v1/commercial/token" }))
      .rejects.toThrow("COMMERCIAL_SYNC_PROOF_SCOPE_REJECTED");
    const otherCompany = { ...batch, company_id: id(16), operations: batch.operations.map(item => ({ ...item, company_id: id(16) })) };
    await expect(provider.syncAuthorization(branchId, { ...context, body: JSON.stringify({ payload: otherCompany }) }))
      .rejects.toThrow("COMMERCIAL_SYNC_PROOF_SCOPE_REJECTED");
  } finally {
    secretStore.destroy();
    await security.stop();
    await database.stop();
    keys.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
