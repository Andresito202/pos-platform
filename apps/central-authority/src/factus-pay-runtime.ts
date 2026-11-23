import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { FactusPayIngressProvisionSchema, type QrPaymentObservation } from "@pos-platform/contracts";
import {
  PostgresFactusPayWebhookInboxRepository,
  type FactusPayWebhookInbox,
  type FactusPayWebhookKeyContext,
  type Pool,
} from "@pos-platform/database-postgres";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";
import { createFactusPayWebhookHandler } from "./factus-pay-webhook-handler.js";

export type FactusPaySubscriptionHook = (
  observation: QrPaymentObservation,
  keyContext: FactusPayWebhookKeyContext,
  result: "STORED" | "DUPLICATE",
) => Promise<void>;

/** Wraps the durable inbox so subscription fulfillment can enqueue without
 * changing the webhook acknowledgement boundary. */
class SubscriptionAwareFactusPayInbox implements FactusPayWebhookInbox {
  constructor(
    private readonly inner: FactusPayWebhookInbox,
    private readonly onPersisted: FactusPaySubscriptionHook,
  ) {}
  resolveKey(suppliedKey: string) {
    return this.inner.resolveKey(suppliedKey);
  }
  async persistVerifiedObservation(
    observation: QrPaymentObservation,
    keyContext: FactusPayWebhookKeyContext,
    idempotencyKey: string,
  ) {
    const result = await this.inner.persistVerifiedObservation(observation, keyContext, idempotencyKey);
    try {
      await this.onPersisted(observation, keyContext, result);
    } catch {
      // Inbox durability already committed. Fulfillment enqueue failures are
      // recovered by the background worker / replay; do not fail the webhook 2xx.
    }
    return result;
  }
}

/** Opt-in mounting in the existing HTTPS server, with explicit operational
 * limits and exact 018 ledger. No provider secret enters this configuration. */
export async function prepareFactusPayRuntime(
  pool: Pool,
  path: string,
  options?: { onSubscriptionObservation: FactusPaySubscriptionHook },
) {
  if (!isAbsolute(path)) throw Error("FACTUS_PAY_MANAGED_FILE_REQUIRED");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error("FACTUS_PAY_MANAGED_FILE_REJECTED");
  const p = FactusPayIngressProvisionSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path))),
  );
  const ledger = await pool.query(`SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions
    WHERE migration_id='018_factus_pay_webhook_inbox' AND status='APPLIED'`);
  if (ledger.rows.length !== 1 || ledger.rows[0].checksum !== p.migration_checksum) {
    throw Error("FACTUS_PAY_REGISTERED_SCHEMA_REQUIRED");
  }
  const role = await pool.query(`SELECT current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS eligible FROM pg_roles WHERE rolname=current_user`);
  if (role.rows[0]?.eligible !== true) throw Error("FACTUS_PAY_CENTRAL_ROLE_REQUIRED");
  const tables = await pool.query(`SELECT c.relname,c.relrowsecurity AND c.relforcerowsecurity AND r.rolname='pos_schema_owner' AS protected,
    has_table_privilege(current_user,c.oid,'DELETE') AS deletable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='integrations' AND c.relname IN ('factus_pay_webhook_keys','factus_pay_webhook_inbox') AND c.relkind='r'`);
  if (tables.rows.length !== 2 || tables.rows.some((r) => r.protected !== true || r.deletable !== false)) {
    throw Error("FACTUS_PAY_SCHEMA_SECURITY_REQUIRED");
  }
  const limiter = new FixedWindowRateLimiter(p.rate_limit.maximum, p.rate_limit.buckets, p.rate_limit.window_ms);
  const baseInbox = new PostgresFactusPayWebhookInboxRepository({
    pool,
    lockTimeoutMs: p.lock_timeout_ms,
    statementTimeoutMs: p.statement_timeout_ms,
  });
  const inbox: FactusPayWebhookInbox = options?.onSubscriptionObservation
    ? new SubscriptionAwareFactusPayInbox(baseInbox, options.onSubscriptionObservation)
    : baseInbox;
  const handler = createFactusPayWebhookHandler({ inbox, maxBodyBytes: p.max_body_bytes });
  return (request: Parameters<typeof handler>[0], response: Parameters<typeof handler>[1]) => {
    if (!limiter.allow(request.socket.remoteAddress ?? "unknown")) {
      response.writeHead(429, { "cache-control": "no-store", "content-length": "0" });
      response.end();
      return Promise.resolve();
    }
    return handler(request, response);
  };
}
