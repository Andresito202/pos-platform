/**
 * Disposable lab ONLY. Exercises real PostgresDeviceRegistryRepository and
 * CentralDeviceCredentialIssuer with pos_platform_app (not postgres).
 * No real onboarding tokens, keys, licenses or customer devices are used.
 */
import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { Pool } from "pg";
import { DeviceEnrollmentRequestSchema, type DeviceEnrollmentRequest } from "@pos-platform/contracts";
import {
  CentralDeviceCredentialIssuer, activationSecretChecksum,
  canonicalDeviceTrustJson, createEnrollmentChallenge,
} from "@pos-platform/device-trust";

export interface DeviceEnrollmentGateResult {
  credentialId: string;
  activationRows: number;
  credentialRows: number;
  replayRejected: boolean;
}

export async function runIsolatedDeviceEnrollmentGate(input: {
  adminUrl: string;
  tenantId: string;
  companyId: string;
  uuidV7(): string;
}): Promise<DeviceEnrollmentGateResult> {
  const target = new URL(input.adminUrl);
  if (process.env.CAMACHO_ISOLATED_SYNC_LAB !== "YES"
    || target.protocol !== "postgres:"
    || target.hostname !== "127.0.0.1"
    || target.port !== "55436"
    || target.pathname !== "/postgres"
    || target.username !== "postgres") {
    throw new Error("ENROLLMENT_GATE_DISPOSABLE_POSTGRES_REQUIRED");
  }

  const deviceId = input.uuidV7();
  const installationId = input.uuidV7();
  const activationId = input.uuidV7();
  const deviceKeyId = `LAB_DEVICE_KEY_${deviceId}`;
  const activationSecret = randomBytes(32).toString("base64url");
  const deviceKeys = generateKeyPairSync("ed25519");
  const issuerKeys = generateKeyPairSync("ed25519");
  const publicKey = deviceKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const now = new Date();
  const activationExpiry = new Date(now.getTime() + 30 * 60_000);
  const credentialExpiry = new Date(now.getTime() + 60 * 60_000);

  const admin = new Pool({ connectionString: target.toString(), max: 1 });
  target.username = "pos_platform_app";
  target.password = "";
  const runtime = new Pool({ connectionString: target.toString(), max: 1 });

  try {
    await admin.query(
      `INSERT INTO identity.device_registry
       (device_id,installation_id,tenant_id,company_id,device_key_id,
        device_public_key,device_public_key_algorithm,status,trust_key_id,
        trust_key_purpose,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'Ed25519','PENDING','LAB_DEVICE_TRUST','DEVICE_TRUST',clock_timestamp(),clock_timestamp())`,
      [deviceId, installationId, input.tenantId, input.companyId, deviceKeyId, Buffer.from(publicKey, "utf8")],
    );
    await admin.query(
      `INSERT INTO identity.device_enrollment_activations
       (activation_id,tenant_id,company_id,installation_id,device_id,
        activation_checksum,status,issued_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,'ISSUED',clock_timestamp(),$7)`,
      [activationId, input.tenantId, input.companyId, installationId, deviceId,
        activationSecretChecksum(activationSecret), activationExpiry],
    );

    // Import the existing production PostgreSQL repository at runtime without
    // pulling its source outside target-migrations' TypeScript rootDir.
    const repositoryModule = await import(
      new URL("../../../packages/database-postgres/src/device-registry-repository.ts", import.meta.url).href
    ) as {
      PostgresDeviceRegistryRepository: new (options: { pool: Pool }) =>
        ConstructorParameters<typeof CentralDeviceCredentialIssuer>[0];
    };
    const repository = new repositoryModule.PostgresDeviceRegistryRepository({ pool: runtime });
    const issuer = new CentralDeviceCredentialIssuer(repository, issuerKeys.privateKey, { now: () => now });
    const challenge = createEnrollmentChallenge({
      tenant_id: input.tenantId,
      installation_id: installationId,
      device_id: deviceId,
      issued_at: new Date(now.getTime() - 5_000).toISOString(),
      expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
    });
    const request: DeviceEnrollmentRequest = DeviceEnrollmentRequestSchema.parse({
      activation_id: activationId,
      activation_secret: activationSecret,
      tenant_id: input.tenantId,
      company_id: input.companyId,
      installation_id: installationId,
      device_id: deviceId,
      device_key_id: deviceKeyId,
      device_public_key_pem: publicKey,
      challenge,
      proof: {
        challenge_id: challenge.challenge_id,
        device_key_id: deviceKeyId,
        signature: sign(null, Buffer.from(canonicalDeviceTrustJson(challenge)), deviceKeys.privateKey).toString("base64url"),
      },
      requested_at: now.toISOString(),
      version: 1,
    });
    const issued = await issuer.issue({ request, challenge, expires_at: credentialExpiry.toISOString() });
    if (issued.status !== "ENROLLED" || !issued.credential) throw new Error("ENROLLMENT_GATE_NOT_ENROLLED");
    const validSignature = verify(
      null,
      Buffer.from(canonicalDeviceTrustJson(issued.credential.claims)),
      issuerKeys.publicKey,
      Buffer.from(issued.credential.signature, "base64url"),
    );
    if (!validSignature) throw new Error("ENROLLMENT_GATE_BAD_ISSUER_SIGNATURE");

    const persisted = await admin.query<{
      activation_status: string;
      consumed_credential_id: string;
      credential_status: string;
      registry_status: string;
    }>(
      `SELECT a.status activation_status,a.consumed_credential_id::text,
              c.status credential_status,r.status registry_status
         FROM identity.device_enrollment_activations a
         JOIN identity.device_credentials c ON c.credential_id=a.consumed_credential_id
         JOIN identity.device_registry r ON r.device_id=a.device_id
        WHERE a.activation_id=$1`, [activationId],
    );
    if (persisted.rowCount !== 1
      || persisted.rows[0]?.activation_status !== "CONSUMED"
      || persisted.rows[0]?.credential_status !== "ACTIVE"
      || persisted.rows[0]?.registry_status !== "ACTIVE"
      || persisted.rows[0]?.consumed_credential_id !== issued.credential_id) {
      throw new Error("ENROLLMENT_GATE_NOT_ATOMICALLY_PERSISTED");
    }

    let replayRejected = false;
    try {
      await issuer.issue({ request, challenge, expires_at: credentialExpiry.toISOString() });
    } catch (error) {
      replayRejected = error instanceof Error && error.message === "ACTIVATION_NOT_CONSUMABLE";
      if (!replayRejected) throw error;
    }
    if (!replayRejected) throw new Error("ENROLLMENT_GATE_ACTIVATION_REPLAY_ACCEPTED");
    const count = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM identity.device_credentials WHERE device_id=$1",
      [deviceId],
    );
    if (count.rows[0]?.count !== "1") throw new Error("ENROLLMENT_GATE_DUPLICATE_CREDENTIAL");

    return { credentialId: issued.credential_id, activationRows: 1, credentialRows: 1, replayRejected };
  } finally {
    await runtime.end();
    await admin.end();
  }
}
