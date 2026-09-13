import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  LocalChannelAuthenticator,
  LocalChannelClient,
  localChannelEndpoint,
} from "@pos-platform/local-channel";
import {
  unsignedAuthorizationSnapshotBytes,
  unsignedSessionAssertionBytes,
  LocalChannelServer,
  type TrustedSigningKey,
} from "../src/index.js";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { CommercialRequestHandler } from "../src/commercial/commercial-request-handler.js";
import { SqliteReceiptStore } from "../src/receipts/sqlite-receipt-store.js";
import type { ServiceConfig } from "../src/config.js";
import type { AuthorizationSnapshotClaims, SessionAssertionClaims } from "@pos-platform/contracts";

/**
 * La vertical comercial **completa**, atravesando el socket real hasta SQLite.
 *
 * Ésta es la prueba que faltaba, y su ausencia dejaba un seam sin vigilar:
 *
 * - `channel-commercial-transport.test.ts` levanta un socket real, pero detrás
 *   pone un handler de utilería que devuelve resultados enlatados: prueba el
 *   **transporte**, no la capacidad.
 * - `commercial-ipc.test.ts` ejerce el handler y SQLite de verdad, pero llama a
 *   `handler.handle(...)` **sin cruzar el socket**: prueba la **capacidad**, no
 *   que un llamador externo la alcance.
 *
 * Ninguna las juntaba. Es la misma forma del defecto X-2 —que sobrevivió
 * justamente porque ninguna prueba pasaba por el socket— un nivel más arriba.
 *
 * Aquí se juntan: `LocalChannelServer` + `LocalChannelClient` reales sobre
 * socket, con el `CommercialRequestHandler` de producción y una base SQLite
 * real detrás, puenteados **igual que lo hace `local-channel-component.ts`**.
 *
 * Corre sobre socket POSIX —`localChannelEndpoint` lo admite con directorio de
 * prueba—, así que **se ejecuta en Linux**. El named pipe y su DACL tienen
 * cobertura propia en `channel.test.ts`, que CI ejecuta en `windows-2022`; lo
 * que sigue siendo `REQUIRES_LOCAL_VERIFICATION` es **la identidad del proceso
 * cliente**.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO DE ESTE ARCHIVO ES EXCLUSIVO DE TEST: se
 * genera en memoria, no se persiste y no sustituye a un trust anchor real.
 */

const testOnlyKeyPair = generateKeyPairSync("ed25519");

const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
const SSA_SESSION = "018f0000-0000-7000-8000-0000000000b0";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const SESSION_KEY_ID = "SESSION_KEY_1";
const BARCODE = "7701234567890";

/** El alcance con el que el servicio lee: el mismo que usa la sesión activa. */
const SCOPE = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALLATION,
};

const NOW = new Date("2026-09-03T12:00:00.000Z");
const clock = { now: () => NOW };

const PERMISSIONS = [
  "CASH_SHIFT_OPEN",
  "CATALOG_PRODUCT_REGISTER",
  "CATALOG_PRODUCT_READ",
  "INVENTORY_STOCK_RECEIVE",
  "INVENTORY_STOCK_READ",
  "SALES_SALE_CREATE",
  "PAYMENTS_PAYMENT_REGISTER",
];

const directories: string[] = [];
const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-vertical-"));
  directories.push(value);
  return value;
}

// ── Material de prueba ───────────────────────────────────────────────────────

function sessionClaims(): SessionAssertionClaims {
  return {
    session_id: SSA_SESSION,
    user_id: USER,
    tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    issued_at: "2026-09-03T00:00:00.000Z",
    offline_valid_until: "2026-09-04T00:00:00.000Z",
    sequence: 1,
    key_id: SESSION_KEY_ID,
  } as SessionAssertionClaims;
}

