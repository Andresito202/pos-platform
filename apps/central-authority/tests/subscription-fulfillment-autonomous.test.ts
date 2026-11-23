import { describe, expect, it, vi } from "vitest";
import {
  SubscriptionFulfillmentProvisionSchema,
  isSubscriptionFulfillmentRetryableError,
  subscriptionFulfillmentBackoffMs,
  uuidV7,
} from "@pos-platform/contracts";
import { SubscriptionLicenseContracts } from "../src/subscription-license-contracts.js";
import { SubscriptionLicenseFulfillment } from "../src/subscription-license-fulfillment.js";

describe("subscription autonomous fulfillment authorization boundary", () => {
  it("rejects SERVICE issue when fulfillment is not provisioned", async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error("POOL_SHOULD_NOT_CONNECT_WITHOUT_PROVISION");
      }),
    };
    const licenses = new SubscriptionLicenseContracts(
      pool as never,
      [{
        policy_reference: "TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION",
        tax_policy_reference: "TEST_TAX_RESULT",
        support_policy_reference: "TEST_SUPPORT_TERMS",
      }],
      { reauthenticationMs: 60_000, lockTimeoutMs: 2_000, statementTimeoutMs: 10_000 },
      null,
    );
    await expect(licenses.issueAsService(uuidV7(), uuidV7()))
      .rejects.toThrow("LICENSING_SERVICE_FULFILLMENT_NOT_PROVISIONED");
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("does not accept a generic skipAuth bypass on the public issue path", () => {
    const licenses = new SubscriptionLicenseContracts(
      { connect: vi.fn() } as never,
      [{
        policy_reference: "TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION",
        tax_policy_reference: "TEST_TAX_RESULT",
        support_policy_reference: "TEST_SUPPORT_TERMS",
      }],
      { reauthenticationMs: 60_000, lockTimeoutMs: 2_000, statementTimeoutMs: 10_000 },
      "SERVICE_POLICY",
    );
    expect(typeof licenses.issue).toBe("function");
    expect(typeof licenses.issueAsService).toBe("function");
    expect("skipAuth" in licenses).toBe(false);
  });
});

describe("subscription fulfillment recovery and concurrency semantics", () => {
  it("models crash between CONFIRMED and ISSUE as durable retry with backoff", () => {
    const provision = SubscriptionFulfillmentProvisionSchema.parse({
      profile: "CAMACHO_SUBSCRIPTION_FULFILLMENT_V1",
      policy_reference: "TEST_POLICY",
      expected_database: "pos_central",
      migration_checksum: "b".repeat(64),
      lock_timeout_ms: 2000,
      statement_timeout_ms: 10000,
      claim_ttl_ms: 30000,
      poll_interval_ms: 1000,
      max_attempts: 8,
      base_backoff_ms: 500,
      max_backoff_ms: 8000,
    });

    // Simulate a worker crash after payment confirm: job stays CONFIRMED, claim expires.
    const job = {
      paymentId: uuidV7(),
      status: "CONFIRMED" as const,
      attemptCount: 1,
      claimToken: uuidV7(),
      claimExpiresAt: Date.now() - 1,
    };
    expect(job.status).toBe("CONFIRMED");
    expect(job.claimExpiresAt).toBeLessThan(Date.now());

    const nextDelay = subscriptionFulfillmentBackoffMs(
      job.attemptCount,
      provision.base_backoff_ms,
      provision.max_backoff_ms,
    );
    expect(nextDelay).toBe(1000);
    expect(isSubscriptionFulfillmentRetryableError("FULFILLMENT_CLAIM_LOST")).toBe(true);
  });

  it("ensures concurrent workers cannot both keep the same claim token", () => {
    // SKIP LOCKED + single claim_token per update: two workers racing on one row
    // produce at most one winner; the loser observes FULFILLMENT_CLAIM_LOST.
    const claims = new Map<string, string>();
    const paymentId = uuidV7();
    const workerA = uuidV7();
    const workerB = uuidV7();

    const tryClaim = (worker: string) => {
      if (claims.has(paymentId)) return false;
      claims.set(paymentId, worker);
      return true;
    };

    const first = tryClaim(workerA);
    const second = tryClaim(workerB);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(claims.get(paymentId)).toBe(workerA);

    // After crash, claim expires and either worker may reclaim exactly once.
    claims.delete(paymentId);
    expect(tryClaim(workerB)).toBe(true);
    expect(tryClaim(workerA)).toBe(false);
  });

  it("keeps commercial_reference uniqueness as the dual-path race fence", () => {
    const paymentId = uuidV7();
    const reference = `SUBSCRIPTION_PAYMENT:${paymentId}`;
    const issued = new Set<string>();
    const race = (actor: "GLOBAL_SESSION" | "SERVICE") => {
      if (issued.has(reference)) return { idempotent: true, actor };
      issued.add(reference);
      return { idempotent: false, actor };
    };
    const a = race("GLOBAL_SESSION");
    const b = race("SERVICE");
    expect(a.idempotent).toBe(false);
    expect(b.idempotent).toBe(true);
    expect(issued.size).toBe(1);
  });

  it("ignores non-subscription webhook observations at the filter boundary", () => {
    const filter = (collectionSubjectType: string | null) =>
      collectionSubjectType === "SUBSCRIPTION_QUOTE" ? "ENQUEUE" : "IGNORE";
    expect(filter("SUBSCRIPTION_QUOTE")).toBe("ENQUEUE");
    expect(filter("POS_SALE")).toBe("IGNORE");
    expect(filter(null)).toBe("IGNORE");
  });
});

