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
import { EncryptedFileSecretStore, InsecureDerivedKeyProvider } from "../src/security/index.js";
import { FiscalCredentialStore, fiscalCredentialContext } from "../src/fiscal/fiscal-credential-store.js";
import type { ServiceConfig } from "../src/config.js";
import type { AuthorizationSnapshotClaims, SessionAssertionClaims } from "@pos-platform/contracts";
import {
  FACTUS_ADAPTER_DECLARATION,
  type DocumentIssuanceOutcome,
  type DocumentIssuancePort,
  type DocumentIssuanceRequest,
  type FrozenDocumentPayload,
  type PayloadValidationResult,
} from "@pos-platform/fiscal-adapters";

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
  "SALES_RECEIPT_READ",
  "CASH_SHIFT_CLOSE",
  "PAYMENTS_TRANSFER_REPORT",
  "PAYMENTS_TRANSFER_CONFIRM",
  "PAYMENTS_PAYMENT_READ",
  "CUSTOMERS_CUSTOMER_REGISTER",
  "CUSTOMERS_CUSTOMER_READ",
  "FISCAL_DOCUMENT_ISSUE",
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

/** `config()` con el ambiente FACTUS puesto — `DEC-021` F5. */
function fiscalConfig(): ServiceConfig {
  return { ...config(), fiscal_environment: "SANDBOX" } as ServiceConfig;
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

/** Puerto de emisión falso y determinista, sólo para cruzar el transporte. */
class FakeIssuancePort implements DocumentIssuancePort {
  constructor(private readonly outcome: DocumentIssuanceOutcome) {}
  validatePayload(_document: FrozenDocumentPayload): Promise<PayloadValidationResult> {
    return Promise.resolve({ kind: "VALID" });
  }
  issue(_request: DocumentIssuanceRequest, _signal: AbortSignal): Promise<DocumentIssuanceOutcome> {
    return Promise.resolve(this.outcome);
  }
}

/**
 * Igual que `withRealChannel`, con la pieza fiscal (`DEC-021` F5) además
 * conectada: almacén de secretos con una credencial real depositada
 * (`FiscalCredentialStore.deposit`, la misma vía que usa el operador en F2) y
 * un `DocumentIssuancePort` falso — el único punto de la vertical fiscal que
 * no puede ser real en CI, porque hablar con FACTUS de verdad es `F6`,
 * exclusivo del equipo del propietario.
 *
 * Todo lo demás —contrato, socket, `CommercialRequestHandler` de producción,
 * `IssueElectronicDocumentUseCase`, SQLite— es el real.
 */
async function withRealFiscalChannel(
  outcome: DocumentIssuanceOutcome,
  run: (send: (request: unknown) => Promise<ChannelResponse>, database: LocalDatabase) => Promise<void>,
): Promise<void> {
  const dir = await directory();
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);

  const keys = new Map<string, TrustedSigningKey>([
    [SESSION_KEY_ID, { key: createPublicKey(testOnlyKeyPair.privateKey), status: "ACTIVE" }],
  ]);

  const fiscalSecretStore = new EncryptedFileSecretStore(
    dir,
    new InsecureDerivedKeyProvider(dir),
    fiscalCredentialContext({ installationId: INSTALLATION, deviceId: DEVICE }),
  );
  new FiscalCredentialStore(fiscalSecretStore).deposit(
    {
      provider: "FACTUS", environment: "SANDBOX",
      fields: { client_id: "x", client_secret: "x", username: "x", password: "x" },
    },
    FACTUS_ADAPTER_DECLARATION.credential,
  );

  const commercial = new CommercialComponent(
    fiscalConfig(),
    { database } as never,
    { store: new DurableSyncStore(database) } as never,
    keys,
    () => NOW,
    // `paymentProvider` va antes que el almacen fiscal en la firma unificada:
    // esta prueba no ejercita cobro por proveedor.
    undefined,
    fiscalSecretStore,
    new FakeIssuancePort(outcome),
  );
  await commercial.start();
  const handler = new CommercialRequestHandler(fiscalConfig(), commercial);

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
      return await handler.handle(request as Parameters<typeof handler.handle>[0], context.connectionId, _signal);
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

/** Rango de numeración sincronizado directamente en SQLite: no hay operación de canal para F1/F4 (`synchronizeRanges` no está expuesto). */
function seedFiscalRange(database: LocalDatabase): void {
  const at = NOW.toISOString();
  database.native.prepare(`
    INSERT INTO fiscal_numbering_range(
      tenant_id,company_id,provider,environment,range_id,document_type,prefix,authority,
      resolution_number,range_from,range_to,current_number,valid_from,valid_until,
      provider_active,provider_expired,provider_document_code,synchronized_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    TENANT, COMPANY, "FACTUS", "SANDBOX", "FACTUS-RANGE-VERTICAL", "SALES_INVOICE", "SETP", "PROVIDER",
    "18760000001", 1, 5000, 0, "2026-01-01", "2027-01-01", 1, 0, "01", at,
  );
}

/**
 * Declara el atributo fiscal **por el canal real**, con la operación de D-19.
 *
 * Antes esto era un `INSERT` directo desde la prueba, y esa siembra era
 * exactamente el problema: la tabla no tenía escritor, así que la prueba
 * fabricaba a mano una fila que en producción no podía existir. Ninguna venta
 * real llegaba a `ISSUED` por ese camino. Ahora la escribe quien la escribirá
 * en caja.
 */
async function declareFiscalAttribute(
  send: (request: unknown) => Promise<ChannelResponse>,
  presentationId: string,
  idempotencyKey: string,
): Promise<ChannelResponse> {
  return send(mutating("catalog.fiscal.attribute.set", {
    presentation_id: presentationId,
    code_reference: `REF-${presentationId.slice(0, 8)}`,
    unit_measure_code: "94",
    standard_code: "999",
    tax_code: "01",
    tax_rate: "19.000000",
    status: "ACTIVE",
  }, idempotencyKey));
}

describe("la vertical fiscal atraviesa el socket real hasta SQLite (DEC-021 F5)", () => {
  it("adquiriente anónimo: BLOCKED por GENERIC_ACQUIRER_NOT_VERIFIED, cruzando el transporte con el handler de producción", async () => {
    await withRealFiscalChannel({
      kind: "EVIDENCED", transportStatus: "COMPLETED", normalizedResult: "ACCEPTED",
      externalIdentity: { providerOperationId: "op", providerDocumentId: null, prefix: "SETP", number: "1", cufe: "a".repeat(96) },
      providerStatus: { providerCode: "0", providerStatus: "processed", httpStatus: 200 },
    }, async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER, opening_amount: "0.000000",
        business_date: "2026-09-03", timezone_id: "America/Bogota", utc_offset_minutes: -300,
      }, "fiscalv:shift:1"));

      const product = await send(mutating("catalog.product.register", {
        code: "FISCV-001", name: "Producto fiscal", stock_controlled: false,
        presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
        barcode: "7700000000001", price_amount: "10000.000000", currency_code: "COP",
      }, "fiscalv:catalog:1"));
      const presentationId = product.result["presentation_id"] as string;
      const attribute = await declareFiscalAttribute(send, presentationId, "fiscalv:attr:1");
      expect(attribute.result["outcome"]).toBe("SET");
      seedFiscalRange(database);
      const found = await send(reading("catalog.item.find", { barcode: "7700000000001" }));

      const sale = await send(mutating("sale.create", {
        cash_register_id: REGISTER, channel: "POS",
        business_date: "2026-09-03", timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{ product_id: found.result["product_id"], presentation_id: presentationId, quantity: "1.000000" }],
      }, "fiscalv:sale:1"));
      const saleId = sale.result["sale_id"] as string;
      const payable = sale.result["payable_amount"] as string;

      const payment = await send(mutating("payment.register.cash", {
        sale_id: saleId, amount: payable, tendered_amount: null,
      }, "fiscalv:payment:1"));
      expect(payment.result["sale_completed"]).toBe(true);

      // El adquiriente anónimo (D-13): la única salida hoy es bloquear.
      const issued = await send(mutating("fiscal.document.issue", {
        sale_id: saleId,
        document_type: "SALES_INVOICE",
        customer: { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" },
        observation: null,
      }, "fiscalv:issue:1"));

      expect(issued.result["outcome"]).toBe("BLOCKED");
      expect(issued.result["block_code"]).toBe("PAYLOAD_ASSEMBLY_BLOCKED");
      expect((issued.result["reasons"] as { code: string }[]).some((r) => r.code === "GENERIC_ACQUIRER_NOT_VERIFIED"))
        .toBe(true);
    });
  }, 30_000);

  it("adquiriente identificado: ISSUED de extremo a extremo por el canal, con cufe persistido en SQLite", async () => {
    const outcome: DocumentIssuanceOutcome = {
      kind: "EVIDENCED", transportStatus: "COMPLETED", normalizedResult: "ACCEPTED",
      externalIdentity: {
        providerOperationId: "op-vert", providerDocumentId: "doc-vert",
        prefix: "SETP", number: "990000001", cufe: "b".repeat(96),
      },
      providerStatus: { providerCode: "0", providerStatus: "processed", httpStatus: 200 },
    };
    await withRealFiscalChannel(outcome, async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER, opening_amount: "0.000000",
        business_date: "2026-09-03", timezone_id: "America/Bogota", utc_offset_minutes: -300,
      }, "fiscalv2:shift:1"));

      const customer = await send(mutating("customer.register", {
        identification_document_code: "13", identification: "1020304050",
        verification_digit: null, legal_organization_code: "2",
        company: null, names: "Cliente Vertical", tribute_code: "ZZ",
        fiscal_responsibility_codes: ["R-99-PN"],
        email: null, phone: null, address: null, country_code: null, municipality_code: null,
      }, "fiscalv2:customer:1"));
      expect(customer.result["outcome"]).toBe("REGISTERED");
      const customerId = customer.result["customer_id"] as string;

      // El adquiriente se lee **donde queda escrito**, que es lo que a `B10`
      // le faltaba para `END_TO_END`. `tenant_id` y `company_id` se comprueban
      // aquí a propósito: el llamador nunca los envía —la operación rechaza un
      // sobre que los lleve— y salen del contexto verificado. Que la fila los
      // tenga es lo que demuestra que la derivación ocurrió.
      const storedCustomer = database.native.prepare(
        `SELECT tenant_id, company_id, identification_document_code, identification,
                legal_organization_code, names, tribute_code, fiscal_responsibility_codes
         FROM customers_customers WHERE tenant_id=? AND id=?`,
      ).get(TENANT, customerId);
      expect(storedCustomer).toEqual({
        tenant_id: TENANT,
        company_id: COMPANY,
        identification_document_code: "13",
        identification: "1020304050",
        legal_organization_code: "2",
        names: "Cliente Vertical",
        tribute_code: "ZZ",
        fiscal_responsibility_codes: JSON.stringify(["R-99-PN"]),
      });

      const product = await send(mutating("catalog.product.register", {
        code: "FISCV-002", name: "Producto fiscal 2", stock_controlled: false,
        presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
        barcode: "7700000000002", price_amount: "10000.000000", currency_code: "COP",
      }, "fiscalv2:catalog:1"));
      const presentationId = product.result["presentation_id"] as string;
      const attribute = await declareFiscalAttribute(send, presentationId, "fiscalv2:attr:1");
      expect(attribute.result["outcome"]).toBe("SET");
      seedFiscalRange(database);
      const found = await send(reading("catalog.item.find", { barcode: "7700000000002" }));

      const sale = await send(mutating("sale.create", {
        cash_register_id: REGISTER, channel: "POS",
        business_date: "2026-09-03", timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{ product_id: found.result["product_id"], presentation_id: presentationId, quantity: "1.000000" }],
      }, "fiscalv2:sale:1"));
      const saleId = sale.result["sale_id"] as string;
      const payable = sale.result["payable_amount"] as string;

      const payment = await send(mutating("payment.register.cash", {
        sale_id: saleId, amount: payable, tendered_amount: null,
      }, "fiscalv2:payment:1"));
      expect(payment.result["sale_completed"]).toBe(true);

      const issued = await send(mutating("fiscal.document.issue", {
        sale_id: saleId,
        document_type: "SALES_INVOICE",
        customer: { kind: "IDENTIFIED", customer_id: customerId },
        observation: null,
      }, "fiscalv2:issue:1"));

      expect(issued.status).toBe("SUCCEEDED");
      expect(issued.result["outcome"]).toBe("ISSUED");
      expect(issued.result["cufe"]).toBe("b".repeat(96));
      expect(issued.result["issued_number"]).toBe("990000001");

      const persisted = database.native.prepare(
        "SELECT transport_status, normalized_result, cufe FROM fiscal_electronic_document WHERE sale_id=?",
      ).get(saleId) as { transport_status: string; normalized_result: string; cufe: string };
      expect(persisted).toEqual({ transport_status: "COMPLETED", normalized_result: "ACCEPTED", cufe: "b".repeat(96) });
    });
  }, 30_000);
});

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

      // 3b · El efecto se lee **donde queda escrito**, no en la respuesta.
      //      La respuesta la construye el handler; la fila la escribió el
      //      almacén, y son dos afirmaciones distintas. Es lo que la regla 6
      //      del tablero exige para `END_TO_END`, y lo que a `B6` le faltaba:
      //      producto, presentación y precio son una sola transacción, porque
      //      un producto sin presentación vendible no sirve en una caja.
      const storedProduct = database.native.prepare(
        "SELECT code, name, stock_controlled, status FROM catalog_product WHERE tenant_id=? AND id=?",
      ).get(TENANT, product.result["product_id"]);
      expect(storedProduct).toEqual({
        code: "CAFE-001", name: "Café Americano 500 g", stock_controlled: 1, status: "ACTIVE",
      });
      const storedPresentation = database.native.prepare(
        "SELECT name, unit_code, unit_precision, barcode, status FROM catalog_presentation WHERE tenant_id=? AND id=?",
      ).get(TENANT, presentationId);
      expect(storedPresentation).toEqual({
        name: "Bolsa 500 g", unit_code: "UND", unit_precision: 0, barcode: BARCODE, status: "ACTIVE",
      });
      const storedPrice = database.native.prepare(
        "SELECT amount, currency_code, status FROM catalog_price WHERE tenant_id=? AND presentation_id=?",
      ).get(TENANT, presentationId);
      expect(storedPrice).toEqual({
        amount: "18000.000000", currency_code: "COP", status: "ACTIVE",
      });

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
      // `identifier_snapshot` lleva el código con el que se vendió el producto.
      // Estuvo nulo desde el origen —`create-sale-use-case.ts` escribía `null`
      // fijo, deuda `D-23`— hasta que la creación de venta empezó a congelarlo.
      // El recibo sigue sin inventar nada: enseña lo que hay.
      expect(line.identifier).toBe(BARCODE);
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

describe("el recibo es alcanzable por el canal real, no sólo por el almacén", () => {
  it("sales.receipt.get cruza el socket y devuelve el recibo de la venta cobrada", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "canalrec");
      const sale = await createSale(send, ids, "2.000000", "canalrec:sale");

      // Antes de cobrar, la venta existe pero no tiene recibo. El canal lo dice
      // con NOT_COMPLETED, que no es lo mismo que NOT_FOUND.
      const pending = await send(reading("sales.receipt.get", { sale_id: sale.saleId }));
      expect(pending.result["outcome"]).toBe("NOT_COMPLETED");
      expect(pending.result["lines"]).toBeNull();

      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: sale.payable, tendered_amount: "40000.000000",
      }, "canalrec:pay"));

      const response = await send(reading("sales.receipt.get", { sale_id: sale.saleId }));
      expect(response.result["outcome"]).toBe("FOUND");
      expect(response.result["sale_id"]).toBe(sale.saleId);
      expect(response.result["payable_amount"]).toBe(sale.payable);

      // Lo que llega al otro lado del socket es el recibo completo, no un
      // resumen: las lineas y los cobros viajan enteros.
      const lines = response.result["lines"] as Array<Record<string, unknown>>;
      expect(lines).toHaveLength(1);
      expect(lines[0]!["product_name"]).toBe("Café Americano 500 g");
      expect(lines[0]!["quantity"]).toBe("2.000000");
      expect(lines[0]!["unit_price_amount"]).toBe("18000.000000");

      const payments = response.result["payments"] as Array<Record<string, unknown>>;
      expect(payments).toHaveLength(1);
      expect(payments[0]!["payment_method"]).toBe("CASH");
      expect(payments[0]!["tendered_amount"]).toBe("40000.000000");

      // El importe que la respuesta transporta es el que quedo escrito, no uno
      // recalculado en el camino.
      const row = database.native.prepare(
        "SELECT payable_amount, calculation_checksum FROM sales_sales WHERE id=?",
      ).get(sale.saleId) as { payable_amount: string; calculation_checksum: string };
      expect(response.result["payable_amount"]).toBe(row.payable_amount);
      expect(response.result["calculation_checksum"]).toBe(row.calculation_checksum);
    });
  }, 30_000);

  it("una venta que no existe devuelve NOT_FOUND, no NOT_COMPLETED", async () => {
    await withRealChannel(async (send, database) => {
      await prepareCounter(send, database, "canalrec2");
      const response = await send(reading("sales.receipt.get", {
        sale_id: "018f0000-0000-7000-8000-0000000000fd",
      }));
      // La distincion sobrevive al transporte: es la que le dice al cajero si
      // debe cobrar la venta o buscarla en otra caja.
      expect(response.result["outcome"]).toBe("NOT_FOUND");
    });
  }, 30_000);
});

describe("el turno se cierra por el canal real y libera la caja", () => {
  it("cash.shift.close cruza el socket, arquea y deja abrir el turno siguiente", async () => {
    await withRealChannel(async (send, database) => {
      // `prepareCounter` abre el turno; su respuesta trae la versión, que es lo
      // que el cierre exige y lo que antes no viajaba.
      const opened = await send(reading("session.activate", {
        session_assertion: signSession(sessionClaims()),
      }));
      expect(opened.status).toBe("SUCCEEDED");

      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);

      const open = await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "50000.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "cierre:open"));
      expect(open.result["outcome"]).toBe("OPENED");
      const shiftId = open.result["shift_id"] as string;
      const version = open.result["version"] as number;
      // La versión viaja de verdad, no es una suposición de la interfaz.
      expect(version).toBe(1);

      // Mientras el turno siga abierto, la caja no admite otro: es la razón por
      // la que sin cierre el POS queda inservible al día siguiente.
      const blocked = await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "50000.000000",
        business_date: "2026-09-04",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "cierre:blocked"));
      expect(blocked.result["outcome"]).toBe("INCOMPATIBLE_SHIFT");

      const closed = await send(mutating("cash.shift.close", {
        shift_id: shiftId,
        counted_amount: "50000.000000",
        expected_version: version,
      }, "cierre:close"));

      expect(closed.result["outcome"]).toBe("CLOSED");
      expect(closed.result["shift_id"]).toBe(shiftId);
      // Sin ventas, lo esperado es la base y la diferencia es cero.
      expect(closed.result["expected_cash"]).toBe("50000.000000");
      expect(closed.result["counted_amount"]).toBe("50000.000000");
      expect(closed.result["difference_amount"]).toBe("0.000000");

      const row = database.native.prepare(
        "SELECT status FROM cash_shift WHERE id=?",
      ).get(shiftId) as { status: string };
      expect(row.status).toBe("CLOSED");

      // Y ahora sí: la caja vuelve a admitir turno. Esto es lo que el cierre
      // desbloquea, y lo que ninguna prueba demostraba antes.
      const next = await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "20000.000000",
        business_date: "2026-09-04",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "cierre:next"));
      expect(next.result["outcome"]).toBe("OPENED");
      expect(next.result["shift_id"]).not.toBe(shiftId);
      expect(next.result["version"]).toBe(1);
    });
  }, 30_000);

  it("un arqueo con faltante lo declara, no lo esconde", async () => {
    await withRealChannel(async (send, database) => {
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);

      const open = await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "50000.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "faltante:open"));

      const closed = await send(mutating("cash.shift.close", {
        shift_id: open.result["shift_id"] as string,
        counted_amount: "48000.000000",
        expected_version: open.result["version"] as number,
      }, "faltante:close"));

      expect(closed.result["outcome"]).toBe("CLOSED");
      // Faltan 2.000 y el servicio lo dice con signo. El arqueo no se maquilla.
      expect(closed.result["difference_amount"]).toBe("-2000.000000");
    });
  }, 30_000);

  it("cerrar con una versión que ya no corre se rechaza por conflicto", async () => {
    await withRealChannel(async (send, database) => {
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);

      const open = await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER,
        opening_amount: "50000.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      }, "conflicto:open"));

      const wrong = await send(mutating("cash.shift.close", {
        shift_id: open.result["shift_id"] as string,
        counted_amount: "50000.000000",
        expected_version: 99,
      }, "conflicto:close"));

      // Cerrar sobre un estado que ya no existe es peor que no cerrar: el
      // servicio lo rechaza en vez de arquear contra una fila obsoleta.
      expect(wrong.result["outcome"]).toBe("VERSION_CONFLICT");
    });
  }, 30_000);
});

describe("la transferencia recorre reportar → leer versión → atestiguar", () => {
  it("registrar no cobra; confirmar sí, y la venta se completa", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "transf");
      const sale = await createSale(send, ids, "2.000000", "transf:sale");

      const registered = await send(mutating("payment.register.transfer", {
        sale_id: sale.saleId,
        amount: sale.payable,
        provider_code: null,
        provider_reference: null,
      }, "transf:report"));

      expect(registered.result["outcome"]).toBe("REGISTERED");
      const paymentId = registered.result["payment_id"] as string;
      // El contrato de registro **no** devuelve versión: es el hecho que obliga
      // a consultar el pago antes de confirmar.
      expect(registered.result).not.toHaveProperty("version");

      // Reportar no es cobrar: la venta sigue abierta y la mercancía no sale.
      expect((database.native.prepare("SELECT status FROM sales_sales WHERE id=?")
        .get(sale.saleId) as { status: string }).status).not.toBe("COMPLETED");
      expect(stockOf(database, ids.presentationId)).toBe("12.000000");

      const fetched = await send(reading("payment.get", { payment_id: paymentId }));
      expect(fetched.result["outcome"]).toBe("FOUND");
      const version = fetched.result["version"] as number;
      expect(typeof version).toBe("number");
      // El importe reportado es el que se pidió, leído del estado persistido.
      expect(fetched.result["expected_amount"]).toBe(sale.payable);
      // Todavía sin confirmar: lo confirmado es **cero**, no nulo. El pago
      // existe y su cobertura es ninguna, que no es lo mismo que «no se sabe».
      expect(fetched.result["confirmed_amount"]).toBe("0.000000");
      expect(fetched.result["status"]).not.toBe("CONFIRMED");

      const confirmed = await send(mutating("payment.transfer.confirm", {
        payment_id: paymentId,
        expected_version: version,
      }, "transf:confirm"));

      expect(confirmed.result["outcome"]).toBe("CONFIRMED");
      expect(confirmed.result["sale_completed"]).toBe(true);
      expect(confirmed.result["confirmed_coverage"]).toBe(sale.payable);
      expect(confirmed.result["payable_amount"]).toBe(sale.payable);

      // Estado real tras la atestiguación.
      expect((database.native.prepare("SELECT status FROM sales_sales WHERE id=?")
        .get(sale.saleId) as { status: string }).status).toBe("COMPLETED");
      const row = database.native.prepare(
        "SELECT payment_method, status, confirmed_amount FROM payments_payments WHERE id=?",
      ).get(paymentId) as { payment_method: string; status: string; confirmed_amount: string };
      expect(row.payment_method).toBe("TRANSFER");
      expect(row.status).toBe("CONFIRMED");
      expect(row.confirmed_amount).toBe(sale.payable);
      // Y ahora sí sale la mercancía: 12 − 2.
      expect(stockOf(database, ids.presentationId)).toBe("10.000000");
      expect(paymentsOf(database, sale.saleId)).toBe(1);
    });
  }, 30_000);

  it("confirmar con una versión obsoleta se rechaza y no cobra nada", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await prepareCounter(send, database, "transfv");
      const sale = await createSale(send, ids, "2.000000", "transfv:sale");

      const registered = await send(mutating("payment.register.transfer", {
        sale_id: sale.saleId, amount: sale.payable,
        provider_code: null, provider_reference: null,
      }, "transfv:report"));
      const paymentId = registered.result["payment_id"] as string;

      const wrong = await send(mutating("payment.transfer.confirm", {
        payment_id: paymentId, expected_version: 99,
      }, "transfv:confirm"));

      // Suponer la versión desde la interfaz acabaría exactamente aquí.
      expect(wrong.result["outcome"]).toBe("VERSION_CONFLICT");
      expect(wrong.result["sale_completed"]).toBe(false);
      expect((database.native.prepare("SELECT status FROM sales_sales WHERE id=?")
        .get(sale.saleId) as { status: string }).status).not.toBe("COMPLETED");
      expect(stockOf(database, ids.presentationId)).toBe("12.000000");
    });
  }, 30_000);
});

describe("payment.register.qr — transporte real", () => {
  it("un QR sin proveedor configurado cruza el socket y conserva la respuesta", async () => {
    await withRealChannel(async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);

      const activated = await send(reading("session.activate", {
        session_assertion: signSession(sessionClaims()),
      }));
      expect(activated.status).toBe("SUCCEEDED");

      const response = await send(mutating("payment.register.qr", {
        sale_id: "018f0000-0000-7000-8000-0000000000fd",
        amount: "10000.000000",
      }, "qr:transport:1"));

      expect(response.status).toBe("REJECTED");
      expect(response.result_code).toBe("PROVIDER_NOT_CONFIGURED");
      expect(response.result["outcome"]).toBe("PROVIDER_NOT_CONFIGURED");

      const count = database.native.prepare(
        "SELECT COUNT(*) AS count FROM payments_payments",
      ).get() as { count: number };
      expect(count.count).toBe(0);
    });
  }, 30_000);
});

/**
 * D-19 — `catalog.fiscal.attribute.set` por el canal real hasta SQLite.
 *
 * La tabla `catalog_fiscal_attribute` tenía dos lectores y **ningún escritor**.
 * Lo que sigue comprueba las dos mitades de la operación que lo cierra: que
 * escribe de verdad, y que **rechaza antes de escribir** los códigos que tienen
 * forma de código DIAN pero no pertenecen a las tablas verificadas —el caso que
 * la base de datos, que sólo comprueba forma con `GLOB`, deja pasar.
 */
describe("catalog.fiscal.attribute.set — el escritor que faltaba (D-19)", () => {
  it("escribe el atributo y lo deja legible en SQLite, con auditoría y outbox", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19a");

      const response = await declareFiscalAttribute(send, presentationId, "d19a:attr");
      expect(response.status).toBe("SUCCEEDED");
      expect(response.result["outcome"]).toBe("SET");
      expect(response.result["presentation_id"]).toBe(presentationId);
      expect(response.result["findings"]).toEqual([]);

      const row = database.native.prepare(
        `SELECT code_reference, unit_measure_code, standard_code, tax_code, tax_rate, status
         FROM catalog_fiscal_attribute WHERE tenant_id=? AND presentation_id=?`,
      ).get(TENANT, presentationId);
      expect(row).toEqual({
        code_reference: `REF-${presentationId.slice(0, 8)}`,
        unit_measure_code: "94",
        standard_code: "999",
        tax_code: "01",
        tax_rate: "19.000000",
        status: "ACTIVE",
      });

      // Escribir el catálogo es un hecho auditable y sincronizable: si no
      // dejara rastro, el central nunca sabría que esta presentación ya se
      // puede facturar.
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM local_operation_audit WHERE action_code=? AND resource_id=?",
        "CATALOG_FISCAL_ATTRIBUTE_SET", presentationId,
      )).toBe(1);
      const queued = database.native.prepare(
        "SELECT operation_json FROM local_sync_outbox WHERE operation_type=? AND idempotency_key=?",
      ).all("CATALOG_FISCAL_ATTRIBUTE_SET", "d19a:attr") as { operation_json: string }[];
      expect(queued).toHaveLength(1);
      expect((JSON.parse(queued[0]!.operation_json) as { aggregate_id: string }).aggregate_id)
        .toBe(presentationId);
    });
  }, 30_000);

  it("repetir la misma petición es IDEMPOTENT y no duplica el rastro", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19b");

      expect((await declareFiscalAttribute(send, presentationId, "d19b:attr")).result["outcome"]).toBe("SET");
      const repeat = await declareFiscalAttribute(send, presentationId, "d19b:attr");
      expect(repeat.status).toBe("SUCCEEDED");
      expect(repeat.result["outcome"]).toBe("IDEMPOTENT");
      expect(repeat.result["presentation_id"]).toBe(presentationId);

      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM local_sync_outbox WHERE operation_type=? AND idempotency_key=?",
        "CATALOG_FISCAL_ATTRIBUTE_SET", "d19b:attr",
      )).toBe(1);
    });
  }, 30_000);

  it("la misma clave con otro contenido es IDEMPOTENCY_CONFLICT y no pisa lo escrito", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19c");
      await declareFiscalAttribute(send, presentationId, "d19c:attr");

      const conflicting = await send(mutating("catalog.fiscal.attribute.set", {
        presentation_id: presentationId,
        code_reference: `REF-${presentationId.slice(0, 8)}`,
        unit_measure_code: "94",
        standard_code: "999",
        tax_code: "04",
        tax_rate: "8.000000",
        status: "ACTIVE",
      }, "d19c:attr"));

      expect(conflicting.status).toBe("REJECTED");
      expect(conflicting.result["outcome"]).toBe("IDEMPOTENCY_CONFLICT");

      const row = database.native.prepare(
        "SELECT tax_code, tax_rate FROM catalog_fiscal_attribute WHERE tenant_id=? AND presentation_id=?",
      ).get(TENANT, presentationId);
      expect(row).toEqual({ tax_code: "01", tax_rate: "19.000000" });
    });
  }, 30_000);

  it("corrige un código equivocado: la segunda declaración sustituye a la primera", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19d");
      await declareFiscalAttribute(send, presentationId, "d19d:attr");

      // La razón de que esto sea una operación propia y no un campo del alta:
      // un código fiscal equivocado se corrige; el alta ocurre una sola vez.
      const corrected = await send(mutating("catalog.fiscal.attribute.set", {
        presentation_id: presentationId,
        code_reference: `REF-${presentationId.slice(0, 8)}`,
        unit_measure_code: "94",
        standard_code: "999",
        tax_code: "04",
        tax_rate: "8.000000",
        status: "ACTIVE",
      }, "d19d:attr:2"));

      expect(corrected.result["outcome"]).toBe("SET");
      const row = database.native.prepare(
        "SELECT tax_code, tax_rate FROM catalog_fiscal_attribute WHERE tenant_id=? AND presentation_id=?",
      ).get(TENANT, presentationId);
      expect(row).toEqual({ tax_code: "04", tax_rate: "8.000000" });
    });
  }, 30_000);

  /**
   * El hallazgo que justifica todo el caso de uso: `"95"` y `"998"` tienen
   * forma de código DIAN —el `GLOB` de la tabla los aceptaría— pero no están en
   * `UNIT_MEASURE_CODES` ni en `PRODUCT_STANDARD_CODES`. Guardarlos dejaría el
   * fallo para el momento de emitir, con la venta ya cobrada.
   */
  it("rechaza códigos con forma válida que no pertenecen a las tablas verificadas, y no escribe nada", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19e");

      const rejected = await send(mutating("catalog.fiscal.attribute.set", {
        presentation_id: presentationId,
        code_reference: "REF-INVENTADO",
        unit_measure_code: "95",
        standard_code: "998",
        tax_code: "99",
        tax_rate: "19.000000",
        status: "ACTIVE",
      }, "d19e:attr"));

      expect(rejected.status).toBe("REJECTED");
      expect(rejected.result["outcome"]).toBe("FISCAL_CODES_NOT_VERIFIED");
      expect(rejected.result["presentation_id"]).toBeNull();

      // Código y ruta, nunca el valor: el hallazgo dice cuál de los cuatro
      // corregir sin devolver lo que el operador escribió.
      expect(rejected.result["findings"]).toEqual([
        { code: "UNIT_MEASURE_CODE_NOT_VERIFIED", path: "unitMeasureCode" },
        { code: "PRODUCT_STANDARD_CODE_NOT_VERIFIED", path: "standardCode" },
        { code: "TAX_CODE_NOT_VERIFIED", path: "taxes[0].code" },
      ]);

      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM catalog_fiscal_attribute WHERE tenant_id=? AND presentation_id=?",
        TENANT, presentationId,
      )).toBe(0);
    });
  }, 30_000);

  it("una tasa fuera de 0–100 es hallazgo, no una fila guardada", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19f");

      const rejected = await send(mutating("catalog.fiscal.attribute.set", {
        presentation_id: presentationId,
        code_reference: "REF-TASA",
        unit_measure_code: "94",
        standard_code: "999",
        tax_code: "01",
        tax_rate: "190.000000",
        status: "ACTIVE",
      }, "d19f:attr"));

      expect(rejected.result["outcome"]).toBe("FISCAL_CODES_NOT_VERIFIED");
      expect(rejected.result["findings"]).toEqual([
        { code: "TAX_RATE_OUT_OF_RANGE", path: "taxes[0].rate" },
      ]);
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM catalog_fiscal_attribute WHERE tenant_id=? AND presentation_id=?",
        TENANT, presentationId,
      )).toBe(0);
    });
  }, 30_000);

  /**
   * Nombrar una presentación no es aportar ámbito. La presentación se resuelve
   * bajo el `tenant` del contexto verificado, así que un identificador que no
   * pertenece a este tenant no se encuentra, aunque exista en la base.
   */
  it("una presentación de otro tenant no se encuentra: PRESENTATION_NOT_FOUND", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId } = await prepareCounter(send, database, "d19g");
      const foreignTenant = "018f0000-0000-7000-8000-0000000d19ff";
      const foreignProduct = "018f0000-0000-7000-8000-0000000d19fe";
      const foreign = "018f0000-0000-7000-8000-0000000d1900";
      const at = NOW.toISOString();
      database.native.prepare(`
        INSERT INTO catalog_product(
          id, tenant_id, company_id, code, name, status, stock_controlled,
          registered_by_actor_id, idempotency_key, correlation_id, version,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        foreignProduct, foreignTenant, COMPANY, "AJENO-1", "Producto ajeno",
        "ACTIVE", 0, USER, "d19g:foreign", randomUUID(), 1, at, at,
      );
      database.native.prepare(`
        INSERT INTO catalog_presentation(
          id, tenant_id, product_id, name, unit_code, unit_precision,
          barcode, status, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(foreign, foreignTenant, foreignProduct, "Ajena", "UND", 0, null, "ACTIVE", at, at);

      const response = await send(mutating("catalog.fiscal.attribute.set", {
        presentation_id: foreign,
        code_reference: "REF-AJENA",
        unit_measure_code: "94",
        standard_code: "999",
        tax_code: "01",
        tax_rate: "19.000000",
        status: "ACTIVE",
      }, "d19g:attr"));

      expect(response.status).toBe("REJECTED");
      expect(response.result["outcome"]).toBe("PRESENTATION_NOT_FOUND");
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM catalog_fiscal_attribute WHERE presentation_id=?",
        foreign,
      )).toBe(0);
      // La del tenant propio sigue intacta y sin atributo: no hubo escritura.
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM catalog_fiscal_attribute WHERE presentation_id=?",
        presentationId,
      )).toBe(0);
    });
  }, 30_000);
});

/**
 * `catalog.presentation.add` — la segunda presentación de un producto.
 *
 * `DEC-004` fija `Product 1 ─── 1..N ProductPresentation` y el esquema lo
 * admitía desde `MIGRATION_014`, pero no había forma de llegar a la segunda:
 * `catalog.product.register` creaba producto, presentación y precio en una
 * transacción y era la única escritura de catálogo.
 *
 * Lo que estas pruebas **no** afirman: conversión. Cada presentación lleva su
 * propia existencia, y hay una prueba abajo que lo fija para que nadie lo
 * confunda con un defecto.
 */
describe("catalog.presentation.add — la unidad y el paquete del mismo artículo", () => {
  async function addPack(
    send: (request: unknown) => Promise<ChannelResponse>,
    productId: string,
    key: string,
    overrides: Record<string, unknown> = {},
  ): Promise<ChannelResponse> {
    return send(mutating("catalog.presentation.add", {
      product_id: productId,
      name: "Paca x12",
      unit_code: "PACA",
      unit_precision: 0,
      barcode: null,
      price_amount: "180000.000000",
      currency_code: "COP",
      ...overrides,
    }, key));
  }

  it("añade la presentación con su precio y la deja vendible, con auditoría y outbox", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId, productId } = await prepareCounter(send, database, "pres1");

      const added = await addPack(send, productId, "pres1:add", { barcode: "7709000000011" });
      expect(added.status).toBe("SUCCEEDED");
      expect(added.result["outcome"]).toBe("ADDED");
      expect(added.result["product_id"]).toBe(productId);
      const packId = added.result["presentation_id"] as string;
      expect(packId).not.toBe(presentationId);

      // El efecto, donde queda escrito.
      expect(database.native.prepare(
        "SELECT name, unit_code, barcode, status FROM catalog_presentation WHERE tenant_id=? AND id=?",
      ).get(TENANT, packId)).toEqual({
        name: "Paca x12", unit_code: "PACA", barcode: "7709000000011", status: "ACTIVE",
      });
      expect(database.native.prepare(
        "SELECT amount, currency_code, status FROM catalog_price WHERE tenant_id=? AND presentation_id=?",
      ).get(TENANT, packId)).toEqual({
        amount: "180000.000000", currency_code: "COP", status: "ACTIVE",
      });

      // Dos presentaciones colgando del mismo producto: es la capacidad.
      expect(countOf(
        database, "SELECT COUNT(*) n FROM catalog_presentation WHERE tenant_id=? AND product_id=?",
        TENANT, productId,
      )).toBe(2);

      expect(countOf(
        database, "SELECT COUNT(*) n FROM local_operation_audit WHERE action_code=? AND resource_id=?",
        "CATALOG_PRESENTATION_ADD", packId,
      )).toBe(1);
      expect(countOf(
        database, "SELECT COUNT(*) n FROM local_sync_outbox WHERE operation_type=? AND idempotency_key=?",
        "CATALOG_PRESENTATION_ADD", "pres1:add",
      )).toBe(1);
    });
  }, 30_000);

  it("el lector encuentra cada presentación por su propio código", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId, productId } = await prepareCounter(send, database, "pres2");
      const added = await addPack(send, productId, "pres2:add", { barcode: "7709000000022" });
      const packId = added.result["presentation_id"] as string;

      // Escanear la paca da la paca; escanear la unidad da la unidad. Sin esto
      // el cajero cobraría el artículo equivocado sin forma de notarlo.
      const pack = await send(reading("catalog.item.find", { barcode: "7709000000022" }));
      expect(pack.result["presentation_id"]).toBe(packId);
      expect(pack.result["product_id"]).toBe(productId);
      expect(pack.result["price_amount"]).toBe("180000.000000");

      const unit = await send(reading("catalog.item.find", { barcode: BARCODE }));
      expect(unit.result["presentation_id"]).toBe(presentationId);
      expect(unit.result["price_amount"]).toBe("18000.000000");
    });
  }, 30_000);

  /**
   * El límite del alcance, fijado como prueba para que no se lea como defecto.
   *
   * `DEC-004` §747 especifica `contained_quantity` y `conversion_factor`;
   * `MIGRATION_014` no los materializó. Mientras no existan, vender la paca no
   * puede descontar unidades: no hay dato que diga cuántas lleva.
   */
  it("cada presentación lleva su propia existencia: vender la paca NO descuenta unidades", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId, productId } = await prepareCounter(send, database, "pres3");
      const added = await addPack(send, productId, "pres3:add");
      const packId = added.result["presentation_id"] as string;

      await send(mutating("inventory.stock.receive", {
        presentation_id: packId, movement_type: "PURCHASE_RECEIPT", quantity: "3.000000",
        reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-03",
      }, "pres3:stock"));

      expect(stockOf(database, packId)).toBe("3.000000");
      // La unidad conserva las 12 que dejó `prepareCounter`. Son dos saldos.
      expect(stockOf(database, presentationId)).toBe("12.000000");

      const sale = await createSale(
        send, { presentationId: packId, productId }, "1.000000", "pres3:sale",
      );
      await send(mutating("payment.register.cash", {
        sale_id: sale.saleId, amount: sale.payable, tendered_amount: null,
      }, "pres3:pay"));

      expect(stockOf(database, packId)).toBe("2.000000");
      // Ni una unidad menos: la conversión no existe todavía y no se finge.
      expect(stockOf(database, presentationId)).toBe("12.000000");
    });
  }, 30_000);

  it("un código de barras ya usado se rechaza diciendo cuál presentación lo tiene", async () => {
    await withRealChannel(async (send, database) => {
      const { presentationId, productId } = await prepareCounter(send, database, "pres4");

      const collision = await addPack(send, productId, "pres4:add", { barcode: BARCODE });
      expect(collision.status).toBe("REJECTED");
      expect(collision.result["outcome"]).toBe("BARCODE_ALREADY_REGISTERED");
      expect(collision.result["presentation_id"]).toBe(presentationId);

      // Y no escribió nada: el producto sigue con una sola presentación.
      expect(countOf(
        database, "SELECT COUNT(*) n FROM catalog_presentation WHERE tenant_id=? AND product_id=?",
        TENANT, productId,
      )).toBe(1);
    });
  }, 30_000);

  it("repetir la misma petición es IDEMPOTENT y no crea una segunda fila", async () => {
    await withRealChannel(async (send, database) => {
      const { productId } = await prepareCounter(send, database, "pres5");
      expect((await addPack(send, productId, "pres5:add")).result["outcome"]).toBe("ADDED");
      expect((await addPack(send, productId, "pres5:add")).result["outcome"]).toBe("IDEMPOTENT");

      expect(countOf(
        database, "SELECT COUNT(*) n FROM catalog_presentation WHERE tenant_id=? AND product_id=?",
        TENANT, productId,
      )).toBe(2);
    });
  }, 30_000);

  it("un producto de otro tenant no se encuentra: PRODUCT_NOT_FOUND", async () => {
    await withRealChannel(async (send, database) => {
      const { productId } = await prepareCounter(send, database, "pres6");
      const foreignTenant = "018f0000-0000-7000-8000-0000000d2900";
      const foreignProduct = "018f0000-0000-7000-8000-0000000d2901";
      const at = NOW.toISOString();
      database.native.prepare(`
        INSERT INTO catalog_product(
          id, tenant_id, company_id, code, name, status, stock_controlled,
          registered_by_actor_id, idempotency_key, correlation_id, version,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        foreignProduct, foreignTenant, COMPANY, "AJENO-2", "Producto ajeno",
        "ACTIVE", 0, USER, "pres6:foreign", randomUUID(), 1, at, at,
      );

      const response = await addPack(send, foreignProduct, "pres6:add");
      expect(response.status).toBe("REJECTED");
      expect(response.result["outcome"]).toBe("PRODUCT_NOT_FOUND");
      expect(countOf(
        database, "SELECT COUNT(*) n FROM catalog_presentation WHERE product_id=?", foreignProduct,
      )).toBe(0);
      // El del tenant propio sigue con la suya y nada más.
      expect(countOf(
        database, "SELECT COUNT(*) n FROM catalog_presentation WHERE tenant_id=? AND product_id=?",
        TENANT, productId,
      )).toBe(1);
    });
  }, 30_000);
});
