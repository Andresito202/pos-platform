import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { uuidV7 } from "@pos-platform/contracts";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { ConfirmTransferPaymentUseCase } from "../src/payments/confirm-transfer-payment-use-case.js";
import { RegisterFactusPayCollectionUseCase } from "../src/payments/register-factus-pay-collection-use-case.js";
import { VerifyFactusPayCollectionUseCase } from "../src/payments/verify-factus-pay-collection-use-case.js";
import { ResumeFactusPayCollectionUseCase } from "../src/payments/resume-factus-pay-collection-use-case.js";
import { FactusPayClient } from "../src/payments/factus-pay-client.js";
import { FactusPayCredentialStore } from "../src/payments/factus-pay-credential-store.js";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000aa";
const OTHER_COMPANY = "018f0000-0000-7000-8000-0000000000bb";
const NOW = new Date("2026-09-06T10:00:00.000Z");
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH, deviceId: DEVICE, installationId: INSTALL,
};
const OTHER_SCOPE: SyncScope = {
  tenantId: OTHER_TENANT, companyId: OTHER_COMPANY, branchId: BRANCH, deviceId: DEVICE, installationId: INSTALL,
};

const databases: LocalDatabase[] = [];
const secretStores: EncryptedFileSecretStore[] = [];
const directories: string[] = [];

/**
 * Windows bloquea `unlink` de `pos-local.db` / `-shm` / `-wal` mientras el
 * handle de better-sqlite3 permanece abierto. Cerrar DB y destruir el almacén
 * de secretos **antes** de borrar el directorio temporal.
 */
