import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  CentralDeviceCredentialIssuer,
  DeviceEnrollmentHttpHandler,
  type CentralDeviceEnrollmentRepository,
} from "@pos-platform/device-trust";
import { DeviceEnrollmentService, DeviceIdentity, DeviceTrustCredentialStore, EncryptedFileSecretStore, InsecureDerivedKeyProvider } from "../src/index.js";
import { runDeviceEnrollment, writeDevicePublicIdentity, DEVICE_PUBLIC_IDENTITY_FILE } from "../src/security/device-enrollment-runner.js";
import type { CentralHttpRequest, CentralTransport } from "../src/sync/central-transport.js";

/**
 * Enrolamiento del equipo al arrancar (`DEC-026` §13.11) por el protocolo
 * canónico de `D-3`, con las piezas reales de ambos lados: `DeviceEnrollmentService`
 * del POS y `DeviceEnrollmentHttpHandler` + `CentralDeviceCredentialIssuer` de
 * `device-trust`. Sólo el repositorio central y el transporte son dobles (el
 * transporte entrega la petición al manejador real, sin red).
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO ES EXCLUSIVO DE TEST.
 */

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close(); } catch { /* vacío */ } }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const binding = {
  tenantId: "018f0000-0000-7000-8000-0000000d0001", companyId: "018f0000-0000-7000-8000-0000000d0002",
  installationId: "018f0000-0000-7000-8000-0000000d0003", deviceId: "018f0000-0000-7000-8000-0000000d0004",
};
const ISSUER = generateKeyPairSync("ed25519");
const ROOT = generateKeyPairSync("ed25519");
const TRUST_KEY_ID = "DEVICE_TRUST_TEST";
const TOKEN = "lab-transport-token-0123456789";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pos-enroll-run-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const secrets = join(dir, "security");
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  const store = new EncryptedFileSecretStore(secrets, new InsecureDerivedKeyProvider(secrets), `device:${binding.installationId}:${binding.deviceId}`);
  const identity = DeviceIdentity.create(store);
  const credentialStore = new DeviceTrustCredentialStore(store);
  const now = new Date();
  const activationPath = join(dir, "activation.json");
  writeFileSync(activationPath, JSON.stringify({
    activation_id: "018f0000-0000-7000-8000-0000000d0010", tenant_id: binding.tenantId, company_id: binding.companyId,
    installation_id: binding.installationId, device_id: binding.deviceId,
    activation_secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", status: "ISSUED",
    issued_at: new Date(now.getTime() - 60_000).toISOString(), expires_at: new Date(now.getTime() + 3_600_000).toISOString(), version: 1,
  }));
  const tokenPath = join(dir, "token");
  writeFileSync(tokenPath, `${TOKEN}\n`);
  return { dir, database, identity, credentialStore, activationPath, tokenPath };
}

/** Entrega la petición al manejador real de `device-trust`, como haría la autoridad. */
function authority(identity: DeviceIdentity): CentralTransport & { calls: number } {
  const repository: CentralDeviceEnrollmentRepository = {
    findDevice: async () => ({
      device_id: binding.deviceId, installation_id: binding.installationId, tenant_id: binding.tenantId, company_id: binding.companyId,
      device_key_id: identity.deviceKeyId(), device_public_key: identity.publicKeyPem(), status: "PENDING",
      trust_key_id: TRUST_KEY_ID, trust_key_purpose: "DEVICE_TRUST",
    }),
    consumeActivationAndIssueCredential: async () => true,
  };
  const handler = new DeviceEnrollmentHttpHandler(new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, { now: () => new Date() }), {
    maxBodyBytes: 16 * 1024, maxCredentialLifetimeMs: 365 * 24 * 3_600_000,
    authorize: (context) => context.authorization === `Bearer ${TOKEN}`, now: () => new Date(),
  });
  const transport = {
    calls: 0,
    async send(request: CentralHttpRequest) {
      transport.calls += 1;
      const result = await handler.handle({
        authorization: request.headers["authorization"] ?? null, contentType: "application/json",
        contentLength: Buffer.byteLength(request.body), requestId: "r", correlationId: "c",
      }, request.body);
      return { status: result.statusCode, headers: {}, body: JSON.stringify(result.body) };
    },
  };
  return transport;
}

function run(fixtureValue: ReturnType<typeof fixture>, transport: CentralTransport, tokenPath = fixtureValue.tokenPath) {
  return runDeviceEnrollment({
    config: {
      centralAuthUrl: "https://central.test", activationPath: fixtureValue.activationPath, transportTokenPath: tokenPath,
      rootPublicKeyPem: ROOT.publicKey.export({ type: "spki", format: "pem" }).toString(), operationalKeyId: TRUST_KEY_ID,
      operationalPublicKeyPem: ISSUER.publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    service: new DeviceEnrollmentService(fixtureValue.database, fixtureValue.identity, binding, () => new Date(), fixtureValue.credentialStore),
    credentialStore: fixtureValue.credentialStore,
    transport,
    clock: { now: () => new Date(), accept: () => undefined },
    signal: new AbortController().signal,
  });
}

describe("runDeviceEnrollment — protocolo D-3 de punta a punta", () => {
  it("enrola, guarda la credencial verificada, y al siguiente arranque no vuelve a pedirla", async () => {
    const value = fixture();
    const central = authority(value.identity);
    const first = await run(value, central);
    expect(first.outcome).toBe("ENROLLED");
    expect(value.credentialStore.load().claims.device_public_key_pem).toBe(value.identity.publicKeyPem());
    expect(await run(value, central)).toEqual({ outcome: "ALREADY_ENROLLED" });
    expect(central.calls).toBe(1);
  });

  it("sin fichero de activación no hace nada y no toca la red", async () => {
    const value = fixture();
    rmSync(value.activationPath);
    const central = authority(value.identity);
    expect(await run(value, central)).toEqual({ outcome: "NO_ACTIVATION" });
    expect(central.calls).toBe(0);
  });

  it("un token de transporte equivocado se rechaza y no guarda credencial", async () => {
    const value = fixture();
    const wrong = join(value.dir, "wrong-token");
    writeFileSync(wrong, "otro-token");
    expect(await run(value, authority(value.identity), wrong)).toEqual({ outcome: "REJECTED", reason: "DEVICE_ENROLLMENT_TRANSPORT_UNAUTHORIZED" });
    expect(value.credentialStore.has()).toBe(false);
  });
});

describe("writeDevicePublicIdentity", () => {
  it("publica sólo identificadores y la clave pública, nunca material privado", () => {
    const value = fixture();
    const path = writeDevicePublicIdentity({ dataDirectory: value.dir, ...binding, identity: value.identity, enrolled: false });
    expect(path).toBe(join(value.dir, DEVICE_PUBLIC_IDENTITY_FILE));
    const text = readFileSync(path, "utf8");
    const published = JSON.parse(text) as Record<string, unknown>;
    expect(published).toEqual({
      version: 1, tenant_id: binding.tenantId, company_id: binding.companyId, installation_id: binding.installationId,
      device_id: binding.deviceId, device_key_id: value.identity.deviceKeyId(), device_public_key_pem: value.identity.publicKeyPem(), enrolled: false,
    });
    expect(text).not.toMatch(/PRIVATE KEY/);
  });
});
