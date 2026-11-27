import type { Pool, PoolClient } from "@pos-platform/database-postgres";
import type {
  CommercialPortalBridgeStore,
  PortalSession,
  ProvisioningRecord,
  ReplayRecord,
  TrialLicense,
} from "./bridge-service.js";

type TrialRow = {
  trial_id: string;
  license_id: string;
  email_normalized: string;
  contract_status: "TRIAL" | "EXPIRED" | "REVOKED";
  starts_at: Date;
  expires_at: Date;
  commercial_api_origin: string;
  activation_delivery: "PENDING" | "ACTIVATED" | "CALLBACK_FAILED";
  revoked_at: Date | null;
};

function mapTrial(row: TrialRow): TrialLicense {
  return {
    centralLicenseRef: row.license_id,
    trialId: row.trial_id,
    email: row.email_normalized,
    contractStatus: row.contract_status,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    commercialApiOrigin: row.commercial_api_origin,
    revokedAt: row.revoked_at,
    activationDelivery: row.activation_delivery,
  };
}

/** Durable Central PostgreSQL adapter — required for production bridge mount. */
export class PostgresCommercialPortalBridgeStore implements CommercialPortalBridgeStore {
  constructor(private readonly pool: Pool) {}

  private async withClient<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      return await run(c);
    } finally {
      c.release();
    }
  }

  async putSession(session: PortalSession): Promise<void> {
    if (!session.globalSessionId) throw new Error("COMMERCIAL_BRIDGE_GLOBAL_SESSION_REQUIRED");
    await this.withClient(async (c) => {
      await c.query(
        `INSERT INTO identity.commercial_bridge_sessions
          (token_hash, session_id, user_id, role, authority, expires_at, revoked_at)
         VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7)
         ON CONFLICT (token_hash) DO UPDATE SET
           revoked_at = EXCLUDED.revoked_at,
           expires_at = EXCLUDED.expires_at`,
        [
          session.tokenHash,
          session.globalSessionId,
          session.subjectId,
          session.role,
          session.authority,
          session.expiresAt,
          session.revokedAt,
        ],
      );
    });
  }

  async getSessionByTokenHash(tokenHash: string): Promise<PortalSession | null> {
    return this.withClient(async (c) => {
      const found = await c.query<{
        token_hash: string;
        session_id: string;
        user_id: string;
        role: "SUPERADMIN_GLOBAL";
        authority: "GLOBAL";
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT b.token_hash, b.session_id::text, b.user_id::text, b.role, b.authority, b.expires_at, b.revoked_at
           FROM identity.commercial_bridge_sessions b
           JOIN identity.sessions s ON s.id = b.session_id
          WHERE b.token_hash = $1
            AND b.revoked_at IS NULL
            AND b.expires_at > clock_timestamp()
            AND s.revoked_at IS NULL
            AND s.expires_at > clock_timestamp()
            AND s.tenant_id IS NULL
            AND s.tenant_membership_id IS NULL`,
        [tokenHash],
      );
      const row = found.rows[0];
      if (!row) return null;
      return {
        tokenHash: row.token_hash,
        role: row.role,
        subjectId: row.user_id,
        tenantId: "global",
        authority: row.authority,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        globalSessionId: row.session_id,
      };
    });
  }

  async putTrial(trial: TrialLicense): Promise<void> {
    await this.withClient(async (c) => {
      await c.query(
        `INSERT INTO licensing.commercial_trial_grants
          (trial_id, license_id, email_normalized, contract_status, starts_at, expires_at,
           commercial_api_origin, activation_delivery, revoked_at, updated_at)
         VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())
         ON CONFLICT (trial_id) DO UPDATE SET
           contract_status = EXCLUDED.contract_status,
           activation_delivery = EXCLUDED.activation_delivery,
           revoked_at = EXCLUDED.revoked_at,
           updated_at = clock_timestamp()`,
        [
          trial.trialId,
          trial.centralLicenseRef,
          trial.email.toLowerCase(),
          trial.contractStatus,
          trial.startsAt,
          trial.expiresAt,
          trial.commercialApiOrigin,
          trial.activationDelivery ?? "PENDING",
          trial.revokedAt,
        ],
      );
    });
  }

  async getTrialByTrialId(trialId: string): Promise<TrialLicense | null> {
    return this.withClient(async (c) => {
      const found = await c.query<TrialRow>(
        `SELECT trial_id, license_id::text AS license_id, email_normalized, contract_status,
                starts_at, expires_at, commercial_api_origin, activation_delivery, revoked_at
           FROM licensing.commercial_trial_grants WHERE trial_id = $1`,
        [trialId],
      );
      return found.rows[0] ? mapTrial(found.rows[0]) : null;
    });
  }

  async getTrialByLicenseRef(ref: string): Promise<TrialLicense | null> {
    return this.withClient(async (c) => {
      const found = await c.query<TrialRow>(
        `SELECT trial_id, license_id::text AS license_id, email_normalized, contract_status,
                starts_at, expires_at, commercial_api_origin, activation_delivery, revoked_at
           FROM licensing.commercial_trial_grants WHERE license_id = $1::uuid`,
        [ref],
      );
      return found.rows[0] ? mapTrial(found.rows[0]) : null;
    });
  }

  async listExpiredActiveTrials(now: Date): Promise<TrialLicense[]> {
    return this.withClient(async (c) => {
      const found = await c.query<TrialRow>(
        `SELECT trial_id, license_id::text AS license_id, email_normalized, contract_status,
                starts_at, expires_at, commercial_api_origin, activation_delivery, revoked_at
           FROM licensing.commercial_trial_grants
          WHERE contract_status = 'TRIAL' AND revoked_at IS NULL AND expires_at <= $1`,
        [now],
      );
      return found.rows.map(mapTrial);
    });
  }

  async updateTrial(trial: TrialLicense): Promise<void> {
    await this.putTrial(trial);
  }

  async putProvisioning(row: ProvisioningRecord): Promise<void> {
    await this.withClient(async (c) => {
      await c.query(
        `INSERT INTO licensing.commercial_provisioning_receipts
          (idempotency_key, provisioning_id, order_id, tenant_id, license_units, payload_hash, payload, license_ids, fulfillment)
         VALUES ($1,$2,$3,$4::uuid,$5,$6,$7::jsonb,$8::uuid[],$9)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          row.idempotencyKey,
          row.provisioningId,
          row.orderId,
          row.tenantId ?? null,
          row.licenseUnits,
          row.payloadHash,
          JSON.stringify(row.payload),
          row.licenseIds ?? [],
          row.fulfillment ?? "QUEUED",
        ],
      );
    });
  }

  async completeQueuedProvisioning(key: string, payloadHash: string, licenseIds: string[]): Promise<void> {
    await this.withClient(async c => {
      await c.query(
        `UPDATE licensing.commercial_provisioning_receipts
            SET license_ids=$3::uuid[], fulfillment='ISSUED'
          WHERE idempotency_key=$1 AND payload_hash=$2
            AND fulfillment IN ('QUEUED','ALREADY_QUEUED') AND cardinality(license_ids)=0
            AND license_units=cardinality($3::uuid[])`,
        [key, payloadHash, licenseIds],
      );
    });
  }

  async getProvisioningByIdempotency(key: string): Promise<ProvisioningRecord | null> {
    return this.withClient(async (c) => {
      const found = await c.query<{
        provisioning_id: string;
        idempotency_key: string;
        order_id: string;
        tenant_id: string | null;
        license_units: number;
        payload_hash: string;
        payload: unknown;
        license_ids: string[];
        fulfillment: ProvisioningRecord["fulfillment"];
        created_at: Date;
      }>(
        `SELECT provisioning_id, idempotency_key, order_id, tenant_id::text, license_units,
                payload_hash, payload, license_ids::text[], fulfillment, created_at
           FROM licensing.commercial_provisioning_receipts WHERE idempotency_key = $1`,
        [key],
      );
      const row = found.rows[0];
      if (!row) return null;
      return {
        provisioningId: row.provisioning_id,
        idempotencyKey: row.idempotency_key,
        orderId: row.order_id,
        licenseUnits: row.license_units,
        payload: row.payload,
        payloadHash: row.payload_hash,
        createdAt: row.created_at,
        ...(row.tenant_id ? { tenantId: row.tenant_id } : { tenantId: null }),
        licenseIds: row.license_ids,
        fulfillment: row.fulfillment ?? "QUEUED",
      };
    });
  }

  async claimJti(record: ReplayRecord): Promise<"CLAIMED" | "REPLAY"> {
    return this.withClient(async (c) => {
      try {
        await c.query(
          `INSERT INTO identity.commercial_bridge_jtis (purpose, jti, used_at, expires_at)
           VALUES ($1,$2,$3,$4)`,
          [record.purpose, record.jti, record.usedAt, record.expiresAt],
        );
        return "CLAIMED";
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
        if (code === "23505") return "REPLAY";
        throw error;
      }
    });
  }
}
