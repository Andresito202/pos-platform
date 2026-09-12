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
 * prueba—, así que **se ejecuta en Linux**. El named pipe de Windows y su DACL
 * siguen siendo `REQUIRES_LOCAL_VERIFICATION`.
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
