import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { DeviceTrustCredentialClaimsSchema, SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import {
  activationSecretChecksum,
  canonicalDeviceTrustJson,
  type CentralDeviceEnrollmentRepository,
  type CentralDeviceRegistryRow,
} from "@pos-platform/device-trust";

export type DeviceRegistryRepositoryOptions = { pool: Pool };

function publicKeyPemFromStorage(value: Buffer): string { return value.toString("utf8"); }

export class PostgresDeviceRegistryRepository implements CentralDeviceEnrollmentRepository {
  constructor(private readonly options: DeviceRegistryRepositoryOptions) {}

  async findDevice(deviceId: string): Promise<CentralDeviceRegistryRow | null> {
    const result = await this.options.pool.query<Omit<CentralDeviceRegistryRow, "device_public_key"> & { device_public_key: Buffer }>(
      `SELECT device_id::text, installation_id::text, tenant_id::text, company_id::text,
              device_key_id, device_public_key, status, trust_key_id, trust_key_purpose
         FROM identity.device_registry WHERE device_id = $1`, [deviceId]);
    const row = result.rows[0];
    return row ? { ...row, device_public_key: publicKeyPemFromStorage(Buffer.from(row.device_public_key)) } : null;
  }

  async consumeActivationAndIssueCredential(input: Parameters<CentralDeviceEnrollmentRepository["consumeActivationAndIssueCredential"]>[0]): Promise<boolean> {
    const client = await this.options.pool.connect();
    try {
      await client.query("BEGIN");
      const activation = await client.query<{
        activation_id: string; tenant_id: string; company_id: string; installation_id: string;
        device_id: string; activation_checksum: string; status: string; expires_at: Date;
      }>(`SELECT activation_id::text, tenant_id::text, company_id::text, installation_id::text,
                 device_id::text, activation_checksum, status, expires_at
            FROM identity.device_enrollment_activations WHERE activation_id = $1 FOR UPDATE`, [input.activationId]);
      const activationRow = activation.rows[0];
      if (!activationRow || activationRow.status !== "ISSUED" || activationRow.expires_at <= new Date()
        || activationRow.activation_checksum !== input.activationSecretChecksum) return this.rollbackFalse(client);

      const device = await client.query<Omit<CentralDeviceRegistryRow, "device_public_key"> & { device_public_key: Buffer }>(
        `SELECT device_id::text, installation_id::text, tenant_id::text, company_id::text,
                device_key_id, device_public_key, status, trust_key_id, trust_key_purpose
           FROM identity.device_registry WHERE device_id = $1 FOR UPDATE`, [activationRow.device_id]);
      const rawDevice = device.rows[0];
      if (!rawDevice) return this.rollbackFalse(client);
      const deviceRow: CentralDeviceRegistryRow = { ...rawDevice, device_public_key: publicKeyPemFromStorage(Buffer.from(rawDevice.device_public_key)) };
      const claims = DeviceTrustCredentialClaimsSchema.parse(input.credential.claims);
      const signedCredential = SignedDeviceTrustCredentialSchema.parse(input.credential);
      const sameBinding = claims.device_id === deviceRow.device_id
        && claims.installation_id === activationRow.installation_id && claims.installation_id === deviceRow.installation_id
        && claims.tenant_id === activationRow.tenant_id && claims.tenant_id === deviceRow.tenant_id
        && claims.company_id === activationRow.company_id && claims.company_id === deviceRow.company_id
        && claims.key_id === deviceRow.trust_key_id && claims.device_public_key_pem === deviceRow.device_public_key;
      if (!sameBinding) return this.rollbackFalse(client);
      const expectedChecksum = createHash("sha256").update(canonicalDeviceTrustJson(signedCredential)).digest("hex");
      if (expectedChecksum !== input.credentialChecksum) return this.rollbackFalse(client);

      const latest = await client.query<{ generation: number }>(
        `SELECT generation FROM identity.device_credentials WHERE device_id = $1 ORDER BY generation DESC LIMIT 1 FOR UPDATE`, [deviceRow.device_id]);
      const expectedGeneration = (latest.rows[0]?.generation ?? 0) + 1;
      const issuedAt = new Date(claims.issued_at);
      const expiresAt = claims.expires_at ? new Date(claims.expires_at) : null;
      if (!Number.isFinite(issuedAt.getTime()) || !expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt <= issuedAt) return this.rollbackFalse(client);

      const inserted = await client.query(`INSERT INTO identity.device_credentials (
          credential_id, device_id, installation_id, tenant_id, company_id, device_key_id, trust_key_id,
          key_purpose, status, generation, issued_at, expires_at, credential_checksum, issuer_signature,
          created_at, version) VALUES ($1,$2,$3,$4,$5,$6,$7,'DEVICE_TRUST','ACTIVE',$8,$9,$10,$11,decode($12,'base64'),clock_timestamp(),$13)`, [
        claims.credential_id, deviceRow.device_id, deviceRow.installation_id, deviceRow.tenant_id, deviceRow.company_id,
        deviceRow.device_key_id, claims.key_id, expectedGeneration, issuedAt, expiresAt, input.credentialChecksum,
        Buffer.from(signedCredential.signature, "base64url").toString("base64"), claims.version]);
      if (inserted.rowCount !== 1) return this.rollbackFalse(client);

      const consumed = await client.query(`UPDATE identity.device_enrollment_activations
          SET status='CONSUMED', consumed_at=clock_timestamp(), consumed_credential_id=$2
          WHERE activation_id=$1 AND status='ISSUED'`, [input.activationId, claims.credential_id]);
      if (consumed.rowCount !== 1) return this.rollbackFalse(client);
      const activated = await client.query(`UPDATE identity.device_registry
          SET status='ACTIVE', updated_at=clock_timestamp(), version=version+1
          WHERE device_id=$1 AND status IN ('PENDING','ACTIVE')`, [deviceRow.device_id]);
      if (activated.rowCount !== 1) return this.rollbackFalse(client);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async rollbackFalse(client: PoolClient): Promise<boolean> { await client.query("ROLLBACK"); return false; }
}

export { activationSecretChecksum };
