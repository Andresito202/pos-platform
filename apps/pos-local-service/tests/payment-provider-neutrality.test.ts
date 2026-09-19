import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../src/cash/open-cash-shift-use-case.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { RegisterQrPaymentUseCase } from "../src/payments/register-qr-payment-use-case.js";
import { ConfirmProviderPaymentUseCase } from "../src/payments/confirm-provider-payment-use-case.js";
import type {
  PaymentProviderEvidence,
  PaymentProviderIntent,
  PaymentProviderIntentResult,
  PaymentProviderOutcome,
  PaymentProviderPort,
} from "../src/payments/payment-provider-port.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";

/**
 * Dos PSP distintos, un solo camino comercial.
 *
 * ## Qué prueba este archivo y qué no repite
 *
 * `payment.test.ts` ya cubre el cobro QR con **un** proveedor: registro
 * `PENDING`, confirmación con evidencia aprobada, rechazo de evidencia
 * `REJECTED`, `PROVIDER_MISMATCH` y la separación de identidades que
 * `MIGRATION_016` materializó. Nada de eso se repite aquí.
 *
 * Lo que no sostenía ninguna prueba es la afirmación arquitectónica que
 * justifica la existencia de `PaymentProviderPort`: **que dos
 * implementaciones distintas del puerto recorren el mismo flujo de
 * application sin que el núcleo sepa cuál es cuál.** Con un solo proveedor
 * en las pruebas, esa neutralidad era una intención, no un hecho: nada
 * impedía que una rama `if (provider === …)` apareciera y siguiera todo
 * verde.
 *
 * ## Por qué los dos proveedores no son «el mismo doble dos veces»
 *
 * `PSP_ALFA` y `PSP_BETA` difieren en todo lo que un PSP real difiere y el
 * contrato permite: código de proveedor, forma del identificador de
 * transacción, presencia de superficie de checkout, si el proveedor hace eco
 * de la referencia comercial o la reescribe, y el momento en que la
 * transacción adquiere identidad. Si el núcleo dependiera de cualquiera de
 * esos rasgos, uno de los dos fallaría.
 *
 * **No son mocks del dominio.** Implementan el puerto y nada más; la venta,
 * el pago, la imputación, la cobertura y el cierre los ejecuta el núcleo real
 * sobre SQLite real.
 *
 * ## La prueba estructural más fuerte de este archivo es lo que NO contiene
 *
 * Ni un import de `wompi/`, ni una cadena `"WOMPI"`, ni un tipo del adapter.
 * El flujo completo —registro, confirmación, cobertura, venta `COMPLETED`—
 * se recorre entero sin que el nombre del único proveedor real del
 * repositorio aparezca una sola vez.
 */

const TENANT = "018f0000-0000-7000-8000-0000000000b1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000b9";
const COMPANY = "018f0000-0000-7000-8000-0000000000b2";
const BRANCH = "018f0000-0000-7000-8000-0000000000b3";
const DEVICE = "018f0000-0000-7000-8000-0000000000b4";
const INSTALL = "018f0000-0000-7000-8000-0000000000b5";
const USER = "018f0000-0000-7000-8000-0000000000b6";
const SESSION = "018f0000-0000-7000-8000-0000000000b7";
const REGISTER = "018f0000-0000-7000-8000-00000000bb01";

const PAYABLE = "10000.000000";
const NOW = new Date("2026-09-06T10:00:00.000Z");

function scopeFor(tenantId: string): SyncScope {
  return { tenantId, companyId: COMPANY, branchId: BRANCH, deviceId: DEVICE, installationId: INSTALL };
}
const SCOPE = scopeFor(TENANT);

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

// ── Los dos proveedores ──────────────────────────────────────────────────────

/**
 * Un PSP con checkout web que hace eco de la referencia comercial y asigna la
 * identidad de la transacción **al crear el intento**.
 */
class AlfaProvider implements PaymentProviderPort {
  readonly code = "PSP_ALFA";
  private counter = 0;
  readonly assigned = new Map<string, string>();