afterEach(() => {
  for (const secrets of secretStores.splice(0)) {
    try { secrets.destroy(); } catch { /* cleanup */ }
  }
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* cleanup */ }
  }
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function openFixture(): Promise<{
  dir: string;
  database: LocalDatabase;
  secrets: EncryptedFileSecretStore;
  paymentStore: SqlitePaymentStore;
  credentialStore: FactusPayCredentialStore;
}> {
  const dir = await mkdtemp(join(tmpdir(), "factus-pay-collection-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, () => NOW);
  const secrets = new EncryptedFileSecretStore(
    dir,
    new InsecureDerivedKeyProvider(dir),
    `factus-pay-test:${INSTALL}:${DEVICE}:${COMPANY}`,
  );
  secretStores.push(secrets);
  const credentialStore = new FactusPayCredentialStore(secrets, COMPANY);
  credentialStore.deposit({ environment: "SANDBOX", email: "t@invalid", password: "pw" });
  return { dir, database, secrets, paymentStore, credentialStore };
}

function auth(permissions: string[] = ["PAYMENTS_PAYMENT_REGISTER", "PAYMENTS_PAYMENT_READ"]): StoredAuthorizationSnapshot {
  return {
    claims: {
      snapshot_id: randomUUID(),
      user_id: USER,
      installation_id: INSTALL,
      device_id: DEVICE,
      sequence: 1,
      issued_at: "2026-09-06T00:00:00.000Z",
      expires_at: "2026-09-07T00:00:00.000Z",
      key_id: "AUTHZ_KEY_1",
      assignments: [{
        tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
        status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
        role_status: "ACTIVE",
        permissions: permissions.map((code) => ({ code, status: "ACTIVE" })),
      }],
    } as AuthorizationSnapshotClaims,
    signature: "stub",
    activatedAt: NOW.toISOString(),
  };
}

function seedSale(
  db: LocalDatabase,
  saleId = randomUUID(),
  payable = "150000.000000",
  status: "READY_FOR_PAYMENT" | "COMPLETED" = "READY_FOR_PAYMENT",
  tenantId = TENANT,
  companyId = COMPANY,
): string {
  const operationId = uuidV7(NOW.getTime());
  const at = NOW.toISOString();
  db.native.prepare(
    `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
     VALUES (?,?,?,'SUCCEEDED','SALE_CREATED',?,?)`,
  ).run(operationId, `sale:${saleId}`, "b".repeat(64), at, at);
  db.native.prepare(
    `INSERT INTO sales_sales(
      id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id,
      origin_device_id, installation_id, operator_actor_type, operator_actor_id,
      channel, status, business_date, timezone_id, utc_offset_minutes,
      document_series, sale_number, currency_code,
      subtotal_amount, discount_amount, tax_amount, fiscal_total_amount,
      commercial_rounding_adjustment, payable_amount,
      pricing_pipeline_version, pricing_policy_version, promotion_policy_version,
      tax_policy_version, rounding_policy_version, pricing_snapshot, tax_snapshot,
      calculation_checksum, operation_id, idempotency_key, request_checksum,
      correlation_id, causation_id, version, created_at,
      completed_at, cancelled_at, expired_at, server_recorded_at
    ) VALUES (
      ?,?,?,?,NULL,NULL,
      ?,?,'USER',?,
      'POS',?, '2026-09-06','America/Bogota',-300,
      'A',1,'COP',
      ?,?,?,?,
      ?,?,
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,
      'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1','{}','{}',
      ?,?,?,?,
      ?,NULL,1,?,
      ?,NULL,NULL,NULL
    )`,
  ).run(
    saleId, tenantId, companyId, BRANCH,
    DEVICE, INSTALL, USER,
    status,
    payable, "0.000000", "0.000000", payable, "0.000000", payable,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64),
    randomUUID(), at,
    status === "COMPLETED" ? at : null,
  );
  return saleId;
}

type ProviderCollection = {
  reference_code: string;
  amount: string;
  status: string;
  qr?: string;
};

function mockProvider(options?: {
  readonly failPostAfterCreate?: boolean;
  readonly expireTokenOnce?: boolean;
}): {
  collections: Map<string, ProviderCollection>;
  posts: { count: number };
  gets: { count: number };
  authCalls: { count: number };
  transport: typeof fetch;
} {
  const collections = new Map<string, ProviderCollection>();
  const posts = { count: 0 };
  const gets = { count: 0 };
  const authCalls = { count: 0 };
  let tokenGeneration = 0;
  let expiredServed = false;

  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth")) {
      authCalls.count += 1;
      tokenGeneration += 1;
      return new Response(JSON.stringify({ token: `TOKEN_${tokenGeneration}` }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (options?.expireTokenOnce === true && !expiredServed) {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth === "Bearer TOKEN_1" || auth === "Bearer STALE") {
        expiredServed = true;
        return new Response("unauthorized", { status: 401 });
      }
    }
    if (url.endsWith("/v1/collections") && init?.method === "POST") {
      posts.count += 1;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const row: ProviderCollection = {
        reference_code: String(body.reference_code),
        amount: String(body.amount),
        status: "ready",
        qr: "data:image/png;base64,QUJD",
      };
      collections.set(row.reference_code, row);
      if (options?.failPostAfterCreate === true) {
        // Remote create landed; response never returns (timeout after remote create).
        throw new Error("simulated transport timeout after remote create");
      }
      return new Response(JSON.stringify({ status: "success", data: row }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    }
    gets.count += 1;
    const reference = decodeURIComponent(url.split("/").pop() ?? "");
    const row = collections.get(reference);
    if (row === undefined) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify({ status: "success", data: row }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };

  return { collections, posts, gets, authCalls, transport };
}

describe("Factus Pay Caja collections", () => {
  it("registers QR payment, creates provider collection, verifies paid and confirms", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database);
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "150000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);
    expect(collected.qr).toContain("data:image/png");

    const paymentRow = database.native.prepare(
      "SELECT payment_method, status, provider_code FROM payments_payments WHERE id=?",
    ).get(collected.paymentId) as { payment_method: string; status: string; provider_code: string };
    expect(paymentRow).toMatchObject({ payment_method: "QR", status: "CREATED", provider_code: "FACTUS_PAY" });

    provider.collections.set(collected.referenceCode, {
      reference_code: collected.referenceCode,
      amount: "150000",
      status: "paid",
    });

    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") throw new Error(`expected FOUND, got ${read.kind}`);

    expect(paymentStore.get({ ...SCOPE, branchId: randomUUID() }, collected.paymentId)).toEqual({ kind: "NOT_FOUND" });
    expect(paymentStore.get({ ...SCOPE, companyId: randomUUID() }, collected.paymentId)).toEqual({ kind: "NOT_FOUND" });
    const confirmationRequest = {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    };
    const manual = new ConfirmTransferPaymentUseCase(paymentStore, () => NOW);
    const manualResult = manual.execute(SCOPE, SESSION, auth(["PAYMENTS_TRANSFER_CONFIRM"]), confirmationRequest);
    expect(manualResult.kind).toBe("PAYMENT_NOT_CONFIRMABLE");

    const confirmed = await verify.execute(SCOPE, SESSION, auth(), confirmationRequest);
    expect(confirmed.kind).toBe("CONFIRMED");
    expect(database.native.prepare(
      "SELECT status, authority_type, manual_confirmation_actor_id FROM payments_payment_attempts WHERE payment_id=?",
    ).get(collected.paymentId)).toEqual({
      status: "CONFIRMED", authority_type: "EXTERNAL_PROVIDER_AUTHORITATIVE", manual_confirmation_actor_id: null,
    });
  });

  it("rejects verify when provider collection is not paid", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "2000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "2000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);
    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") throw new Error(`expected FOUND, got ${read.kind}`);

    const result = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(result.kind).toBe("FACTUS_PAY_NOT_PAID");
  });

  it("handles concurrent collects with the same idempotency key without duplicate payments", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "3000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const key = randomUUID();
    const request = {
      saleId,
      amount: "3000.000000",
      expirationSeconds: 900,
      idempotencyKey: key,
      correlationId: randomUUID(),
      causationId: null,
    };

    const [a, b] = await Promise.all([
      register.execute(SCOPE, SESSION, auth(), request),
      register.execute(SCOPE, SESSION, auth(), request),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["COLLECTED", "IDEMPOTENT"]);
    const paymentIds = new Set(
      [a, b]
        .filter((r): r is Extract<typeof r, { paymentId: string }> => "paymentId" in r)
        .map((r) => r.paymentId),
    );
    expect(paymentIds.size).toBe(1);
    const count = database.native.prepare(
      "SELECT COUNT(*) AS c FROM payments_payments WHERE tenant_id=? AND payment_method='QR'",
    ).get(TENANT) as { c: number };
    expect(count.c).toBe(1);
    expect(provider.posts.count).toBe(1);
  });

  it("duplicate collect requests replay via GET without a second create POST", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "4000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const key = randomUUID();
    const request = {
      saleId,
      amount: "4000.000000",
      expirationSeconds: 900,
      idempotencyKey: key,
      correlationId: randomUUID(),
      causationId: null,
    };

    const first = await register.execute(SCOPE, SESSION, auth(), request);
    expect(first.kind).toBe("COLLECTED");
    const postsAfterFirst = provider.posts.count;
    expect(postsAfterFirst).toBe(1);

    const second = await register.execute(SCOPE, SESSION, auth(), request);
    expect(second.kind).toBe("IDEMPOTENT");
    expect(provider.posts.count).toBe(1);
    expect(provider.gets.count).toBeGreaterThanOrEqual(1);
    if (first.kind === "COLLECTED" && second.kind === "IDEMPOTENT") {
      expect(second.paymentId).toBe(first.paymentId);
      expect(second.referenceCode).toBe(first.referenceCode);
    }
  });

  it("after timeout following remote create, replay GETs and does not POST again", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "5000.000000");
    let postPhase = 0;
    const collections = new Map<string, ProviderCollection>();
    let posts = 0;
    let gets = 0;
    const transport: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth")) {
        return new Response(JSON.stringify({ token: "T" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/collections") && init?.method === "POST") {
        posts += 1;
        postPhase += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const row: ProviderCollection = {
          reference_code: String(body.reference_code),
          amount: String(body.amount),
          status: "ready",
          qr: "data:image/png;base64,QUJD",
        };
        collections.set(row.reference_code, row);
        if (postPhase === 1) {
          throw new Error("timeout after remote create");
        }
        throw new Error("unexpected second POST");
      }
      gets += 1;
      const reference = decodeURIComponent(url.split("/").pop() ?? "");
      const row = collections.get(reference);
      if (row === undefined) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({ status: "success", data: row }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };

    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const key = randomUUID();
    const request = {
      saleId,
      amount: "5000.000000",
      expirationSeconds: 900,
      idempotencyKey: key,
      correlationId: randomUUID(),
      causationId: null,
    };

    const failed = await register.execute(SCOPE, SESSION, auth(), request);
    expect(failed.kind).toBe("REGISTERED_PROVIDER_FAILED");
    expect(posts).toBe(1);

    const recovered = await register.execute(SCOPE, SESSION, auth(), request);
    expect(recovered.kind).toBe("IDEMPOTENT");
    expect(posts).toBe(1);
    expect(gets).toBeGreaterThanOrEqual(1);
    if (failed.kind === "REGISTERED_PROVIDER_FAILED" && recovered.kind === "IDEMPOTENT") {
      expect(recovered.paymentId).toBe(failed.paymentId);
      expect(recovered.referenceCode).toBe(failed.referenceCode);
    }
  });

  it("resumes a pending collection after restart mid-charge without confirming", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "6000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const resume = new ResumeFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "6000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);

    // Simulate process restart: new client/use-case instances over same durable store.
    const clientAfterRestart = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const resumeAfterRestart = new ResumeFactusPayCollectionUseCase(paymentStore, clientAfterRestart, () => NOW);
    const resumed = await resumeAfterRestart.execute(SCOPE, auth(), { saleId });
    expect(resumed.kind).toBe("FOUND");
    if (resumed.kind !== "FOUND") throw new Error(`expected FOUND, got ${resumed.kind}`);
    expect(resumed.paymentId).toBe(collected.paymentId);
    expect(resumed.referenceCode).toBe(collected.referenceCode);
    expect(resumed.status).toBe("CREATED");
    expect(resumed.providerStatus).toBe("ready");

    const status = database.native.prepare(
      "SELECT status FROM payments_payments WHERE id=?",
    ).get(collected.paymentId) as { status: string };
    expect(status.status).toBe("CREATED");
    void resume;
  });

  it("retransmits verify of an already confirmed payment as IDEMPOTENT without duplicate effects", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "7000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "7000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);

    provider.collections.set(collected.referenceCode, {
      reference_code: collected.referenceCode,
      amount: "7000",
      status: "paid",
    });
    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") throw new Error(`expected FOUND, got ${read.kind}`);

    const verifyKey = randomUUID();
    const first = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: verifyKey,
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(first.kind).toBe("CONFIRMED");

    const allocationsBefore = database.native.prepare(
      "SELECT COUNT(*) AS c FROM payments_payment_allocations WHERE tenant_id=?",
    ).get(TENANT) as { c: number };
    const opsBefore = database.native.prepare(
      "SELECT COUNT(*) AS c FROM runtime_operations WHERE result_code='PAYMENT_CONFIRMED'",
    ).get() as { c: number };

    const second = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: verifyKey,
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(second.kind).toBe("IDEMPOTENT");

    const allocationsAfter = database.native.prepare(
      "SELECT COUNT(*) AS c FROM payments_payment_allocations WHERE tenant_id=?",
    ).get(TENANT) as { c: number };
    expect(allocationsAfter.c).toBe(allocationsBefore.c);
    const opsAfter = database.native.prepare(
      "SELECT COUNT(*) AS c FROM runtime_operations WHERE result_code='PAYMENT_CONFIRMED'",
    ).get() as { c: number };
    expect(opsAfter.c).toBe(opsBefore.c);

    const confirmedCount = database.native.prepare(
      "SELECT COUNT(*) AS c FROM payments_payments WHERE tenant_id=? AND status='CONFIRMED'",
    ).get(TENANT) as { c: number };
    expect(confirmedCount.c).toBe(1);

    const sale = database.native.prepare(
      "SELECT status FROM sales_sales WHERE id=?",
    ).get(saleId) as { status: string };
    expect(sale.status).toBe("COMPLETED");
  });

  it("recovers from expired provider token during collect without unsafe charge retries", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "8000.000000");
    const provider = mockProvider({ expireTokenOnce: true });
    credentialStore.writeCachedToken("SANDBOX", "STALE");
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "8000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    expect(provider.posts.count).toBe(1);
    expect(provider.authCalls.count).toBeGreaterThanOrEqual(1);
  });

  it("rejects verify when provider amount disagrees with persisted expected amount", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "9000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "9000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);

    provider.collections.set(collected.referenceCode, {
      reference_code: collected.referenceCode,
      amount: "1",
      status: "paid",
    });
    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") throw new Error(`expected FOUND, got ${read.kind}`);

    const result = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(result.kind).toBe("FACTUS_PAY_VERIFICATION_FAILED");
    const status = database.native.prepare(
      "SELECT status FROM payments_payments WHERE id=?",
    ).get(collected.paymentId) as { status: string };
    expect(status.status).toBe("CREATED");
  });

  it("rejects verify when provider reference disagrees with persisted reference", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "9100.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "9100.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);

    provider.collections.set(collected.referenceCode, {
      reference_code: "POS-TAMPERED-REFERENCE-XXXX",
      amount: "9100",
      status: "paid",
    });
    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") throw new Error(`expected FOUND, got ${read.kind}`);

    const result = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(result.kind).toBe("FACTUS_PAY_VERIFICATION_FAILED");
  });

  it("isolates payments between companies/tenants", async () => {
    const { dir, database, paymentStore, credentialStore, secrets } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "10000.000000");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "10000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);

    const foreign = paymentStore.get(OTHER_SCOPE, collected.paymentId);
    expect(foreign.kind).toBe("NOT_FOUND");

    const foreignAuth: StoredAuthorizationSnapshot = {
      ...auth(),
      claims: {
        ...auth().claims,
        assignments: [{
          tenant_id: OTHER_TENANT, company_id: OTHER_COMPANY, branch_id: BRANCH,
          status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
          role_status: "ACTIVE",
          permissions: [
            { code: "PAYMENTS_PAYMENT_REGISTER", status: "ACTIVE" },
            { code: "PAYMENTS_PAYMENT_READ", status: "ACTIVE" },
          ],
        }],
      } as AuthorizationSnapshotClaims,
    };
    const foreignVerify = await verify.execute(OTHER_SCOPE, SESSION, foreignAuth, {
      paymentId: collected.paymentId,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(foreignVerify.kind).toBe("PAYMENT_NOT_FOUND");

    // Company B cannot resolve company A credentials from the same encrypted store.
    const foreignCreds = new FactusPayCredentialStore(secrets, OTHER_COMPANY);
    expect(() => foreignCreds.resolveLogin("SANDBOX")).toThrow();
    expect(credentialStore.resolveLogin("SANDBOX").email).toBe("t@invalid");
    void dir;
  });

  it("reconciles provider-paid collection when the sale cannot complete", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "11000.000000", "READY_FOR_PAYMENT");
    const provider = mockProvider();
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, provider.transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const verify = new VerifyFactusPayCollectionUseCase(paymentStore, client, () => NOW);

    const collected = await register.execute(SCOPE, SESSION, auth(), {
      saleId,
      amount: "11000.000000",
      expirationSeconds: 900,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(collected.kind).toBe("COLLECTED");
    if (collected.kind !== "COLLECTED") throw new Error(`expected COLLECTED, got ${collected.kind}`);

    // Sale completed by another tender before QR verify — provider already paid.
    database.native.prepare(
      "UPDATE sales_sales SET status='COMPLETED', completed_at=? WHERE id=?",
    ).run(NOW.toISOString(), saleId);

    provider.collections.set(collected.referenceCode, {
      reference_code: collected.referenceCode,
      amount: "11000",
      status: "paid",
    });
    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") throw new Error(`expected FOUND, got ${read.kind}`);

    const result = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(result.kind).toBe("SALE_ALREADY_COMPLETED");

    const payment = database.native.prepare(
      "SELECT status FROM payments_payments WHERE id=?",
    ).get(collected.paymentId) as { status: string };
    expect(payment.status).toBe("CREATED");

    const allocations = database.native.prepare(
      "SELECT COUNT(*) AS c FROM payments_payment_allocations WHERE payment_id=?",
    ).get(collected.paymentId) as { c: number };
    expect(allocations.c).toBe(0);

    // Resume still surfaces the orphaned paid collection for operator reconciliation.
    const resume = new ResumeFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const pending = await resume.execute(SCOPE, auth(), { saleId });
    expect(pending.kind).toBe("FOUND");
    if (pending.kind === "FOUND") {
      expect(pending.paymentId).toBe(collected.paymentId);
      expect(pending.providerStatus).toBe("paid");
      expect(pending.status).toBe("CREATED");
    }
  });

  it("does not auto-POST recreate when persisted reference GET is uncertain", async () => {
    const { database, paymentStore, credentialStore } = await openFixture();
    const saleId = seedSale(database, randomUUID(), "12000.000000");
    let posts = 0;
    let failNextGet = false;
    const collections = new Map<string, ProviderCollection>();
    const transport: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth")) {
        return new Response(JSON.stringify({ token: "T" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/collections") && init?.method === "POST") {
        posts += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const row: ProviderCollection = {
          reference_code: String(body.reference_code),
          amount: String(body.amount),
          status: "ready",
          qr: "data:image/png;base64,QUJD",
        };
        collections.set(row.reference_code, row);
        failNextGet = true;
        return new Response(JSON.stringify({ status: "success", data: row }), {
          status: 201, headers: { "content-type": "application/json" },
        });
      }
      if (failNextGet) {
        failNextGet = false;
        return new Response("unavailable", { status: 503, headers: { "content-type": "application/json" } });
      }
      const reference = decodeURIComponent(url.split("/").pop() ?? "");
      const row = collections.get(reference);
      if (row === undefined) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({ status: "success", data: row }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };

    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, transport);
    const register = new RegisterFactusPayCollectionUseCase(paymentStore, client, () => NOW);
    const key = randomUUID();
    const request = {
      saleId,
      amount: "12000.000000",
      expirationSeconds: 900,
      idempotencyKey: key,
      correlationId: randomUUID(),
      causationId: null,
    };

    const first = await register.execute(SCOPE, SESSION, auth(), request);
    expect(first.kind).toBe("COLLECTED");
    expect(posts).toBe(1);

    const uncertain = await register.execute(SCOPE, SESSION, auth(), request);
    expect(uncertain.kind).toBe("REGISTERED_PROVIDER_FAILED");
    expect(posts).toBe(1);
  });
});
