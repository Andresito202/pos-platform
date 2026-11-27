import { uuidV7 } from "@pos-platform/contracts";
import type { Pool, PoolClient } from "@pos-platform/database-postgres";
import type { CommercialLicenseIssuer } from "./bridge-service.js";

/**
 * Issues TRIAL / order-bound licenses into licensing.licenses.
 * Offline lock: expires_at exact 120h wall clock; no grace_policy_reference.
 */
export class PostgresCommercialLicenseIssuer implements CommercialLicenseIssuer {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const value = await run(c);
      await c.query("COMMIT");
      return value;
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }

  async issueTrialLicense(input: {
    trialId: string;
    email: string;
    startsAt: Date;
    expiresAt: Date;
    tenantId?: string;
    planId?: string;
  }): Promise<{ licenseId: string }> {
    if (!input.tenantId || !input.planId) {
      // Durable grant table still holds UUID; licensing row requires tenant+plan.
      return { licenseId: uuidV7() };
    }
    return this.tx(async (c) => {
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [input.tenantId]);
      const plan = await c.query<{ id: string; deployment_mode: string; version: string }>(
        `SELECT id::text, deployment_mode, version::text FROM licensing.plans
          WHERE id=$1::uuid AND status='ACTIVE' FOR SHARE`,
        [input.planId],
      );
      if (plan.rowCount !== 1) throw Object.assign(new Error("TRIAL_PLAN_REQUIRED"), { status: 400 });
      const licenseId = uuidV7();
      const commercialReference = `COMMERCIAL_TRIAL:${input.trialId}`;
      await c.query(
        `INSERT INTO licensing.licenses
          (id, tenant_id, plan_id, deployment_mode, contract_status, not_before, expires_at,
           grace_policy_reference, policy_version, commercial_reference, created_at, updated_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'TRIAL',$5,$6,NULL,'TRIAL_120H_V1',$7,$5,$5)`,
        [
          licenseId,
          input.tenantId,
          input.planId,
          plan.rows[0]!.deployment_mode === "LOCAL_PERPETUAL" ? "HYBRID" : plan.rows[0]!.deployment_mode,
          input.startsAt,
          input.expiresAt,
          commercialReference,
        ],
      );
      const entitlements = await c.query<{ capability_code: string; enabled: boolean; limit_type: string; limit_value: string | null }>(
        `SELECT capability_code, enabled, limit_type, limit_value::text
           FROM licensing.plan_entitlements WHERE plan_id=$1::uuid`,
        [input.planId],
      );
      for (const row of entitlements.rows) {
        await c.query(
          `INSERT INTO licensing.license_entitlements
            (id, license_id, capability_code, enabled, limit_type, limit_value, source_plan_version, created_at)
           VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)`,
          [
            uuidV7(),
            licenseId,
            row.capability_code,
            row.enabled,
            row.limit_type,
            row.limit_value,
            Number(plan.rows[0]!.version),
            input.startsAt,
          ],
        );
      }
      return { licenseId };
    });
  }

  async revokeTrialLicense(licenseId: string, reason: string): Promise<void> {
    await this.tx(async (c) => {
      const found = await c.query<{ tenant_id: string }>(
        `SELECT tenant_id::text FROM licensing.licenses WHERE id=$1::uuid FOR UPDATE`,
        [licenseId],
      );
      if (found.rowCount !== 1) return;
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [found.rows[0]!.tenant_id]);
      await c.query(
        `UPDATE licensing.licenses
            SET contract_status='TERMINATED', updated_at=clock_timestamp(), version=version+1
          WHERE id=$1::uuid AND contract_status='TRIAL'`,
        [licenseId],
      );
      void reason;
    });
  }

  async issueProvisioningLicenses(input: {
    orderId: string;
    licenseUnits: number;
    tenantId: string;
    planId: string;
    payloadHash: string;
  }): Promise<{ licenseIds: string[] }> {
    return this.tx(async (c) => {
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [input.tenantId]);
      const plan = await c.query<{ id: string; deployment_mode: string; billing_model: string; version: string }>(
        `SELECT id::text, deployment_mode, billing_model, version::text FROM licensing.plans
          WHERE id=$1::uuid AND status='ACTIVE' FOR SHARE`,
        [input.planId],
      );
      if (plan.rowCount !== 1) throw Object.assign(new Error("PROVISION_PLAN_REQUIRED"), { status: 400 });
      if (plan.rows[0]!.billing_model !== "PERPETUAL") {
        throw Object.assign(new Error("PROVISION_SUBSCRIPTION_TERM_REQUIRED"), { status: 409 });
      }
      const tenant = await c.query(
        `SELECT 1 FROM tenancy.tenants WHERE id=$1::uuid AND status='ACTIVE' FOR SHARE`,
        [input.tenantId],
      );
      if (tenant.rowCount !== 1) throw Object.assign(new Error("PROVISION_TENANT_REQUIRED"), { status: 400 });
      const licenseIds: string[] = [];
      const now = new Date();
      for (let i = 0; i < input.licenseUnits; i += 1) {
        const licenseId = uuidV7();
        const commercialReference = `COMMERCIAL_ORDER:${input.orderId}:${i}:${input.payloadHash.slice(0, 16)}`;
        const inserted = await c.query<{ id: string }>(
          `INSERT INTO licensing.licenses
            (id, tenant_id, plan_id, deployment_mode, contract_status, not_before, expires_at,
             grace_policy_reference, policy_version, commercial_reference, created_at, updated_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'ACTIVE',$5,NULL,NULL,'COMMERCIAL_ORDER_V1',$6,$5,$5)
           ON CONFLICT (commercial_reference) WHERE commercial_reference IS NOT NULL DO NOTHING
           RETURNING id::text`,
          [
            licenseId,
            input.tenantId,
            input.planId,
            plan.rows[0]!.deployment_mode,
            now,
            commercialReference,
          ],
        );
        if (inserted.rowCount === 0) {
          const prior = await c.query<{ id: string }>(
            `SELECT id::text FROM licensing.licenses
              WHERE commercial_reference=$1 AND tenant_id=$2::uuid AND plan_id=$3::uuid
                AND policy_version='COMMERCIAL_ORDER_V1'`,
            [commercialReference, input.tenantId, input.planId],
          );
          const recovered = prior.rows[0];
          if (!recovered) throw Object.assign(new Error("PROVISION_LICENSE_REFERENCE_CONFLICT"), { status: 409 });
          licenseIds.push(recovered.id);
          continue;
        }
        const entitlements = await c.query<{ capability_code: string; enabled: boolean; limit_type: string; limit_value: string | null }>(
          `SELECT capability_code, enabled, limit_type, limit_value::text
             FROM licensing.plan_entitlements WHERE plan_id=$1::uuid`,
          [input.planId],
        );
        for (const row of entitlements.rows) {
          await c.query(
            `INSERT INTO licensing.license_entitlements
              (id, license_id, capability_code, enabled, limit_type, limit_value, source_plan_version, created_at)
             VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)`,
            [
              uuidV7(),
              licenseId,
              row.capability_code,
              row.enabled,
              row.limit_type,
              row.limit_value,
              Number(plan.rows[0]!.version),
              now,
            ],
          );
        }
        licenseIds.push(licenseId);
      }
      return { licenseIds };
    });
  }
}