function signSession(claims: SessionAssertionClaims) {
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionBytes(claims), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

function authorizationClaims(): AuthorizationSnapshotClaims {
  return {
    snapshot_id: "018f0000-0000-7000-8000-0000000000c0",
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-03T00:00:00.000Z",
    expires_at: "2026-09-04T00:00:00.000Z",
    assignments: [
      {
        tenant_id: TENANT,
        company_id: COMPANY,
        branch_id: BRANCH,
        status: "ACTIVE",
        valid_from: "2026-09-01T00:00:00.000Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: PERMISSIONS.map((code) => ({ code, status: "ACTIVE" as const })),
      },
    ],
    key_id: "AUTHZ_KEY_1",
  } as AuthorizationSnapshotClaims;
}

function signAuthorization(claims: AuthorizationSnapshotClaims) {
  return {
    claims,
    signature: sign(null, unsignedAuthorizationSnapshotBytes(claims), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

function config(): ServiceConfig {
  return {
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    device_id: DEVICE,
    installation_id: INSTALLATION,
    protocol_min: "1.0.0",
    protocol_max: "1.0.0",
  } as ServiceConfig;
}

/** Caja activa en la proyección maestra, igual que en `commercial-ipc.test.ts`. */
function seedRegister(database: LocalDatabase): void {
  const at = "2026-09-01T00:00:00.000Z";
  database.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(TENANT, COMPANY, BRANCH, at, JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "stub-sig", at);

  database.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id, code, code_normalized, name,
      currency_code, status, created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,'CAJA-01','caja-01','Caja 01','COP','ACTIVE',?,NULL,1,1)`,
  ).run(REGISTER, TENANT, COMPANY, BRANCH, at);
}

// ── Sobres del canal ─────────────────────────────────────────────────────────

const BASE = { protocol_version: "1.0.0", payload_schema_version: "1.0.0" } as const;

function handshakeRequest() {
  return {
    ...BASE,
    message_type: "runtime.handshake" as const,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload: {
      desktop_version: "1.0.0",
      service_version: "1.0.0",
      protocol_min: "1.0.0",
      protocol_max: "1.0.0",
      installation_id: INSTALLATION,
      device_id: DEVICE,
      schema_version: "5",
      service_state: "READY",
    },
  };
}

/** Operación mutante: exige `operation_id` e `idempotency_key`. */
function mutating(messageType: string, payload: unknown, idempotencyKey: string) {
  return {
    ...BASE,
    message_type: messageType,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: idempotencyKey,
    payload,
  };
}

/** Operación de sólo lectura: sin `operation_id`. */
function reading(messageType: string, payload: unknown) {
  return {
    ...BASE,
    message_type: messageType,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload,
  };
}

interface ChannelResponse {
  readonly status: string;
  readonly result_code: string;
  readonly result: Record<string, unknown>;
}

/**
 * Levanta el servicio comercial real detrás de un `LocalChannelServer` real y
 * entrega un `LocalChannelClient` real. El puente entre servidor y handler es
 * el mismo que usa `local-channel-component.ts` en producción: el servidor
 * responde `runtime.handshake` y delega todo lo demás en el handler, pasándole
 * el `connectionId` que él mismo asignó.
 */
async function withRealChannel(
  run: (send: (request: unknown) => Promise<ChannelResponse>, database: LocalDatabase) => Promise<void>,
): Promise<void> {
  const dir = await directory();
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);

  const keys = new Map<string, TrustedSigningKey>([
    [SESSION_KEY_ID, { key: createPublicKey(testOnlyKeyPair.privateKey), status: "ACTIVE" }],
  ]);

  const commercial = new CommercialComponent(
    config(),
    { database } as never,
    { store: new DurableSyncStore(database) } as never,
    keys,
    () => NOW,
  );
  await commercial.start();
  const handler = new CommercialRequestHandler(config(), commercial);

  const endpoint = localChannelEndpoint(INSTALLATION, process.platform, dir);
  const secret = randomBytes(32);

  const server = new LocalChannelServer(
    endpoint,
    new LocalChannelAuthenticator(secret, clock),
    async (request, _signal, context) => {
      const envelope = request as { message_type: string; request_id: string; correlation_id: string };
      if (envelope.message_type === "runtime.handshake") {
        return {
          protocol_version: "1.0.0",
          request_id: envelope.request_id,
          correlation_id: envelope.correlation_id,
          operation_id: null,
          status: "SUCCEEDED",
          result_code: "COMPATIBLE",
          result_schema_version: "1.0.0",
          error: null,
          server_time: NOW.toISOString(),
          result: { status: "COMPATIBLE", negotiated_protocol_version: "1.0.0" },
        };
      }
      // El servidor ya validó el sobre contra `IpcRequestSchema`, y el
      // handshake quedó atendido arriba: lo que llega aquí es comercial.
      return await handler.handle(request as Parameters<typeof handler.handle>[0], context.connectionId);
    },
    { min: "1.0.0", max: "1.0.0" },
    undefined,
    undefined,
    undefined,
    (connectionId) => { commercial.bindings.release(connectionId); },
  );

  const client = new LocalChannelClient(
    endpoint,
    new LocalChannelAuthenticator(secret, clock),
    { min: "1.0.0", max: "1.0.0" },
  );

  try {
    await server.start();
    await client.connect(handshakeRequest());
    await run(
      async (request) => await client.request(request) as ChannelResponse,
      database,
    );
  } finally {
    await client.close();
    await server.stop();
    await commercial.stop();
    secret.fill(0);
  }
}

describe("la vertical comercial atraviesa el socket real hasta SQLite", () => {
  it("turno → producto → existencia → venta → cobro → COMPLETED, todo por el canal", async () => {
    await withRealChannel(async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);

      // 1 · El cajero se identifica: la conexión queda vinculada a su sesión.
      const activated = await send(reading("session.activate", {
        session_assertion: signSession(sessionClaims()),
      }));
      expect(activated.status).toBe("SUCCEEDED");

      // 2 · Abre la caja.
      const shift = await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "0.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "vertical:shift:1"));
      expect(shift.result["outcome"]).toBe("OPENED");

      // 3 · Da de alta el producto que va a vender.
      const product = await send(mutating("catalog.product.register", {
        code: "CAFE-001",
        name: "Café Americano 500 g",
        stock_controlled: true,
        presentation_name: "Bolsa 500 g",
        unit_code: "UND",
        unit_precision: 0,
        barcode: BARCODE,
        price_amount: "18000.000000",
        currency_code: "COP",
      }, "vertical:catalog:1"));
      expect(product.result["outcome"]).toBe("REGISTERED");
      const presentationId = product.result["presentation_id"] as string;

      // 4 · Recibe existencia.
      const received = await send(mutating("inventory.stock.receive", {
        presentation_id: presentationId,
        movement_type: "PURCHASE_RECEIPT",
        quantity: "12.000000",
        reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-03",
      }, "vertical:inventory:1"));
      expect(received.result["quantity_after"]).toBe("12.000000");

      // 5 · Escanea el código de barras, como haría en el mostrador.
      const found = await send(reading("catalog.item.find", { barcode: BARCODE }));
      expect(found.result["presentation_id"]).toBe(presentationId);
      const productId = found.result["product_id"] as string;

      // 6 · Crea la venta nombrando **la caja**, nunca el turno (`DEC-012` §25.2).
      const sale = await send(mutating("sale.create", {
        cash_register_id: REGISTER,
        channel: "POS",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
        document_series: "A",
        currency_code: "COP",
        lines: [{ product_id: productId, presentation_id: presentationId, quantity: "2.000000" }],
      }, "vertical:sale:1"));
      expect(sale.result["outcome"]).toBe("CREATED");
      const saleId = sale.result["sale_id"] as string;
      const payable = sale.result["payable_amount"] as string;

      // 7 · Cobra en efectivo el importe que emitió la capa confiable.
      const payment = await send(mutating("payment.register.cash", {
        sale_id: saleId,
        amount: payable,
        tendered_amount: null,
      }, "vertical:payment:1"));

      // La venta queda completada, y ése es el único disparador del cha-ching.
      expect(payment.result["outcome"]).toBe("CONFIRMED");
      expect(payment.result["sale_completed"]).toBe(true);

      // 8 · Lo persistido: la venta lleva caja y turno, y está COMPLETED.
      const persisted = database.native.prepare(
        "SELECT status, cash_register_id, cash_shift_id FROM sales_sales WHERE id=?",
      ).get(saleId) as { status: string; cash_register_id: string | null; cash_shift_id: string | null };
      expect(persisted.status).toBe("COMPLETED");
      expect(persisted.cash_register_id).toBe(REGISTER);
      expect(persisted.cash_shift_id).not.toBeNull();

      // 9 · La existencia bajó por la venta: 12 − 2 = 10.
      const stock = await send(reading("inventory.stock.get", { presentation_id: presentationId }));
      expect(stock.result["outcome"]).toBe("FOUND");
      expect(stock.result["quantity_on_hand"]).toBe("10.000000");
    });
  }, 30_000);

  it("un cobro parcial no completa la venta, y por tanto no suena", async () => {
    await withRealChannel(async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);

      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "0.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "parcial:shift:1"));

      const product = await send(mutating("catalog.product.register", {
        code: "CAFE-002",
        name: "Café Americano 500 g",
        stock_controlled: false,
        presentation_name: "Bolsa 500 g",
        unit_code: "UND",
        unit_precision: 0,
        barcode: "7709999999999",
        price_amount: "18000.000000",
        currency_code: "COP",
      }, "parcial:catalog:1"));
      const presentationId = product.result["presentation_id"] as string;
      const found = await send(reading("catalog.item.find", { barcode: "7709999999999" }));

      const sale = await send(mutating("sale.create", {
        cash_register_id: REGISTER,
        channel: "POS",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
        document_series: "A",
        currency_code: "COP",
        lines: [{
          product_id: found.result["product_id"] as string,
          presentation_id: presentationId,
          quantity: "1.000000",
        }],
      }, "parcial:sale:1"));
      const saleId = sale.result["sale_id"] as string;

      // Se entrega menos de lo que la venta exige.
      const partial = await send(mutating("payment.register.cash", {
        sale_id: saleId,
        amount: "1000.000000",
        tendered_amount: null,
      }, "parcial:payment:1"));

      expect(partial.result["sale_completed"]).toBe(false);

      const persisted = database.native.prepare(
        "SELECT status FROM sales_sales WHERE id=?",
      ).get(saleId) as { status: string };
      expect(persisted.status).not.toBe("COMPLETED");
    });
  }, 30_000);
});

/**
 * Deja el mostrador listo: sesión vinculada, turno abierto, producto en catálogo
 * y doce unidades de existencia. Todo por el canal real.
 */
async function prepareCounter(
  send: (request: unknown) => Promise<ChannelResponse>,
  database: LocalDatabase,
  suffix: string,
): Promise<{ presentationId: string; productId: string }> {
  new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
    signAuthorization(authorizationClaims()),
    { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
  );
  seedRegister(database);

  await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
  await send(mutating("cash.shift.open", {
    cash_register_id: REGISTER,
    opening_amount: "0.000000",
    business_date: "2026-09-03",
    timezone_id: "America/Bogota",
    utc_offset_minutes: -300,
  }, `${suffix}:shift`));

  const product = await send(mutating("catalog.product.register", {
    code: `CAFE-${suffix}`,
    name: "Café Americano 500 g",
    stock_controlled: true,
    presentation_name: "Bolsa 500 g",
    unit_code: "UND",
    unit_precision: 0,
    barcode: BARCODE,
    price_amount: "18000.000000",
    currency_code: "COP",
  }, `${suffix}:catalog`));
  const presentationId = product.result["presentation_id"] as string;

  await send(mutating("inventory.stock.receive", {
    presentation_id: presentationId,
    movement_type: "PURCHASE_RECEIPT",
    quantity: "12.000000",
    reason_code: "SUPPLIER_DELIVERY",
    business_date: "2026-09-03",
  }, `${suffix}:inventory`));

  const found = await send(reading("catalog.item.find", { barcode: BARCODE }));
  return { presentationId, productId: found.result["product_id"] as string };
}

/** Crea una venta de `units` unidades del producto preparado. */
async function createSale(
  send: (request: unknown) => Promise<ChannelResponse>,
  ids: { presentationId: string; productId: string },
  units: string,
  key: string,
): Promise<{ saleId: string; payable: string }> {
  const sale = await send(mutating("sale.create", {
    cash_register_id: REGISTER,
    channel: "POS",
    business_date: "2026-09-03",
    timezone_id: "America/Bogota",
    utc_offset_minutes: -300,
    document_series: "A",
    currency_code: "COP",
    lines: [{ product_id: ids.productId, presentation_id: ids.presentationId, quantity: units }],
  }, key));
  return {
    saleId: sale.result["sale_id"] as string,
    payable: sale.result["payable_amount"] as string,
  };
}

function stockOf(database: LocalDatabase, presentationId: string): string {
  const row = database.native.prepare(
    "SELECT quantity_on_hand FROM inventory_stock WHERE presentation_id=?",
  ).get(presentationId) as { quantity_on_hand: string } | undefined;
  return row?.quantity_on_hand ?? "(sin fila)";
}

function countOf(database: LocalDatabase, sql: string, ...params: unknown[]): number {
  return (database.native.prepare(sql).get(...params) as { n: number }).n;
}

/**
 * Los pagos no llevan `sale_id`: cuelgan de `payments_payment_groups`, y la
 * venta se nombra en `collection_subject_id`. Se alcanzan por la imputación,
 * que es donde el esquema une pago y venta.
 */
function paymentsOf(database: LocalDatabase, saleId: string): number {
  return countOf(
    database,
    `SELECT COUNT(DISTINCT payment_id) n FROM payments_payment_allocations
      WHERE collection_subject_type='SALE' AND collection_subject_id=?`,
    saleId,
  );
}

function allocationsOf(database: LocalDatabase, saleId: string): number {
  return countOf(
    database,
    `SELECT COUNT(*) n FROM payments_payment_allocations
      WHERE collection_subject_type='SALE' AND collection_subject_id=?`,
    saleId,
  );
}

describe("la vertical resiste el uso real: ventas seguidas, reintentos y saldos", () => {
  it("dos ventas consecutivas no se contaminan y el inventario baja una vez por venta", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "dos");

      const saleA = await createSale(send, ids, "2.000000", "dos:saleA");
      const payA = await send(mutating("payment.register.cash", {
        sale_id: saleA.saleId, amount: saleA.payable, tendered_amount: null,
      }, "dos:payA"));
      expect(payA.result["sale_completed"]).toBe(true);
      expect(stockOf(database, ids.presentationId)).toBe("10.000000");

      const saleB = await createSale(send, ids, "3.000000", "dos:saleB");
      // Venta independiente: identificador propio e importe propio.
      expect(saleB.saleId).not.toBe(saleA.saleId);
      expect(saleB.payable).not.toBe(saleA.payable);

      const payB = await send(mutating("payment.register.cash", {
        sale_id: saleB.saleId, amount: saleB.payable, tendered_amount: null,
      }, "dos:payB"));
      expect(payB.result["sale_completed"]).toBe(true);

      // 12 − 2 − 3. Si alguna venta descontara dos veces, aquí saldría 7 o menos.
      expect(stockOf(database, ids.presentationId)).toBe("7.000000");

      const completed = database.native.prepare(
        "SELECT id, status FROM sales_sales WHERE id IN (?,?) ORDER BY id",
      ).all(saleA.saleId, saleB.saleId) as Array<{ id: string; status: string }>;
      expect(completed).toHaveLength(2);
      expect(completed.every((row) => row.status === "COMPLETED")).toBe(true);
    });
  }, 30_000);

  it("reintentar el mismo cobro es IDEMPOTENT y no descuenta dos veces", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "retry");
      const sale = await createSale(send, ids, "2.000000", "retry:sale");

      // El mecanismo de idempotencia del contrato es `idempotency_key`. El
      // reintento es una trama nueva —nonce y secuencia distintos, de modo que
      // el anti-replay no la confunde— con la misma clave en el sobre.
      const payload = { sale_id: sale.saleId, amount: sale.payable, tendered_amount: null };
      const first = await send(mutating("payment.register.cash", payload, "retry:pay"));
      expect(first.result["outcome"]).toBe("CONFIRMED");
      expect(first.result["sale_completed"]).toBe(true);
      expect(stockOf(database, ids.presentationId)).toBe("10.000000");

      const retry = await send(mutating("payment.register.cash", payload, "retry:pay"));
      expect(retry.result["outcome"]).toBe("IDEMPOTENT");
      // Mismo pago, no uno nuevo.
      expect(retry.result["payment_id"]).toBe(first.result["payment_id"]);

      // Nada se duplicó: ni el pago, ni su imputación, ni el descuento.
      expect(paymentsOf(database, sale.saleId)).toBe(1);
      expect(allocationsOf(database, sale.saleId)).toBe(1);
      expect(stockOf(database, ids.presentationId)).toBe("10.000000");
    });
  }, 30_000);

  it("un cobro parcial no completa ni descuenta; el saldo restante sí", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "parcial");
      const sale = await createSale(send, ids, "2.000000", "parcial:sale");

      const partial = await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: "10000.000000", tendered_amount: null,
      }, "parcial:pay1"));

      // El pago se confirma —el dinero entró— pero la venta no se completa.
      expect(partial.result["outcome"]).toBe("CONFIRMED");
      expect(partial.result["sale_completed"]).toBe(false);
      expect(
        (database.native.prepare("SELECT status FROM sales_sales WHERE id=?")
          .get(sale.saleId) as { status: string }).status,
      ).not.toBe("COMPLETED");
      // La mercancía no sale del almacén hasta que la venta se completa.
      expect(stockOf(database, ids.presentationId)).toBe("12.000000");

      const rest = (BigInt(sale.payable.replace(".", "")) - 10_000_000_000n).toString();
      const remainder = `${rest.slice(0, -6)}.${rest.slice(-6)}`;
      const settled = await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: remainder, tendered_amount: null,
      }, "parcial:pay2"));

      expect(settled.result["sale_completed"]).toBe(true);
      expect(
        (database.native.prepare("SELECT status FROM sales_sales WHERE id=?")
          .get(sale.saleId) as { status: string }).status,
      ).toBe("COMPLETED");
      // Descontado exactamente una vez, al completarse.
      expect(stockOf(database, ids.presentationId)).toBe("10.000000");

      // Dos cobros reales, dos imputaciones, una sola venta.
      expect(paymentsOf(database, sale.saleId)).toBe(2);
      expect(allocationsOf(database, sale.saleId)).toBe(2);
    });
  }, 30_000);

  it("reintentar un cobro PARCIAL es IDEMPOTENT sin aumentar la cobertura", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "rparcial");
      const sale = await createSale(send, ids, "2.000000", "rparcial:sale");

      const status = (): string => (database.native.prepare(
        "SELECT status FROM sales_sales WHERE id=?",
      ).get(sale.saleId) as { status: string }).status;

      // Cobro parcial: la venta queda abierta, de modo que la barrera
      // `SALE_ALREADY_COMPLETED` **no** puede intervenir. Aquí la única
      // protección frente al doble cobro es la clave de idempotencia.
      const payload = { sale_id: sale.saleId, amount: "10000.000000", tendered_amount: null };
      const first = await send(mutating("payment.register.cash", payload, "rparcial:pay"));
      expect(first.result["outcome"]).toBe("CONFIRMED");
      expect(first.result["sale_completed"]).toBe(false);
      expect(status()).not.toBe("COMPLETED");
      expect(stockOf(database, ids.presentationId)).toBe("12.000000");

      // La cobertura real vive en el libro de imputaciones, no en la respuesta.
      const coverage = (): string => (database.native.prepare(
        `SELECT COALESCE(SUM(CAST(REPLACE(amount,'.','') AS INTEGER)), 0) total
           FROM payments_payment_allocations
          WHERE collection_subject_type='SALE' AND collection_subject_id=?`,
      ).get(sale.saleId) as { total: number }).total.toString();
      const coverageBefore = coverage();
      expect(coverageBefore).toBe("10000000000");

      // Reintento: trama nueva —nonce y secuencia distintos, para que el
      // anti-replay no la confunda con la anterior— y la misma clave.
      const retry = await send(mutating("payment.register.cash", payload, "rparcial:pay"));

      expect(retry.result["outcome"]).toBe("IDEMPOTENT");
      expect(retry.result["payment_id"]).toBe(first.result["payment_id"]);
      // El contrato devuelve el pago que ya existía y **nada más**: en
      // `IDEMPOTENT` no reconstruye importes (`DEC-016`). Por eso la cobertura
      // se comprueba contra el libro, que es donde el dinero cuenta.
      expect(retry.result["confirmed_coverage"]).toBeNull();
      expect(coverage()).toBe(coverageBefore);

      // Nada se duplicó, y la venta sigue abierta.
      expect(paymentsOf(database, sale.saleId)).toBe(1);
      expect(allocationsOf(database, sale.saleId)).toBe(1);
      expect(status()).not.toBe("COMPLETED");
      expect(stockOf(database, ids.presentationId)).toBe("12.000000");

      // El saldo restante, con clave propia, sí completa la venta.
      const rest = (BigInt(sale.payable.replace(".", "")) - 10_000_000_000n).toString();
      const settled = await send(mutating("payment.register.cash", {
        sale_id: sale.saleId,
        amount: `${rest.slice(0, -6)}.${rest.slice(-6)}`,
        tendered_amount: null,
      }, "rparcial:pay2"));

      expect(settled.result["sale_completed"]).toBe(true);
      expect(status()).toBe("COMPLETED");
      expect(paymentsOf(database, sale.saleId)).toBe(2);
      expect(allocationsOf(database, sale.saleId)).toBe(2);
      // Descontado una sola vez, al completarse.
      expect(stockOf(database, ids.presentationId)).toBe("10.000000");
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM inventory_movement WHERE presentation_id=? AND movement_type='SALE'",
        ids.presentationId,
      )).toBe(1);
    });
  }, 30_000);

  it("el estado final en SQLite es coherente y sin duplicados", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "final");
      const sale = await createSale(send, ids, "2.000000", "final:sale");
      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: sale.payable, tendered_amount: null,
      }, "final:pay"));

      const row = database.native.prepare(
        `SELECT status, cash_register_id, cash_shift_id, payable_amount
           FROM sales_sales WHERE id=?`,
      ).get(sale.saleId) as {
        status: string; cash_register_id: string | null;
        cash_shift_id: string | null; payable_amount: string;
      };
      expect(row.status).toBe("COMPLETED");
      expect(row.cash_register_id).toBe(REGISTER);
      expect(row.cash_shift_id).not.toBeNull();

      // El turno al que se ató la venta es el que sigue abierto en esa caja.
      const shift = database.native.prepare(
        "SELECT status, cash_register_id FROM cash_shift WHERE id=?",
      ).get(row.cash_shift_id) as { status: string; cash_register_id: string };
      expect(shift.status).toBe("OPEN");
      expect(shift.cash_register_id).toBe(REGISTER);

      // Un grupo de pago, un pago, una imputación por el importe exigido.
      expect(countOf(database,
        "SELECT COUNT(*) n FROM payments_payment_groups WHERE collection_subject_id=?", sale.saleId)).toBe(1);
      expect(paymentsOf(database, sale.saleId)).toBe(1);
      const allocation = database.native.prepare(
        "SELECT amount FROM payments_payment_allocations WHERE collection_subject_id=?",
      ).get(sale.saleId) as { amount: string };
      expect(allocation.amount).toBe(row.payable_amount);

      // Un solo movimiento de salida por la venta.
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM inventory_movement WHERE presentation_id=? AND movement_type='SALE'",
        ids.presentationId,
      )).toBe(1);
    });
  }, 30_000);
});

describe("el recibo proyecta la venta cobrada sin inventar nada", () => {
  it("una venta real produce un recibo que coincide con lo que quedó escrito", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "recibo");
      const sale = await createSale(send, ids, "2.000000", "recibo:sale");

      const receipts = new SqliteReceiptStore(database);

      // Antes de cobrar no hay recibo: entregar un comprobante de algo que no
      // ha ocurrido es peor que no entregar nada.
      expect(receipts.getReceipt(SCOPE, sale.saleId)).toBeNull();
      expect(receipts.saleExists(SCOPE, sale.saleId)).toBe(true);

      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: sale.payable, tendered_amount: "40000.000000",
      }, "recibo:pay"));

      const receipt = receipts.getReceipt(SCOPE, sale.saleId);
      expect(receipt).not.toBeNull();
      if (receipt === null) return;

      // El recibo no recalcula: cada cifra tiene que ser, carácter a carácter,
      // la que la venta dejó en SQLite. Se compara contra la fila, no contra
      // un número escrito a mano en la prueba.
      const row = database.native.prepare(
        `SELECT document_series, sale_number, currency_code, business_date, completed_at,
                subtotal_amount, discount_amount, tax_amount, fiscal_total_amount,
                commercial_rounding_adjustment, payable_amount, calculation_checksum
           FROM sales_sales WHERE id = ?`,
      ).get(sale.saleId) as Record<string, string | number>;

      expect(receipt.documentSeries).toBe(row["document_series"]);
      expect(receipt.saleNumber).toBe(row["sale_number"]);
      expect(receipt.currencyCode).toBe(row["currency_code"]);
      expect(receipt.businessDate).toBe(row["business_date"]);
      expect(receipt.completedAt).toBe(row["completed_at"]);
      expect(receipt.subtotalAmount).toBe(row["subtotal_amount"]);
      expect(receipt.discountAmount).toBe(row["discount_amount"]);
      expect(receipt.taxAmount).toBe(row["tax_amount"]);
      expect(receipt.fiscalTotalAmount).toBe(row["fiscal_total_amount"]);
      expect(receipt.commercialRoundingAdjustment).toBe(row["commercial_rounding_adjustment"]);
      expect(receipt.payableAmount).toBe(row["payable_amount"]);
      expect(receipt.calculationChecksum).toBe(row["calculation_checksum"]);
      expect(receipt.payableAmount).toBe(sale.payable);

      // La línea lleva los nombres congelados, no los actuales del catálogo.
      expect(receipt.lines).toHaveLength(1);
      const line = receipt.lines[0]!;
      expect(line.lineNumber).toBe(1);
      expect(line.productName).toBe("Café Americano 500 g");
      expect(line.presentationName).toBe("Bolsa 500 g");
      // `identifier_snapshot` viene **nulo**, y no porque el producto no tenga
      // código de barras: `create-sale-use-case.ts:354` escribe `null` fijo. La
      // columna existe desde el principio y nunca se ha poblado —el mismo patrón
      // que X-1—. El recibo no lo inventa: enseña lo que hay. Deuda `D-23`.
      expect(line.identifier).toBeNull();
      expect(line.unitCode).toBe("UND");
      expect(line.quantity).toBe("2.000000");
      expect(line.unitPriceAmount).toBe("18000.000000");

      // El cobro, con lo entregado y el cambio: es lo que el cliente comprueba.
      expect(receipt.payments).toHaveLength(1);
      const payment = receipt.payments[0]!;
      expect(payment.paymentMethod).toBe("CASH");
      expect(payment.confirmedAmount).toBe(sale.payable);
      expect(payment.tenderedAmount).toBe("40000.000000");
      expect(payment.changeAmount).not.toBeNull();
      expect(payment.currencyCode).toBe("COP");
    });
  }, 30_000);

  it("un cobro en dos partes aparece como dos pagos, no como uno agregado", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "recibo2");
      const sale = await createSale(send, ids, "2.000000", "recibo2:sale");

      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: "10000.000000", tendered_amount: null,
      }, "recibo2:pay1"));
      const rest = (BigInt(sale.payable.replace(".", "")) - 10_000_000_000n).toString();
      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId,
        amount: `${rest.slice(0, -6)}.${rest.slice(-6)}`,
        tendered_amount: null,
      }, "recibo2:pay2"));

      const receipt = new SqliteReceiptStore(database).getReceipt(SCOPE, sale.saleId);
      expect(receipt).not.toBeNull();
      // Dos cobros reales son dos líneas de cobro. Sumarlos escondería al
      // cliente que pagó en dos veces, que es justo lo que reclama si discute.
      expect(receipt?.payments).toHaveLength(2);
    });
  }, 30_000);

  it("el recibo no se cruza entre comercios: otro tenant no lo alcanza", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "recibo3");
      const sale = await createSale(send, ids, "1.000000", "recibo3:sale");
      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: sale.payable, tendered_amount: null,
      }, "recibo3:pay"));

      const receipts = new SqliteReceiptStore(database);
      expect(receipts.getReceipt(SCOPE, sale.saleId)).not.toBeNull();

      const otherTenant = { ...SCOPE, tenantId: "018f0000-0000-7000-8000-0000000000ff" };
      expect(receipts.getReceipt(otherTenant, sale.saleId)).toBeNull();
      expect(receipts.saleExists(otherTenant, sale.saleId)).toBe(false);

      const otherBranch = { ...SCOPE, branchId: "018f0000-0000-7000-8000-0000000000fe" };
      expect(receipts.getReceipt(otherBranch, sale.saleId)).toBeNull();
    });
  }, 30_000);
});
