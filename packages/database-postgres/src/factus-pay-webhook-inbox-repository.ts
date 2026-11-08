import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { QrPaymentObservationSchema, type QrPaymentObservation } from "@pos-platform/contracts";
import { uuidV7 } from "./sql.js";
export interface FactusPayWebhookKeyContext {
  readonly keyId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly integrationId: string;
}
export interface FactusPayWebhookInbox {
  resolveKey(suppliedKey: string): Promise<FactusPayWebhookKeyContext | null>;
  persistVerifiedObservation(
    observation: QrPaymentObservation,
    keyContext: FactusPayWebhookKeyContext,
    idempotencyKey: string,
  ): Promise<"STORED" | "DUPLICATE">;
}

export interface FactusPayWebhookInboxRepositoryOptions {
  pool: Pool;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  now?: () => Date;
}

type ResolvedKeyRow = FactusPayWebhookKeyContext;

function secretDigest(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Database-backed callback authentication and durable inbox persistence.
 * The provider secret is never stored in plaintext and the handler never
 * confirms a sale. Processing of the inbox is a separate, authorized step.
 */
export class PostgresFactusPayWebhookInboxRepository implements FactusPayWebhookInbox {
  constructor(private readonly options: FactusPayWebhookInboxRepositoryOptions) {
    if (![options.lockTimeoutMs,options.statementTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0) ||
        options.statementTimeoutMs<=options.lockTimeoutMs) throw Error("FACTUS_PAY_DATABASE_TIMEOUT_POLICY_REQUIRED");
  }

  async resolveKey(suppliedKey: string): Promise<FactusPayWebhookKeyContext | null> {
    if (suppliedKey.length < 32 || suppliedKey.length > 512) return null;
    const result = await this.options.pool.query<ResolvedKeyRow>(
      `SELECT k.id::text AS "keyId", k.tenant_id::text AS "tenantId",
              k.company_id::text AS "companyId", k.integration_id::text AS "integrationId"
         FROM integrations.factus_pay_webhook_keys k
         WHERE k.secret_sha256=$1 AND k.status='ACTIVE'
         LIMIT 2`,
      [secretDigest(suppliedKey)],
    );
    // Fail closed if a bad migration/manual intervention has created ambiguity.
    if (result.rows.length !== 1) return null;
    const candidate=result.rows[0]!;
    // Tenant context is derived from the authenticated secret hash, never from
    // callback JSON. Respect 002 RLS instead of granting cross-tenant reads.
    const client=await this.options.pool.connect();
    try{
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout',$2,true),set_config('statement_timeout',$3,true)",
        [candidate.tenantId,`${this.options.lockTimeoutMs}ms`,`${this.options.statementTimeoutMs}ms`]);
      const active=await client.query(`SELECT 1 FROM integrations.external_integrations i
        WHERE i.id=$1 AND i.tenant_id=$2 AND i.company_id=$3 AND i.status='ACTIVE' AND i.provider_code_snapshot='FACTUS_PAY'
        AND (SELECT count(*) FROM integrations.integration_credential_bindings b WHERE b.tenant_id=i.tenant_id
          AND b.company_id=i.company_id AND b.integration_id=i.id AND b.status='ACTIVE')=1`,
        [candidate.integrationId,candidate.tenantId,candidate.companyId]);
      await client.query("COMMIT");return active.rowCount===1?candidate:null;
    }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  }

  async persistVerifiedObservation(
    input: QrPaymentObservation,
    keyContext: FactusPayWebhookKeyContext,
    idempotencyKey: string,
  ): Promise<"STORED" | "DUPLICATE"> {
    const observation=QrPaymentObservationSchema.parse(input);
    if (observation.provider_code!=="FACTUS_PAY" || observation.status!=="APPROVED" || observation.currency_code!=="COP" ||
        observation.external_reference!==observation.external_transaction_id || idempotencyKey!=="FACTUS_PAY:"+observation.external_transaction_id)
      throw Error("FACTUS_PAY_OBSERVATION_REJECTED");
    const client = await this.options.pool.connect();
    const now = (this.options.now ?? (() => new Date()))();
    const receivedAt = now.toISOString();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id',$3,true)",
        [`${this.options.lockTimeoutMs}ms`,`${this.options.statementTimeoutMs}ms`,keyContext.tenantId]);
      const validKey = await client.query(
        `SELECT 1
           FROM integrations.factus_pay_webhook_keys k
           JOIN integrations.external_integrations i
             ON i.tenant_id=k.tenant_id AND i.company_id=k.company_id AND i.id=k.integration_id
          WHERE k.id=$1 AND k.tenant_id=$2 AND k.company_id=$3 AND k.integration_id=$4
            AND k.status='ACTIVE' AND i.status='ACTIVE' AND i.provider_code_snapshot='FACTUS_PAY'
            AND (SELECT count(*) FROM integrations.integration_credential_bindings b
                  WHERE b.tenant_id=i.tenant_id AND b.company_id=i.company_id
                    AND b.integration_id=i.id AND b.status='ACTIVE')=1
          FOR SHARE OF k,i`,
        [keyContext.keyId,keyContext.tenantId,keyContext.companyId,keyContext.integrationId],
      );
      if (validKey.rowCount !== 1) throw new Error("FACTUS_PAY_KEY_REVOKED");
      const bindings=await client.query(`SELECT id FROM integrations.integration_credential_bindings
        WHERE tenant_id=$1 AND company_id=$2 AND integration_id=$3 AND status='ACTIVE' FOR SHARE`,
        [keyContext.tenantId,keyContext.companyId,keyContext.integrationId]);
      if(bindings.rowCount!==1)throw Error("FACTUS_PAY_CREDENTIAL_BINDING_REVOKED");

      const inserted = await client.query(
        `INSERT INTO integrations.factus_pay_webhook_inbox
          (id,tenant_id,company_id,integration_id,webhook_key_id,external_transaction_id,
           amount,currency_code,provider_status,payer_display_name,payer_reference,
           observed_at,received_at,processing_status,attempt_count,correlation_id,created_at,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'COP','paid',$8,$9,$10,$11,'PENDING',0,$12,$11,1)
         ON CONFLICT (tenant_id,integration_id,external_transaction_id) DO NOTHING
         RETURNING id::text`,
        [uuidV7(now),keyContext.tenantId,keyContext.companyId,keyContext.integrationId,keyContext.keyId,
         observation.external_transaction_id,observation.amount,observation.payer_display_name,
         observation.payer_reference,observation.observed_at,receivedAt,uuidV7(now)],
      );
      if (inserted.rowCount === 1) {
        const evidence=JSON.stringify({integration_id:keyContext.integrationId,external_reference:observation.external_reference,
          amount:observation.amount,currency_code:observation.currency_code,status:"OBSERVED_NOT_CONFIRMED"});
        await client.query(`INSERT INTO audit.audit_events(id,tenant_id,company_id,actor_type,action_code,resource_type,
          resource_reference_kind,resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
          VALUES($1,$2,$3,'EXTERNAL_PROVIDER','FACTUS_PAY_COLLECTION_OBSERVED','WEBHOOK_RECEIPT','INSTANCE',$4,$5,1,$6,$6,'RECORDED',$7::jsonb,$8)`,
          [uuidV7(now),keyContext.tenantId,keyContext.companyId,inserted.rows[0].id,uuidV7(now),receivedAt,evidence,secretDigest(evidence)]);
        await client.query("COMMIT");
        return "STORED";
      }

      const existing = await client.query<{amount:string;currency_code:string;provider_status:string}>(
        `SELECT amount::text,currency_code,provider_status
           FROM integrations.factus_pay_webhook_inbox
          WHERE tenant_id=$1 AND integration_id=$2 AND external_transaction_id=$3
          FOR UPDATE`,
        [keyContext.tenantId,keyContext.integrationId,observation.external_transaction_id],
      );
      const row = existing.rows[0];
      if (!row || row.amount !== observation.amount || row.currency_code !== observation.currency_code || row.provider_status !== "paid") {
        throw new Error("FACTUS_PAY_DUPLICATE_REFERENCE_CONFLICT");
      }
      await client.query("COMMIT");
      return "DUPLICATE";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
