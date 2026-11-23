import { uuidV7 } from "./sql.js";
import type { Pool, PoolClient } from "pg";
import type {
  SubscriptionFulfillmentConfirmationSource,
  SubscriptionFulfillmentJobView,
  SubscriptionFulfillmentStatus,
} from "@pos-platform/contracts";

export type FulfillmentEnqueueInput = {
  paymentId: string;
  quoteId: string;
  tenantId: string;
  companyId: string;
  confirmationSource: SubscriptionFulfillmentConfirmationSource;
  correlationId: string;
  status: Extract<SubscriptionFulfillmentStatus, "PENDING" | "CONFIRMED">;
  confirmedAt?: Date | null;
  inboxObservationId?: string | null;
};

export type ClaimedFulfillmentJob = {
  id: string;
  paymentId: string;
  quoteId: string;
  tenantId: string;
  companyId: string;
  status: Extract<SubscriptionFulfillmentStatus, "PENDING" | "CONFIRMED">;
  confirmationSource: SubscriptionFulfillmentConfirmationSource;
  attemptCount: number;
  correlationId: string;
  claimToken: string;
  inboxObservationId: string | null;
};

type Limits = { lockTimeoutMs: number; statementTimeoutMs: number; claimTtlMs: number };

function mapJob(row: Record<string, unknown>): SubscriptionFulfillmentJobView {
  return {
    payment_id: String(row.payment_id),
    quote_id: String(row.quote_id),
    tenant_id: String(row.tenant_id),
    company_id: String(row.company_id),
    status: row.status as SubscriptionFulfillmentStatus,
    confirmation_source: row.confirmation_source as SubscriptionFulfillmentConfirmationSource,
    attempt_count: Number(row.attempt_count),
    last_error_code: row.last_error_code === null || row.last_error_code === undefined
      ? null
      : String(row.last_error_code),
    license_id: row.license_id === null || row.license_id === undefined ? null : String(row.license_id),
    correlation_id: String(row.correlation_id),
    next_attempt_at: new Date(String(row.next_attempt_at)).toISOString(),
    confirmed_at: row.confirmed_at === null || row.confirmed_at === undefined
      ? null
      : new Date(String(row.confirmed_at)).toISOString(),
    issued_at: row.issued_at === null || row.issued_at === undefined
      ? null
      : new Date(String(row.issued_at)).toISOString(),
  };
}

/**
 * Durable PostgreSQL queue for autonomous subscription license fulfillment.
 * Claim tokens expire so a crashed worker cannot block recovery forever.
 */
export class PostgresSubscriptionLicenseFulfillmentQueue {
  constructor(private readonly pool: Pool, private readonly limits: Limits) {
    if (![limits.lockTimeoutMs, limits.statementTimeoutMs, limits.claimTtlMs]
      .every((n) => Number.isSafeInteger(n) && n > 0)
      || limits.statementTimeoutMs <= limits.lockTimeoutMs) {
      throw Error("FULFILLMENT_QUEUE_EXPLICIT_LIMITS_REQUIRED");
    }
  }

