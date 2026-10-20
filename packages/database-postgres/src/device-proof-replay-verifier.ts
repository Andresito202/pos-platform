import { createHash, createPublicKey } from "node:crypto";
import type { Pool } from "pg";
import { UuidSchema } from "@pos-platform/contracts";
import {
  parseDeviceRequestAuthorization,
  verifyDeviceRequestAuthorization,
} from "@pos-platform/device-trust";

/** Exact signed request target; this repository is NOT an HTTP endpoint. */
export const BUSINESS_SSA_DEVICE_PROOF_PATH = "/v1/business-session/assertions";

export interface DeviceProofRequest {
  /** Ed25519 DeviceProof header, not a Bearer token. */
  readonly authorization: string;
  readonly requestId: string;
  readonly correlationId: string;
  /** Exact raw UTF-8 HTTP request body, never reconstructed JSON. */
  readonly body: string;
}

export interface VerifiedDeviceProofBinding {
  readonly deviceId: string;
  readonly installationId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly credentialId: string;
  readonly credentialExpiresAt: string;
  readonly requestId: string;
  readonly correlationId: string;
}

/**
 * An internal cryptographic device proof-of-possession boundary. Does NOT
 * authenticate the person or authorize a session. Header IDs are untrusted
 * until the persisted ACTIVE device public key verifies the exact request.
 *
 * The one-use nonce and request ID are inserted in a transaction while both
 * device and credential are share-locked; a repeated proof cannot succeed
 * even with concurrent workers, process restarts or a new user session.
 */
export class PostgresDeviceProofReplayVerifier {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyAndConsume(input: DeviceProofRequest): Promise<VerifiedDeviceProofBinding | null> {
    const requestId = UuidSchema.parse(input.requestId);
    const correlationId = UuidSchema.parse(input.correlationId);
    if (typeof input.body !== "string" ||
        Buffer.byteLength(input.body, "utf8") > 16 * 1024 ||
        typeof input.authorization !== "string") return null;
    const parsed = parseDeviceRequestAuthorization(input.authorization);
    if (!parsed) return null;
    const nonceBytes = Buffer.from(parsed.nonce, "base64url");
    if (nonceBytes.length !== 32 || nonceBytes.toString("base64url") !== parsed.nonce) return null;

    const client = await this.pool.connect();
    let begun = false;
    try {
      await client.query("BEGIN");
      begun = true;
      const found = await client.query<{
        credential_id: string;
        device_id: string;
        installation_id: string;
        tenant_id: string;
        company_id: string;
        device_public_key: Buffer;
        credential_expires_at: Date;
      }>(
        [
          "SELECT dc.credential_id::text AS credential_id,",
          "       d.device_id::text AS device_id,",
          "       d.installation_id::text AS installation_id,",
          "       d.tenant_id::text AS tenant_id,",
          "       d.company_id::text AS company_id,",
          "       d.device_public_key, dc.expires_at AS credential_expires_at",
          "FROM identity.device_credentials AS dc",
          "JOIN identity.device_registry AS d",
          "  ON d.device_id=dc.device_id AND d.installation_id=dc.installation_id",
          " AND d.tenant_id=dc.tenant_id AND d.company_id=dc.company_id",
          " AND d.device_key_id=dc.device_key_id AND d.trust_key_id=dc.trust_key_id",
          " AND d.device_public_key_algorithm='Ed25519' AND d.status='ACTIVE'",
          "WHERE dc.credential_id=$1 AND dc.status='ACTIVE'",
          "  AND dc.key_purpose='DEVICE_TRUST'",
          "  AND dc.issued_at<=clock_timestamp() AND dc.expires_at>clock_timestamp()",
          "FOR SHARE OF dc, d",
        ].join("\n"),
        [parsed.credentialId],
      );
      const row = found.rows[0];
      if (!row || !(row.device_public_key instanceof Buffer) ||
          !(row.credential_expires_at instanceof Date) ||
          !Number.isFinite(row.credential_expires_at.getTime())) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }

      let valid = false;
      try {
        const publicKey = createPublicKey(row.device_public_key.toString("utf8"));
        valid = publicKey.type === "public" && publicKey.asymmetricKeyType === "ed25519"
          && verifyDeviceRequestAuthorization(
            input.authorization,
            {
              method: "POST",
              path: BUSINESS_SSA_DEVICE_PROOF_PATH,
              requestId,
              correlationId,
              body: input.body,
            },
            publicKey,
            this.now(),
          ) !== null;
      } catch {
        valid = false;
      }
      if (!valid) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }

      // Under locked credential, consume exactly once. Unique indexes on
      // (credential,nonce) and (credential,request_id) reject either replay.
      const consumed = await client.query<{ credential_id: string }>(
        [
          "INSERT INTO identity.device_request_proof_replays",
          "  (credential_id, nonce_sha256, request_id, correlation_id, signed_at)",
          "SELECT credential_id, $2, $3, $4, $5::timestamptz",
          "FROM identity.device_credentials",
          "WHERE credential_id=$1 AND status='ACTIVE'",
          "  AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp()",
          "ON CONFLICT DO NOTHING",
          "RETURNING credential_id::text",
        ].join("\n"),
        [
          parsed.credentialId,
          createHash("sha256").update(nonceBytes).digest("hex"),
          requestId, correlationId, parsed.timestamp,
        ],
      );
      if (consumed.rows.length !== 1) {
        await client.query("ROLLBACK"); begun = false;
        return null;
      }
      await client.query("COMMIT");
      begun = false;
      return {
        deviceId: row.device_id,
        installationId: row.installation_id,
        tenantId: row.tenant_id,
        companyId: row.company_id,
        credentialId: row.credential_id,
        credentialExpiresAt: row.credential_expires_at.toISOString(),
        requestId,
        correlationId,
      };
    } catch (error) {
      if (begun) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
