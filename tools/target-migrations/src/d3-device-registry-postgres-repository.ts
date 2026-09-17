import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "@pos-platform/local-channel";
import type {
  DeviceRegistryRepository,
  DeviceRegistryRow,
  DeviceCredentialIssue,
} from "./d3-device-registry-runtime.js";

function toBase64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export type DeviceRegistryRepositoryOptions = { pool: Pool };

export class PostgresDeviceRegistryRepository implements DeviceRegistryRepository {
  constructor(private readonly options: DeviceRegistryRepositoryOptions) {}

  async findDevice(deviceId: string): Promise<DeviceRegistryRow | null> {
    const result = await this.options.pool.query<Omit<DeviceRegistryRow, "device_public_key"> & { device_public_key: Buffer }>(
      `SELECT
         device_id::text,
         installation_id::text,
         tenant_id::text,
         company_id::text,
         device_key_id,
         device_public_key,
         status,
         trust_key_id,
         trust_key_purpose
       FROM identity.device_registry
       WHERE device_id = $1`,
      [deviceId],
    );
    const row = result.rows[0];
    return row
      ? { ...row, device_public_key: toBase64Url(Buffer.from(row.device_public_key)) }
      : null;
  }

  async consumeActivationAndIssueCredential(input: {
    activationId: string;
    requestChecksum: string;
    credential: DeviceCredentialIssue;
  }): Promise<boolean> {
    const client = await this.options.pool.connect();
    try {
      await client.query("BEGIN");

      const activation = await client.query<{
        activation_id: string;
        tenant_id: string;
        company_id: string;
        installation_id: string;
        device_id: string;
        activation_checksum: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT activation_id::text, tenant_id::text, company_id::text,
                installation_id::text, device_id::text, activation_checksum,
                status, expires_at
           FROM identity.device_enrollment_activations
          WHERE activation_id = $1
          FOR UPDATE`,
        [input.activationId],
      );
      const activationRow = activation.rows[0];
      if (!activationRow) return this.rollbackFalse(client);
      if (activationRow.status !== "ISSUED" || activationRow.expires_at <= new Date()) {
        return this.rollbackFalse(client);
      }
      if (activationRow.activation_checksum !== input.requestChecksum) {
        return this.rollbackFalse(client);
      }

      const device = await client.query<Omit<DeviceRegistryRow, "device_public_key"> & { device_public_key: Buffer }>(
        `SELECT
           device_id::text,
           installation_id::text,
           tenant_id::text,
           company_id::text,
           device_key_id,
           device_public_key,
           status,
           trust_key_id,
           trust_key_purpose
         FROM identity.device_registry
        WHERE device_id = $1
        FOR UPDATE`,
        [activationRow.device_id],
      );
      const rawDevice = device.rows[0];
      if (!rawDevice) return this.rollbackFalse(client);
      const deviceRow: DeviceRegistryRow = {
        ...rawDevice,
        device_public_key: toBase64Url(Buffer.from(rawDevice.device_public_key)),
      };

      const sameBinding =
        deviceRow.device_id === input.credential.device.device_id &&
        deviceRow.installation_id === activationRow.installation_id &&
        deviceRow.installation_id === input.credential.device.installation_id &&
        deviceRow.tenant_id === activationRow.tenant_id &&
        deviceRow.tenant_id === input.credential.device.tenant_id &&
        deviceRow.company_id === activationRow.company_id &&
        deviceRow.company_id === input.credential.device.company_id &&
        deviceRow.device_key_id === input.credential.device.device_key_id &&
        deviceRow.trust_key_id === input.credential.device.trust_key_id &&
        deviceRow.trust_key_purpose === "DEVICE_TRUST" &&
        input.credential.device.trust_key_purpose === "DEVICE_TRUST";
      if (!sameBinding) return this.rollbackFalse(client);

      const latest = await client.query<{ generation: number }>(
        `SELECT generation
           FROM identity.device_credentials
          WHERE device_id = $1
          ORDER BY generation DESC
          LIMIT 1
          FOR UPDATE`,
        [deviceRow.device_id],
      );
      const expectedGeneration = (latest.rows[0]?.generation ?? 0) + 1;
      if (input.credential.generation !== expectedGeneration) return this.rollbackFalse(client);

      const issuedAt = new Date(input.credential.issuedAt);
      const expiresAt = new Date(input.credential.expiresAt);
      if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= issuedAt) {
        return this.rollbackFalse(client);
      }

      const checksum = createHash("sha256")
        .update(canonicalJson({
          credential_id: input.credential.credentialId,
          device_id: deviceRow.device_id,
          installation_id: deviceRow.installation_id,
          tenant_id: deviceRow.tenant_id,
          company_id: deviceRow.company_id,
          device_key_id: deviceRow.device_key_id,
          trust_key_id: deviceRow.trust_key_id,
          key_purpose: "DEVICE_TRUST",
          generation: input.credential.generation,
          issued_at: input.credential.issuedAt,
          expires_at: input.credential.expiresAt,
        }))
        .digest("hex");

      const inserted = await client.query(
        `INSERT INTO identity.device_credentials (
           credential_id, device_id, installation_id, tenant_id, company_id,
           device_key_id, trust_key_id, key_purpose, status, generation,
           issued_at, expires_at, credential_checksum, issuer_signature, created_at, version
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, 'DEVICE_TRUST', 'ACTIVE', $8,
           $9, $10, $11, decode($12, 'base64'), clock_timestamp(), 1
         )
         RETURNING credential_id`,
        [
          input.credential.credentialId,
          deviceRow.device_id,
          deviceRow.installation_id,
          deviceRow.tenant_id,
          deviceRow.company_id,
          deviceRow.device_key_id,
          deviceRow.trust_key_id,
          input.credential.generation,
          issuedAt,
          expiresAt,
          checksum,
          Buffer.from(input.credential.issuerSignature, "base64url").toString("base64"),
        ],
      );
      if (inserted.rowCount !== 1) return this.rollbackFalse(client);

      const consumed = await client.query(
        `UPDATE identity.device_enrollment_activations
            SET status = 'CONSUMED', consumed_at = clock_timestamp(), consumed_credential_id = $2
          WHERE activation_id = $1 AND status = 'ISSUED'`,
        [input.activationId, input.credential.credentialId],
      );
      if (consumed.rowCount !== 1) return this.rollbackFalse(client);

      await client.query(
        `UPDATE identity.device_registry
            SET status = 'ACTIVE', updated_at = clock_timestamp(), version = version + 1
          WHERE device_id = $1 AND status IN ('PENDING','ACTIVE')`,
        [deviceRow.device_id],
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollbackFalse(client: PoolClient): Promise<boolean> {
    await client.query("ROLLBACK");
    return false;
  }
}
