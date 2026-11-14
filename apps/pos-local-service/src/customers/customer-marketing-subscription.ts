import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { createHash, randomUUID } from "node:crypto";

export const PERMISSION_CUSTOMERS_MARKETING_MANAGE = "CUSTOMERS_CUSTOMER_REGISTER";
export const MARKETING_TOPIC_POS_NEWS = "POS_NEWS";
export const MARKETING_CHANNEL_EMAIL = "EMAIL";
export const MARKETING_CONSENT_VERSION = "1.0";

export type MarketingSubscriptionStatus = "SUBSCRIBED" | "UNSUBSCRIBED";

export interface MarketingSubscription {
  readonly customerId: string;
  readonly channel: typeof MARKETING_CHANNEL_EMAIL;
  readonly topic: typeof MARKETING_TOPIC_POS_NEWS;
  readonly status: MarketingSubscriptionStatus;
  readonly consentVersion: string | null;
  readonly consentedAt: string | null;
  readonly unsubscribedAt: string | null;
  readonly source: "POS";
  readonly updatedAt: string;
}

export type MarketingSubscriptionResult =
  | { readonly kind: "SUBSCRIBED"; readonly subscription: MarketingSubscription }
  | { readonly kind: "UNSUBSCRIBED"; readonly subscription: MarketingSubscription }
  | { readonly kind: "IDEMPOTENT"; readonly subscription: MarketingSubscription }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "CUSTOMER_NOT_FOUND" }
  | { readonly kind: "EMAIL_REQUIRED" }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

export interface CustomerMarketingInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly authSnapshot: StoredAuthorizationSnapshot;
  readonly customerId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly at: Date;
}

function checksum(input: CustomerMarketingInput, action: "SUBSCRIBE" | "UNSUBSCRIBE"): string {
  return createHash("sha256").update(canonicalJson({
    action,
    customer_id: input.customerId,
    idempotency_key: input.idempotencyKey,
    operator_user_id: input.authSnapshot.claims.user_id,
    topic: MARKETING_TOPIC_POS_NEWS,
    channel: MARKETING_CHANNEL_EMAIL,
  })).digest("hex");
}

export class CustomerMarketingSubscriptionStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private permission(input: CustomerMarketingInput) {
    return evaluatePermission({
      actor: createActor("USER", input.authSnapshot.claims.user_id),
      permission: PERMISSION_CUSTOMERS_MARKETING_MANAGE,
      scope: createOperationScope(input.scope.tenantId, input.scope.companyId, input.scope.branchId),
      at: input.at,
      assignments: toRoleAssignments(input.authSnapshot.claims),
    });
  }

  private read(input: CustomerMarketingInput): MarketingSubscription | null {
    const row = this.database.native.prepare(
      "SELECT customer_id,status,consent_version,consented_at,unsubscribed_at,source,updated_at FROM customer_marketing_subscriptions WHERE tenant_id=? AND company_id=? AND customer_id=? AND channel=? AND topic=?",
    ).get(
      input.scope.tenantId,
      input.scope.companyId,
      input.customerId,
      MARKETING_CHANNEL_EMAIL,
      MARKETING_TOPIC_POS_NEWS,
    ) as {
      customer_id: string;
      status: MarketingSubscriptionStatus;
      consent_version: string | null;
      consented_at: string | null;
      unsubscribed_at: string | null;
      source: "POS";
      updated_at: string;
    } | undefined;

    if (!row) return null;
    return {
      customerId: row.customer_id,
      channel: MARKETING_CHANNEL_EMAIL,
      topic: MARKETING_TOPIC_POS_NEWS,
      status: row.status,
      consentVersion: row.consent_version,
      consentedAt: row.consented_at,
      unsubscribedAt: row.unsubscribed_at,
      source: row.source,
      updatedAt: row.updated_at,
    };
  }

  private requirePermission(input: CustomerMarketingInput): MarketingSubscriptionResult | null {
    const decision = this.permission(input);
    return decision.allowed ? null : { kind: "UNAUTHORIZED", reason: decision.reason };
  }

  executeSubscribe(input: CustomerMarketingInput): MarketingSubscriptionResult {
    const denied = this.requirePermission(input);
    if (denied) return denied;

    const customer = this.database.native.prepare(
      "SELECT email FROM customers_customers WHERE tenant_id=? AND company_id=? AND id=?",
    ).get(input.scope.tenantId, input.scope.companyId, input.customerId) as
      { email: string | null } | undefined;

    if (!customer) return { kind: "CUSTOMER_NOT_FOUND" };
    if (!customer.email?.trim()) return { kind: "EMAIL_REQUIRED" };
    return this.write(input, "SUBSCRIBE", checksum(input, "SUBSCRIBE"));
  }

  executeUnsubscribe(input: CustomerMarketingInput): MarketingSubscriptionResult {
    const denied = this.requirePermission(input);
    if (denied) return denied;

    const customer = this.database.native.prepare(
      "SELECT id FROM customers_customers WHERE tenant_id=? AND company_id=? AND id=?",
    ).get(input.scope.tenantId, input.scope.companyId, input.customerId) as
      { id: string } | undefined;

    if (!customer) return { kind: "CUSTOMER_NOT_FOUND" };
    return this.write(input, "UNSUBSCRIBE", checksum(input, "UNSUBSCRIBE"));
  }

  get(scope: Pick<SyncScope, "tenantId" | "companyId">, customerId: string): MarketingSubscription | null {
    const row = this.database.native.prepare(
      "SELECT customer_id,status,consent_version,consented_at,unsubscribed_at,source,updated_at FROM customer_marketing_subscriptions WHERE tenant_id=? AND company_id=? AND customer_id=? AND channel=? AND topic=?",
    ).get(
      scope.tenantId,
      scope.companyId,
      customerId,
      MARKETING_CHANNEL_EMAIL,
      MARKETING_TOPIC_POS_NEWS,
    ) as {
      customer_id: string;
      status: MarketingSubscriptionStatus;
      consent_version: string | null;
      consented_at: string | null;
      unsubscribed_at: string | null;
      source: "POS";
      updated_at: string;
    } | undefined;

    if (!row) return null;
    return {
      customerId: row.customer_id,
      channel: MARKETING_CHANNEL_EMAIL,
      topic: MARKETING_TOPIC_POS_NEWS,
      status: row.status,
      consentVersion: row.consent_version,
      consentedAt: row.consented_at,
      unsubscribedAt: row.unsubscribed_at,
      source: row.source,
      updatedAt: row.updated_at,
    };
  }

  private write(
    input: CustomerMarketingInput,
    action: "SUBSCRIBE" | "UNSUBSCRIBE",
    requestChecksum: string,
  ): MarketingSubscriptionResult {
    return this.database.native.transaction((): MarketingSubscriptionResult => {
      const nowIso = this.now().toISOString();
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;

      if (operation) {
        if (operation.payload_checksum !== requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" };
        const existing = this.read(input);
        if (!existing) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", subscription: existing };
      }

      const existing = this.read(input);
      const status: MarketingSubscriptionStatus = action === "SUBSCRIBE"
        ? "SUBSCRIBED"
        : "UNSUBSCRIBED";
      const consentVersion = action === "SUBSCRIBE"
        ? MARKETING_CONSENT_VERSION
        : (existing?.consentVersion ?? null);
      const consentedAt = action === "SUBSCRIBE"
        ? nowIso
        : (existing?.consentedAt ?? null);
      const unsubscribedAt = action === "UNSUBSCRIBE" ? nowIso : null;
      const version = existing ? 2 : 1;

      this.database.native.prepare(
        "INSERT INTO customer_marketing_subscriptions(tenant_id,company_id,customer_id,channel,topic,status,consent_version,consented_at,unsubscribed_at,source,updated_by_actor_id,session_id,correlation_id,causation_id,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,company_id,customer_id,channel,topic) DO UPDATE SET status=excluded.status,consent_version=excluded.consent_version,consented_at=excluded.consented_at,unsubscribed_at=excluded.unsubscribed_at,source=excluded.source,updated_by_actor_id=excluded.updated_by_actor_id,session_id=excluded.session_id,correlation_id=excluded.correlation_id,causation_id=excluded.causation_id,version=customer_marketing_subscriptions.version+1,updated_at=excluded.updated_at",
      ).run(
        input.scope.tenantId,
        input.scope.companyId,
        input.customerId,
        MARKETING_CHANNEL_EMAIL,
        MARKETING_TOPIC_POS_NEWS,
        status,
        consentVersion,
        consentedAt,
        unsubscribedAt,
        "POS",
        input.authSnapshot.claims.user_id,
        input.sessionId,
        input.correlationId,
        input.causationId,
        version,
        nowIso,
      );

      this.database.native.prepare(
        "INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at) VALUES (?,?,?,'SUCCEEDED',?,?,?)",
      ).run(
        randomUUID(),
        input.idempotencyKey,
        requestChecksum,
        action === "SUBSCRIBE" ? "SUBSCRIBED" : "UNSUBSCRIBED",
        nowIso,
        nowIso,
      );

      this.database.native.prepare(
        "INSERT INTO local_operation_audit(tenant_id,company_id,branch_id,device_id,actor_type,actor_id,session_id,action_code,resource_type,resource_id,correlation_id,causation_id,reason_code,details_json,created_at) VALUES (?,?,?,?,'USER',?,?,?, ?,?,?,?,NULL,?,?)",
      ).run(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        input.authSnapshot.claims.user_id,
        input.sessionId,
        "CUSTOMER_MARKETING_" + action,
        "CUSTOMER_MARKETING_SUBSCRIPTION",
        input.customerId,
        input.correlationId,
        input.causationId,
        canonicalJson({
          channel: MARKETING_CHANNEL_EMAIL,
          topic: MARKETING_TOPIC_POS_NEWS,
          consent_version: consentVersion,
          source: "POS",
        }),
        nowIso,
      );

      const subscription = this.read(input);
      if (!subscription) throw new Error("marketing subscription write did not persist");

      return {
        kind: action === "SUBSCRIBE" ? "SUBSCRIBED" : "UNSUBSCRIBED",
        subscription,
      };
    })();
  }
}