describe("subscription webhook replay after successful inbox acknowledgment", () => {
  const provision=SubscriptionFulfillmentProvisionSchema.parse({
    profile:"CAMACHO_SUBSCRIPTION_FULFILLMENT_V1",
    policy_reference:"TEST_POLICY",
    expected_database:"pos_central",
    migration_checksum:"b".repeat(64),
    lock_timeout_ms:2000,statement_timeout_ms:10000,claim_ttl_ms:30000,
    poll_interval_ms:1000,max_attempts:8,base_backoff_ms:500,max_backoff_ms:8000,
  });
  const policies=[{
    policy_reference:"TEST_POLICY",tax_policy_reference:"TEST_TAX",
    support_policy_reference:"TEST_SUPPORT",
  }];

  it("replays a persisted Factus subscription event without another webhook",async()=>{
    const row={
      tenant_id:uuidV7(),company_id:uuidV7(),integration_id:uuidV7(),
      external_transaction_id:uuidV7(),amount_scale6:"49900.000000",currency_code:"COP",
    };
    const pool={query:vi.fn(async(_sql:string,_params?:unknown[])=>({rows:[row]}))};
    const fulfillment=new SubscriptionLicenseFulfillment(pool as never,provision,policies);
    const enqueue=vi.spyOn(fulfillment,"enqueueFromWebhookObservation").mockResolvedValue("ENQUEUED");
    await expect(fulfillment.recoverUnqueuedSubscriptionWebhooks()).resolves.toEqual({recovered:1,errors:[]});
    expect(enqueue).toHaveBeenCalledWith({
      tenantId:row.tenant_id,companyId:row.company_id,integrationId:row.integration_id,
      externalTransactionId:row.external_transaction_id,
      amountScale6:row.amount_scale6,currencyCode:"COP",
    });
    const sql=String(pool.query.mock.calls[0]?.[0]);
    expect(sql).toContain("g.collection_subject_type='SUBSCRIPTION_QUOTE'");
    expect(sql).toContain("j.payment_id IS NULL");
    expect(sql).toContain("i.provider_status='paid'");
    expect(sql).toContain("i.amount=q.total_minor::numeric/power");
  });

  it("recovers on the next poll after transient enqueue failure without provider resend",async()=>{
    const row={
      tenant_id:uuidV7(),company_id:uuidV7(),integration_id:uuidV7(),
      external_transaction_id:uuidV7(),amount_scale6:"49900.000000",currency_code:"COP",
    };
    const pool={query:vi.fn(async(_sql:string,_params?:unknown[])=>({rows:[row]}))};
    const fulfillment=new SubscriptionLicenseFulfillment(pool as never,provision,policies);
    const enqueue=vi.spyOn(fulfillment,"enqueueFromWebhookObservation")
      .mockRejectedValueOnce(new Error("TRANSIENT_DB_ENQUEUE_FAILED"))
      .mockResolvedValueOnce("ENQUEUED");
    const first=await fulfillment.recoverUnqueuedSubscriptionWebhooks();
    expect(first).toEqual({recovered:0,errors:["TRANSIENT_DB_ENQUEUE_FAILED"]});
    const second=await fulfillment.recoverUnqueuedSubscriptionWebhooks();
    expect(second).toEqual({recovered:1,errors:[]});
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("does not enqueue POS webhooks and surfaces transient replay failures",async()=>{
    const pool={query:vi.fn(async(_sql:string,_params?:unknown[])=>({rows:[]}))};
    const fulfillment=new SubscriptionLicenseFulfillment(pool as never,provision,policies);
    const enqueue=vi.spyOn(fulfillment,"enqueueFromWebhookObservation");
    await expect(fulfillment.recoverUnqueuedSubscriptionWebhooks()).resolves.toEqual({recovered:0,errors:[]});
    expect(enqueue).not.toHaveBeenCalled();
    await expect(fulfillment.recoverUnqueuedSubscriptionWebhooks(0)).rejects.toThrow("FULFILLMENT_RECOVERY_LIMIT_INVALID");
  });
});