  async enqueue(input: FulfillmentEnqueueInput): Promise<"INSERTED" | "EXISTING"> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`, `${this.limits.statementTimeoutMs}ms`],
      );
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "subscription-fulfillment:" + input.paymentId,
      ]);
      const result = await this.enqueueOnClient(c, input);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  async enqueueOnClient(c: PoolClient, input: FulfillmentEnqueueInput): Promise<"INSERTED" | "EXISTING"> {
    const confirmedAt = input.status === "CONFIRMED"
      ? (input.confirmedAt ?? new Date())
      : null;
    if (input.status === "CONFIRMED" && confirmedAt === null) {
      throw Error("FULFILLMENT_CONFIRMED_AT_REQUIRED");
    }
    const inserted = await c.query(
      `INSERT INTO subscriptions.license_fulfillment_jobs(
         id,payment_id,quote_id,tenant_id,company_id,confirmation_source,status,
         attempt_count,next_attempt_at,inbox_observation_id,correlation_id,
         confirmed_at,created_at,updated_at,version
       ) VALUES(
         $1,$2,$3,$4,$5,$6,$7,0,clock_timestamp(),$8,$9,$10,clock_timestamp(),clock_timestamp(),1
       )
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING id`,
      [
        uuidV7(), input.paymentId, input.quoteId, input.tenantId, input.companyId,
        input.confirmationSource, input.status, input.inboxObservationId ?? null,
        input.correlationId, confirmedAt,
      ],
    );
    if (inserted.rowCount === 1) return "INSERTED";

    // Promote PENDING → CONFIRMED when a later authoritative confirmation arrives.
    if (input.status === "CONFIRMED") {
      await c.query(
        `UPDATE subscriptions.license_fulfillment_jobs
         SET status='CONFIRMED',
             confirmation_source=CASE
               WHEN confirmation_source='PENDING_WEBHOOK' THEN $2
               ELSE confirmation_source
             END,
             confirmed_at=COALESCE(confirmed_at,$3),
             inbox_observation_id=COALESCE(inbox_observation_id,$4),
             next_attempt_at=clock_timestamp(),
             last_error_code=NULL,
             updated_at=clock_timestamp(),
             version=version+1
         WHERE payment_id=$1 AND status='PENDING'`,
        [input.paymentId, input.confirmationSource, confirmedAt, input.inboxObservationId ?? null],
      );
    }
    return "EXISTING";
  }

  async claimDue(limit = 1): Promise<ClaimedFulfillmentJob[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw Error("FULFILLMENT_CLAIM_LIMIT_INVALID");
    }
    const c = await this.pool.connect();
    const claimToken = uuidV7();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`, `${this.limits.statementTimeoutMs}ms`],
      );
      const rows = (await c.query(
        `WITH due AS (
           SELECT id FROM subscriptions.license_fulfillment_jobs
           WHERE status IN ('PENDING','CONFIRMED')
             AND next_attempt_at<=clock_timestamp()
             AND (claim_token IS NULL OR claim_expires_at<=clock_timestamp())
           ORDER BY next_attempt_at ASC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE subscriptions.license_fulfillment_jobs j
         SET claim_token=$2,
             claimed_at=clock_timestamp(),
             claim_expires_at=clock_timestamp()+($3::text||' milliseconds')::interval,
             attempt_count=attempt_count+1,
             updated_at=clock_timestamp(),
             version=version+1
         FROM due
         WHERE j.id=due.id
         RETURNING j.id,j.payment_id,j.quote_id,j.tenant_id,j.company_id,j.status,
                   j.confirmation_source,j.attempt_count,j.correlation_id,j.inbox_observation_id`,
        [limit, claimToken, String(this.limits.claimTtlMs)],
      )).rows as Array<Record<string, unknown>>;
      await c.query("COMMIT");
      return rows.map((row) => ({
        id: String(row.id),
        paymentId: String(row.payment_id),
        quoteId: String(row.quote_id),
        tenantId: String(row.tenant_id),
        companyId: String(row.company_id),
        status: row.status as "PENDING" | "CONFIRMED",
        confirmationSource: row.confirmation_source as SubscriptionFulfillmentConfirmationSource,
        attemptCount: Number(row.attempt_count),
        correlationId: String(row.correlation_id),
        claimToken,
        inboxObservationId: row.inbox_observation_id === null || row.inbox_observation_id === undefined
          ? null
          : String(row.inbox_observation_id),
      }));
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  async markConfirmed(
    jobId: string,
    claimToken: string,
    source: Exclude<SubscriptionFulfillmentConfirmationSource, "PENDING_WEBHOOK">,
    inboxObservationId: string | null,
  ): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`, `${this.limits.statementTimeoutMs}ms`],
      );
      const updated = await c.query(
        `UPDATE subscriptions.license_fulfillment_jobs
         SET status='CONFIRMED',confirmation_source=$3,confirmed_at=COALESCE(confirmed_at,clock_timestamp()),
             inbox_observation_id=COALESCE($4,inbox_observation_id),
             claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
             last_error_code=NULL,next_attempt_at=clock_timestamp(),
             updated_at=clock_timestamp(),version=version+1
         WHERE id=$1 AND claim_token=$2 AND status='PENDING'
         RETURNING id`,
        [jobId, claimToken, source, inboxObservationId],
      );
      if (updated.rowCount !== 1) throw Error("FULFILLMENT_CLAIM_LOST");
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  async markIssuedPipeline(
    paymentId: string,
    licenseId: string,
    claimToken: string | null = null,
  ): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`, `${this.limits.statementTimeoutMs}ms`],
      );
      const updated = await c.query(
        `UPDATE subscriptions.license_fulfillment_jobs
         SET status='ACTIVATION_PENDING',
             license_id=$2,
             confirmed_at=COALESCE(confirmed_at,clock_timestamp()),
             issued_at=COALESCE(issued_at,clock_timestamp()),
             claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
             last_error_code=NULL,
             updated_at=clock_timestamp(),version=version+1
         WHERE payment_id=$1
           AND status IN ('PENDING','CONFIRMED','ISSUED','DELIVERY_PENDING','ACTIVATION_PENDING')
           AND ($3::uuid IS NULL OR claim_token=$3 OR claim_token IS NULL)
         RETURNING id`,
        [paymentId, licenseId, claimToken],
      );
      if (updated.rowCount !== 1) {
        // Idempotent: job may already be terminal for this payment/license.
        const existing = await c.query(
          `SELECT license_id::text AS license_id,status FROM subscriptions.license_fulfillment_jobs
           WHERE payment_id=$1`,
          [paymentId],
        );
        const row = existing.rows[0] as { license_id: string | null; status: string } | undefined;
        if (!row || (row.license_id !== null && row.license_id !== licenseId)) {
          throw Error("FULFILLMENT_ISSUE_STATE_CONFLICT");
        }
        if (row.license_id === null) throw Error("FULFILLMENT_CLAIM_LOST");
      }
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  async markRetry(
    jobId: string,
    claimToken: string,
    errorCode: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${this.limits.lockTimeoutMs}ms`, `${this.limits.statementTimeoutMs}ms`],
      );
      const updated = await c.query(
        `UPDATE subscriptions.license_fulfillment_jobs
         SET claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
             last_error_code=$3,next_attempt_at=$4,
             updated_at=clock_timestamp(),version=version+1
         WHERE id=$1 AND claim_token=$2 AND status IN ('PENDING','CONFIRMED')
         RETURNING id`,
        [jobId, claimToken, errorCode.slice(0, 128), nextAttemptAt],
      );
      if (updated.rowCount !== 1) throw Error("FULFILLMENT_CLAIM_LOST");
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }

  async getByPaymentId(paymentId: string): Promise<SubscriptionFulfillmentJobView | null> {
    const result = await this.pool.query(
      `SELECT payment_id,quote_id,tenant_id,company_id,status,confirmation_source,attempt_count,
              last_error_code,license_id,correlation_id,next_attempt_at,confirmed_at,issued_at
       FROM subscriptions.license_fulfillment_jobs WHERE payment_id=$1`,
      [paymentId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapJob(row) : null;
  }

  async listRecent(limit = 50): Promise<SubscriptionFulfillmentJobView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw Error("FULFILLMENT_LIST_LIMIT_INVALID");
    }
    const result = await this.pool.query(
      `SELECT payment_id,quote_id,tenant_id,company_id,status,confirmation_source,attempt_count,
              last_error_code,license_id,correlation_id,next_attempt_at,confirmed_at,issued_at
       FROM subscriptions.license_fulfillment_jobs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return (result.rows as Array<Record<string, unknown>>).map(mapJob);
  }
}