  async createPaymentIntent(input: PaymentProviderIntent): Promise<PaymentProviderIntentResult> {
    this.counter += 1;
    this.assigned.set(input.merchantReference, `alfa-tx-${String(this.counter)}`);
    return {
      providerCode: this.code,
      merchantReference: input.merchantReference,
      status: "PENDING",
      checkout: { kind: "WEB_URL", url: `https://alfa.example/checkout/${input.merchantReference}` },
    };
  }

  async getPaymentStatus(input: { readonly providerTransactionId: string }): Promise<PaymentProviderOutcome> {
    const reference = [...this.assigned].find(([, tx]) => tx === input.providerTransactionId)?.[0];
    if (reference === undefined) return { kind: "UNKNOWN", reason: "PROVIDER_ERROR" };
    return {
      kind: "EVIDENCE",
      evidence: this.evidenceFor(reference, "APPROVED"),
    };
  }

  async normalizeNotification(): Promise<PaymentProviderOutcome> {
    return { kind: "UNKNOWN", reason: "MALFORMED_RESPONSE" };
  }

  evidenceFor(merchantReference: string, status: "PENDING" | "APPROVED" | "REJECTED"): PaymentProviderEvidence {
    return {
      providerCode: this.code,
      providerReference: merchantReference,
      providerTransactionId: this.assigned.get(merchantReference) ?? "alfa-tx-unknown",
      amount: PAYABLE,
      currencyCode: "COP",
      status,
      receivedAt: NOW.toISOString(),
    };
  }
}

/**
 * Un PSP sin checkout web, con identificadores de otra forma, que sólo
 * adquiere identidad de transacción **cuando el pagador actúa** — de modo que
 * el intento nace sin ella. La referencia comercial la devuelve tal cual,
 * porque el contrato exige el eco, pero todo lo demás difiere.
 */
class BetaProvider implements PaymentProviderPort {
  readonly code = "PSP_BETA";
  private readonly settled = new Map<string, string>();

  async createPaymentIntent(input: PaymentProviderIntent): Promise<PaymentProviderIntentResult> {
    return {
      providerCode: this.code,
      merchantReference: input.merchantReference,
      status: "PENDING",
      checkout: null,
    };
  }

  /** El pagador paga: sólo entonces existe la transacción. */
  payerSettles(merchantReference: string, transactionId: string): void {
    this.settled.set(merchantReference, transactionId);
  }

  async getPaymentStatus(input: { readonly providerTransactionId: string }): Promise<PaymentProviderOutcome> {
    const reference = [...this.settled].find(([, tx]) => tx === input.providerTransactionId)?.[0];
    if (reference === undefined) return { kind: "UNKNOWN", reason: "TIMEOUT" };
    return { kind: "EVIDENCE", evidence: this.evidenceFor(reference, "APPROVED") };
  }

  async normalizeNotification(): Promise<PaymentProviderOutcome> {
    return { kind: "UNKNOWN", reason: "NETWORK" };
  }

  evidenceFor(merchantReference: string, status: "PENDING" | "APPROVED" | "REJECTED"): PaymentProviderEvidence {
    return {
      providerCode: this.code,
      providerReference: merchantReference,
      providerTransactionId: this.settled.get(merchantReference) ?? "BETA/0000",
      amount: PAYABLE,
      currencyCode: "COP",
      status,
      receivedAt: NOW.toISOString(),
    };
  }
}

// ── Entorno real ─────────────────────────────────────────────────────────────

function auth(): StoredAuthorizationSnapshot {
  const claims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000bf",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-06T00:00:00.000Z",
    expires_at: "2026-09-07T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: [
        { code: "CASH_SHIFT_OPEN", status: "ACTIVE" as const },
        { code: "PAYMENTS_PAYMENT_REGISTER", status: "ACTIVE" as const },
        { code: "PAYMENTS_TRANSFER_REPORT", status: "ACTIVE" as const },
      ],
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

