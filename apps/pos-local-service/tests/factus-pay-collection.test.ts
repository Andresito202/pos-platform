import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
import { RegisterFactusPayCollectionUseCase } from "../src/payments/register-factus-pay-collection-use-case.js";
import { VerifyFactusPayCollectionUseCase } from "../src/payments/verify-factus-pay-collection-use-case.js";
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
const NOW = new Date("2026-09-06T10:00:00.000Z");
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH, deviceId: DEVICE, installationId: INSTALL,
};

const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch {}
  }
});

function auth(): StoredAuthorizationSnapshot {
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
        permissions: [{ code: "PAYMENTS_PAYMENT_REGISTER", status: "ACTIVE" }],
      }],
    } as AuthorizationSnapshotClaims,
    signature: "stub",
    activatedAt: NOW.toISOString(),
  };
}

function seedSale(db: LocalDatabase, saleId = randomUUID(), payable = "150000.000000"): string {
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
      'POS','READY_FOR_PAYMENT', '2026-09-06','America/Bogota',-300,
      'A',1,'COP',
      ?,?,?,?,
      ?,?,
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,
      'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1','{}','{}',
      ?,?,?,?,
      ?,NULL,1,?,
      NULL,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH,
    DEVICE, INSTALL, USER,
    payable, "0.000000", "0.000000", payable, "0.000000", payable,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64),
    randomUUID(), at,
  );
  return saleId;
}

describe("Factus Pay Caja collections", () => {
  it("registers QR payment, creates provider collection, verifies paid and confirms", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factus-pay-collection-"));
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);
    const sync = new DurableSyncStore(database);
    const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
    const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
    const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, () => NOW);
    const saleId = seedSale(database);

    const secrets = new EncryptedFileSecretStore(
      dir,
      new InsecureDerivedKeyProvider(dir),
      `factus-pay-test:${INSTALL}:${DEVICE}:${COMPANY}`,
    );
    const credentialStore = new FactusPayCredentialStore(secrets, COMPANY);
    credentialStore.deposit({ environment: "SANDBOX", email: "t@invalid", password: "pw" });

    const collections = new Map<string, Record<string, unknown>>();
    const transport: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth")) {
        return new Response(JSON.stringify({ token: "TOKEN" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/collections") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        collections.set(String(body.reference_code), {
          reference_code: body.reference_code,
          amount: body.amount,
          status: "ready",
          qr: "data:image/png;base64,QUJD",
        });
        return new Response(JSON.stringify({ status: "success", data: collections.get(String(body.reference_code)) }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      const reference = decodeURIComponent(url.split("/").pop() ?? "");
      const row = collections.get(reference) ?? { reference_code: reference, amount: "150000", status: "paid" };
      return new Response(JSON.stringify({ status: "success", data: row }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, transport);
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
    if (collected.kind !== "COLLECTED") return;
    expect(collected.qr).toContain("data:image/png");

    const paymentRow = database.native.prepare(
      "SELECT payment_method, status, provider_code FROM payments_payments WHERE id=?",
    ).get(collected.paymentId) as { payment_method: string; status: string; provider_code: string };
    expect(paymentRow).toMatchObject({ payment_method: "QR", status: "CREATED", provider_code: "FACTUS_PAY" });

    collections.set(collected.referenceCode, {
      reference_code: collected.referenceCode,
      amount: "150000",
      status: "paid",
    });

    const read = paymentStore.get(SCOPE, collected.paymentId);
    expect(read.kind).toBe("FOUND");
    if (read.kind !== "FOUND") return;

    const confirmed = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(confirmed.kind).toBe("CONFIRMED");

    await rm(dir, { recursive: true, force: true });
  });

  it("rejects verify when provider collection is not paid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factus-pay-collection-"));
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);
    const sync = new DurableSyncStore(database);
    const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
    const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
    const paymentStore = new SqlitePaymentStore(database, sync, cashStore, inventoryStore, () => NOW);
    const saleId = seedSale(database, randomUUID(), "2000.000000");

    const secrets = new EncryptedFileSecretStore(
      dir,
      new InsecureDerivedKeyProvider(dir),
      `factus-pay-test:${INSTALL}:${DEVICE}:${COMPANY}`,
    );
    const credentialStore = new FactusPayCredentialStore(secrets, COMPANY);
    credentialStore.deposit({ environment: "SANDBOX", email: "t@invalid", password: "pw" });

    const transport: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth")) {
        return new Response(JSON.stringify({ token: "TOKEN" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          status: "success",
          data: { reference_code: body.reference_code, amount: body.amount, status: "ready", qr: "data:image/png;base64,X" },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      const reference = decodeURIComponent(url.split("/").pop() ?? "");
      return new Response(JSON.stringify({
        status: "success",
        data: { reference_code: reference, amount: "2000", status: "ready" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new FactusPayClient(credentialStore, "SANDBOX", () => NOW, transport);
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
    if (collected.kind !== "COLLECTED") return;
    const read = paymentStore.get(SCOPE, collected.paymentId);
    if (read.kind !== "FOUND") return;

    const result = await verify.execute(SCOPE, SESSION, auth(), {
      paymentId: collected.paymentId,
      expectedVersion: read.payment.version,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    expect(result.kind).toBe("FACTUS_PAY_NOT_PAID");

    await rm(dir, { recursive: true, force: true });
  });
});