async function buildEnv(provider: PaymentProviderPort) {
  const dir = await mkdtemp(join(tmpdir(), "pos-provider-neutral-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);

  const sync = new DurableSyncStore(database);
  const cashStore = new SqliteCashShiftStore(database, sync, () => NOW);
  const masterStore = new SqliteMasterSnapshotStore(database, () => NOW);
  const paymentStore = new SqlitePaymentStore(
    database, sync, cashStore,
    new SqliteInventoryStore(database, sync, () => NOW),
    () => NOW,
  );

  return {
    database,
    paymentStore,
    openShift: new OpenCashShiftUseCase(masterStore, cashStore, () => NOW),
    // El mismo caso de uso, sin una sola rama por proveedor.
    registerQr: new RegisterQrPaymentUseCase(paymentStore, provider),
    confirmProvider: new ConfirmProviderPaymentUseCase(paymentStore),
  };
}

/** Caja activa en la proyección maestra, igual que en `payment.test.ts`. */
function seedRegister(db: LocalDatabase): void {
  const at = "2026-09-01T00:00:00.000Z";
  db.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(TENANT, COMPANY, BRANCH, at, JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "sig", at);

  db.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id, code, code_normalized, name,
      currency_code, status, created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,'CAJA-01','caja-01','Caja 01','COP','ACTIVE',?,NULL,1,1)`,
  ).run(REGISTER, TENANT, COMPANY, BRANCH, at);
}

function openShift(env: Awaited<ReturnType<typeof buildEnv>>): string {
  const result = env.openShift.execute(SCOPE, SESSION, auth(), {
    cashRegisterId: REGISTER, openingAmount: "0.000000",
    businessDate: "2026-09-06", timezoneId: "America/Bogota", utcOffsetMinutes: -300,
    idempotencyKey: "neutral:shift", correlationId: randomUUID(), causationId: null,
  });
  if (result.kind !== "OPENED") throw new Error(`expected OPENED, got ${result.kind}`);
  return result.shiftId;
}

/**
 * Prepara el mostrador y devuelve una venta lista para cobrar.
 *
 * La caja y el turno existen porque el contexto del cobro QR los exige —el
 * intent lleva la caja—, no porque el QR mueva efectivo: no lo mueve, y una
 * de las pruebas lo afirma contando `cash_movement`.
 */
async function counter(env: Awaited<ReturnType<typeof buildEnv>>): Promise<string> {
  seedRegister(env.database);
  const shiftId = openShift(env);
  return seedSale(env.database, shiftId);
}

/** La misma siembra que usa `payment.test.ts`, con el turno parametrizado. */
function seedSale(db: LocalDatabase, shiftId: string, tenantId = TENANT): string {
  const saleId = randomUUID();
  const at = NOW.toISOString();
  const zero = "0.000000";
  const operationId = randomUUID();
  const saleNumber = (db.native.prepare(
    "SELECT COALESCE(MAX(sale_number), 0) + 1 AS next FROM sales_sales WHERE tenant_id=? AND branch_id=?",
  ).get(tenantId, BRANCH) as { next: number }).next;

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
      ?,?,?,?,?,?,
      ?,?,'USER',?,
      'POS','READY_FOR_PAYMENT','2026-09-06','America/Bogota',-300,
      'A',?,'COP',
      ?,?,?,?,
      ?,?,
      'PRICING_PIPELINE_V1','SANDBOX_PRICE_V1',NULL,
      'TAX_POLICY_EXCLUDED_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1','{}','{}',
      ?,?,?,?,
      ?,NULL,1,?,
      NULL,NULL,NULL,NULL
    )`,
  ).run(
    saleId, tenantId, COMPANY, BRANCH, REGISTER, shiftId,
    DEVICE, INSTALL, USER,
    saleNumber,
    PAYABLE, zero, zero, PAYABLE, zero, PAYABLE,
    "c".repeat(64), operationId, `sale:${saleId}`, "b".repeat(64),
    randomUUID(), at,
  );
  return saleId;
}

function saleStatus(db: LocalDatabase, saleId: string): string {
  return (db.native.prepare("SELECT status FROM sales_sales WHERE id=?").get(saleId) as { status: string }).status;
}

function countRows(db: LocalDatabase, sql: string, ...params: readonly string[]): number {
  return (db.native.prepare(sql).get(...params) as { n: number }).n;
}

function allocations(db: LocalDatabase, saleId: string): number {
  return countRows(
    db,
    `SELECT COUNT(*) AS n FROM payments_payment_allocations
      WHERE collection_subject_type='SALE' AND collection_subject_id=?`,
    saleId,
  );
}

// ── A · El mismo flujo, dos proveedores ──────────────────────────────────────

const PROVIDERS = [
  { name: "PSP_ALFA (checkout web, identidad al crear el intento)", make: () => new AlfaProvider() },
  { name: "PSP_BETA (sin checkout, identidad al pagar)", make: () => new BetaProvider() },
] as const;

describe.each(PROVIDERS)("neutralidad de proveedor — $name", ({ make }) => {
  it("registro deja PENDING y la venta sin completar; la evidencia aprobada la completa", async () => {
    const provider = make();
    const env = await buildEnv(provider);
    const saleId = await counter(env);

    // 1 · Registro. Mismo caso de uso para los dos.
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: PAYABLE,
      idempotencyKey: "neutral:register", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error(`expected PENDING, got ${registered.kind}`);

    // La referencia comercial es el `paymentId`, nunca la clave de
    // idempotencia: es la separación de identidades, verificada en disco.
    expect(registered.providerReference).toBe(registered.paymentId);
    expect(registered.providerReference).not.toBe("neutral:register");

    // Un QR no cobra nada por existir.
    expect(saleStatus(env.database, saleId)).toBe("PAYMENT_IN_PROGRESS");
    expect(allocations(env.database, saleId)).toBe(0);
    const pending = env.database.native.prepare(
      "SELECT status, provider_code, provider_reference FROM payments_payments WHERE id=?",
    ).get(registered.paymentId) as { status: string; provider_code: string; provider_reference: string };
    expect(pending.status).toBe("PENDING");
    expect(pending.provider_code).toBe(provider.code);
    expect(pending.provider_reference).toBe(registered.paymentId);

    // 2 · El pagador paga. `PSP_BETA` sólo ahora adquiere identidad.
    if (provider instanceof BetaProvider) {
      provider.payerSettles(registered.providerReference, "BETA/77-XZ");
    }

    // 3 · Confirmación con evidencia del proveedor.
    const confirmed = env.confirmProvider.execute(SCOPE, {
      paymentId: registered.paymentId,
      expectedVersion: 1,
      evidence: provider.evidenceFor(registered.providerReference, "APPROVED"),
      idempotencyKey: "neutral:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(confirmed.kind).toBe("CONFIRMED");

    // 4 · El núcleo hizo exactamente lo mismo con los dos.
    expect(saleStatus(env.database, saleId)).toBe("COMPLETED");
    expect(allocations(env.database, saleId)).toBe(1);

    const attempt = env.database.native.prepare(
      `SELECT status, provider_code, provider_reference_type, provider_reference, provider_transaction_id
         FROM payments_payment_attempts WHERE payment_id=?`,
    ).get(registered.paymentId) as {
      status: string; provider_code: string; provider_reference_type: string;
      provider_reference: string; provider_transaction_id: string;
    };
    expect(attempt.status).toBe("CONFIRMED");
    expect(attempt.provider_code).toBe(provider.code);
    // Las dos identidades conviven: la comercial que abrió el cobro y la que
    // trajo el proveedor. Confirmar no sustituye la primera.
    expect(attempt.provider_reference_type).toBe("PROVIDER_INTENT");
    expect(attempt.provider_reference).toBe(registered.paymentId);
    expect(attempt.provider_transaction_id).not.toBe(attempt.provider_reference);
    expect(attempt.provider_transaction_id.length).toBeGreaterThan(0);
  });

  it("una consulta que no puede responderse es UNKNOWN, nunca un veredicto", async () => {
    const provider = make();
    const env = await buildEnv(provider);
    const saleId = await counter(env);
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: PAYABLE,
      idempotencyKey: "neutral:unknown", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    // Ninguno de los dos conoce esta transacción: el contrato obliga a
    // responder con la variante sin evidencia.
    const outcome = await provider.getPaymentStatus({ providerTransactionId: "no-existe" });
    expect(outcome.kind).toBe("UNKNOWN");
    // La variante hace imposible leer evidencia de una respuesta que no la
    // tiene: no hay `status` que confundir con `REJECTED`.
    expect(Object.hasOwn(outcome, "evidence")).toBe(false);

    // Y nada cambió en disco: la incertidumbre no mueve dinero.
    expect(saleStatus(env.database, saleId)).toBe("PAYMENT_IN_PROGRESS");
    expect(allocations(env.database, saleId)).toBe(0);
    expect((env.database.native.prepare(
      "SELECT status FROM payments_payments WHERE id=?",
    ).get(registered.paymentId) as { status: string }).status).toBe("PENDING");
  });

  it("repetir el registro y repetir la confirmación no duplican nada", async () => {
    const provider = make();
    const env = await buildEnv(provider);
    const saleId = await counter(env);

    const first = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: PAYABLE,
      idempotencyKey: "neutral:idem", correlationId: randomUUID(), causationId: null,
    });
    if (first.kind !== "PENDING") throw new Error("expected PENDING");

    const replay = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: PAYABLE,
      idempotencyKey: "neutral:idem", correlationId: randomUUID(), causationId: null,
    });
    expect(replay.kind).toBe("IDEMPOTENT");
    expect(countRows(env.database, "SELECT COUNT(*) AS n FROM payments_payments WHERE tenant_id=?", TENANT)).toBe(1);

    if (provider instanceof BetaProvider) provider.payerSettles(first.providerReference, "BETA/IDEM-1");
    const confirmRequest = {
      paymentId: first.paymentId, expectedVersion: 1,
      evidence: provider.evidenceFor(first.providerReference, "APPROVED"),
      idempotencyKey: "neutral:idem:confirm", correlationId: randomUUID(), causationId: null,
    };
    expect(env.confirmProvider.execute(SCOPE, confirmRequest).kind).toBe("CONFIRMED");
    expect(env.confirmProvider.execute(SCOPE, confirmRequest).kind).toBe("IDEMPOTENT");

    // Ni segunda imputación ni venta completada dos veces. Y el QR no toca
    // caja: el único movimiento del turno es su apertura, de modo que contar
    // `CASH_SALE` en cero dice algo —que el cobro por proveedor no posteó
    // efectivo— en vez de contar filas que la apertura ya explica.
    expect(allocations(env.database, saleId)).toBe(1);
    expect(countRows(
      env.database,
      "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND movement_type='CASH_SALE'",
      TENANT,
    )).toBe(0);
    expect(countRows(
      env.database,
      "SELECT COUNT(*) AS n FROM cash_movement WHERE tenant_id=? AND movement_type='OPENING_FLOAT'",
      TENANT,
    )).toBe(1);
    expect(saleStatus(env.database, saleId)).toBe("COMPLETED");
  });
});

// ── B · Lo que sólo se ve con dos proveedores a la vez ───────────────────────

describe("dos proveedores conviviendo — fronteras que un solo PSP no puede probar", () => {
  it("la evidencia del proveedor B no confirma un cobro abierto con el proveedor A", async () => {
    const alfa = new AlfaProvider();
    const beta = new BetaProvider();
    const env = await buildEnv(alfa);
    const saleId = await counter(env);

    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: PAYABLE,
      idempotencyKey: "cross:mismatch", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    beta.payerSettles(registered.providerReference, "BETA/INTRUSO");
    const intruder = env.confirmProvider.execute(SCOPE, {
      paymentId: registered.paymentId, expectedVersion: 1,
      // Evidencia íntegra y bien formada — pero de otro proveedor.
      evidence: beta.evidenceFor(registered.providerReference, "APPROVED"),
      idempotencyKey: "cross:mismatch:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(intruder.kind).toBe("PROVIDER_MISMATCH");
    expect(saleStatus(env.database, saleId)).toBe("PAYMENT_IN_PROGRESS");
    expect(allocations(env.database, saleId)).toBe(0);
  });

  it("el mismo identificador de transacción bajo dos proveedores son dos hechos distintos", async () => {
    // Nada obliga a dos PSP a no repetir un identificador: son espacios de
    // nombres independientes. El índice único lo es por
    // `(tenant, provider_code, provider_transaction_id)`, así que la
    // coincidencia no puede tratarse como conflicto.
    const alfa = new AlfaProvider();
    const envA = await buildEnv(alfa);
    const saleA = await counter(envA);
    const a = await envA.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId: saleA, amount: PAYABLE,
      idempotencyKey: "ns:a", correlationId: randomUUID(), causationId: null,
    });
    if (a.kind !== "PENDING") throw new Error("expected PENDING");

    const shared = "TX-COMPARTIDO";
    const confirmA = envA.confirmProvider.execute(SCOPE, {
      paymentId: a.paymentId, expectedVersion: 1,
      evidence: { ...alfa.evidenceFor(a.providerReference, "APPROVED"), providerTransactionId: shared },
      idempotencyKey: "ns:a:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(confirmA.kind).toBe("CONFIRMED");

    // Segundo comercio, segundo PSP, mismo identificador: debe confirmar.
    const beta = new BetaProvider();
    const envB = await buildEnv(beta);
    const saleB = await counter(envB);
    const b = await envB.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId: saleB, amount: PAYABLE,
      idempotencyKey: "ns:b", correlationId: randomUUID(), causationId: null,
    });
    if (b.kind !== "PENDING") throw new Error("expected PENDING");

    const confirmB = envB.confirmProvider.execute(SCOPE, {
      paymentId: b.paymentId, expectedVersion: 1,
      evidence: { ...beta.evidenceFor(b.providerReference, "APPROVED"), providerTransactionId: shared },
      idempotencyKey: "ns:b:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(confirmB.kind).toBe("CONFIRMED");
    expect(saleStatus(envB.database, saleB)).toBe("COMPLETED");
  });

  it("un cobro de otro comercio no se alcanza con el mismo identificador", async () => {
    const alfa = new AlfaProvider();
    const env = await buildEnv(alfa);
    const saleId = await counter(env);
    const registered = await env.registerQr.execute(SCOPE, SESSION, auth(), {
      saleId, amount: PAYABLE,
      idempotencyKey: "tenant:iso", correlationId: randomUUID(), causationId: null,
    });
    if (registered.kind !== "PENDING") throw new Error("expected PENDING");

    // Evidencia perfecta, pero presentada en el contexto de otro tenant. El
    // tenant no viaja en la evidencia: lo aporta el scope autorizado, y el
    // cobro sencillamente no existe ahí.
    const foreign = env.confirmProvider.execute(scopeFor(OTHER_TENANT), {
      paymentId: registered.paymentId, expectedVersion: 1,
      evidence: alfa.evidenceFor(registered.providerReference, "APPROVED"),
      idempotencyKey: "tenant:iso:confirm", correlationId: randomUUID(), causationId: null,
    });
    expect(foreign.kind).toBe("PAYMENT_NOT_FOUND");
    expect(saleStatus(env.database, saleId)).toBe("PAYMENT_IN_PROGRESS");
    expect(allocations(env.database, saleId)).toBe(0);
  });
});
