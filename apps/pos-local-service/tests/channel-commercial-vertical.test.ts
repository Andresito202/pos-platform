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
  "INVENTORY_STOCK_ADJUST",
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
  readonly error?: { readonly code: string; readonly category: string } | null;
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
        // La venta nombra al cliente que se va a facturar (`D-40`): sin eso,
        // la emisión se detendría pidiendo confirmar la diferencia.
        customer_id: customerId,
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

      // `D-40`, «advertir»: facturar a otro cliente que el que nombró la venta
      // se detiene, dice los dos y no crea documento. No se emite nada hasta
      // que el operador confirme.
      const otra = await send(mutating("customer.register", {
        identification_document_code: "13", identification: "1098765432",
        verification_digit: null, legal_organization_code: "2",
        company: null, names: "Otra Persona", tribute_code: "ZZ",
        fiscal_responsibility_codes: ["R-99-PN"],
        email: null, phone: null, address: null, country_code: null, municipality_code: null,
      }, "fiscalv2:customer:2"));
      const otherId = otra.result["customer_id"] as string;
      const mismatch = await send(mutating("fiscal.document.issue", {
        sale_id: saleId,
        document_type: "SALES_INVOICE",
        customer: { kind: "IDENTIFIED", customer_id: otherId },
        observation: null,
      }, "fiscalv2:issue:mismatch"));
      expect(mismatch.status).toBe("REJECTED");
      expect(mismatch.result["outcome"]).toBe("BLOCKED");
      expect(mismatch.result["block_code"]).toBe("CUSTOMER_MISMATCH");
      expect(mismatch.result["customer_mismatch"]).toEqual({
        sale_customer_id: customerId, requested_customer_id: otherId,
      });
      expect(countOf(
        database, "SELECT COUNT(*) n FROM fiscal_electronic_document WHERE sale_id=?", saleId,
      )).toBe(0);

      const issued = await send(mutating("fiscal.document.issue", {
        sale_id: saleId,
        document_type: "SALES_INVOICE",
        customer: { kind: "IDENTIFIED", customer_id: customerId },
        observation: null,
      }, "fiscalv2:issue:1"));
      expect(issued.result["customer_mismatch"]).toBeNull();

      expect(issued.status).toBe("SUCCEEDED");
      expect(issued.result["outcome"]).toBe("ISSUED");
      expect(issued.result["cufe"]).toBe("b".repeat(96));
      expect(issued.result["issued_number"]).toBe("990000001");

      const persisted = database.native.prepare(
        "SELECT transport_status, normalized_result, cufe FROM fiscal_electronic_document WHERE sale_id=?",
      ).get(saleId) as { transport_status: string; normalized_result: string; cufe: string };
      expect(persisted).toEqual({ transport_status: "COMPLETED", normalized_result: "ACCEPTED", cufe: "b".repeat(96) });

      // Venta de mostrador que el cliente pide facturar a su nombre: la
      // diferencia se advierte y, **confirmada**, se emite. Es el caso más
      // común del mostrador, y la confirmación cruza el canal hasta el caso de uso.
      const mostrador = await send(mutating("sale.create", {
        cash_register_id: REGISTER, channel: "POS",
        business_date: "2026-09-03", timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{ product_id: found.result["product_id"], presentation_id: presentationId, quantity: "1.000000" }],
      }, "fiscalv2:sale:2"));
      const counterSale = mostrador.result["sale_id"] as string;
      await send(mutating("payment.register.cash", {
        sale_id: counterSale, amount: mostrador.result["payable_amount"], tendered_amount: null,
      }, "fiscalv2:payment:2"));
      const pedir = { sale_id: counterSale, document_type: "SALES_INVOICE",
        customer: { kind: "IDENTIFIED", customer_id: customerId }, observation: null };
      const aviso = await send(mutating("fiscal.document.issue", pedir, "fiscalv2:issue:2a"));
      expect(aviso.result["customer_mismatch"]).toEqual({
        sale_customer_id: null, requested_customer_id: customerId,
      });
      const confirmada = await send(mutating("fiscal.document.issue", {
        ...pedir, acknowledge_customer_mismatch: true,
      }, "fiscalv2:issue:2b"));
      expect(confirmada.status).toBe("SUCCEEDED");
      expect(confirmada.result["outcome"]).toBe("ISSUED");

      // `fiscal.document.list`: a quién se facturó cada venta. La de mostrador
      // dice el cliente de la factura —que el recibo no puede decir—; el
      // intento sin confirmar no dejó documento.
      const docs = async (id: string) => (await send(reading("fiscal.document.list", { sale_id: id })))
        .result["documents"] as Record<string, unknown>[];
      expect((await docs(counterSale)).map((d) => [d["acquirer_kind"], d["acquirer_customer_id"], d["issued_number"]]))
        .toEqual([["IDENTIFIED", customerId, "990000001"]]);
      expect((await docs(saleId)).map((d) => [d["acquirer_kind"], d["acquirer_customer_id"]]))
        .toEqual([["IDENTIFIED", customerId]]);
      const receipt = await send(reading("sales.receipt.get", { sale_id: counterSale }));
      expect(receipt.result["customer_id"]).toBeNull();
      // Una venta sin factura: lista vacía, no un error.
      expect(await docs("018f0000-0000-7000-8000-0000000000fe")).toEqual([]);
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

/**
 * Lotes cuyo saldo no cuadra con su libro (`MIGRATION_030`): la cantidad de un
 * lote tiene que ser siempre entradas menos salidas. Vacío es que cuadra.
 */
function lotLedgerMismatches(database: LocalDatabase): string[] {
  const rows = database.native.prepare(
    `SELECT l.lot_code, l.quantity_on_hand,
            COALESCE(SUM(CASE a.direction WHEN 'IN' THEN CAST(a.quantity AS REAL) ELSE 0 END), 0) AS entered,
            COALESCE(SUM(CASE a.direction WHEN 'OUT' THEN CAST(a.quantity AS REAL) ELSE 0 END), 0) AS left_
       FROM inventory_lot l
       LEFT JOIN inventory_lot_allocation a ON a.tenant_id=l.tenant_id AND a.lot_id=l.id
      GROUP BY l.tenant_id, l.id`,
  ).all() as { lot_code: string; quantity_on_hand: string; entered: number; left_: number }[];
  return rows
    .filter((row) => Math.abs(Number(row.quantity_on_hand) - (row.entered - row.left_)) > 1e-9)
    .map((row) => `${row.lot_code}: saldo ${row.quantity_on_hand}, libro ${String(row.entered - row.left_)}`);
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

/**
 * Conversión entre presentaciones — `DEC-004` §1736.
 *
 * El caso real: el tendero compra pacas de 12 y vende unidades. Hasta aquí
 * podía declarar las dos presentaciones (`catalog.presentation.add`), pero
 * abrir una paca exigía dos ajustes de existencia a mano, que es un rastro que
 * no dice qué pasó y que `D-21` señala como abusable.
 */
describe("la conversión abre una paca y la convierte en unidades", () => {
  async function twoPresentations(
    send: (request: unknown) => Promise<ChannelResponse>,
    database: LocalDatabase,
    suffix: string,
  ): Promise<{ productId: string; unitId: string; packId: string }> {
    const { presentationId: unitId, productId } = await prepareCounter(send, database, suffix);
    const added = await send(mutating("catalog.presentation.add", {
      product_id: productId, name: "Paca x12", unit_code: "PACA", unit_precision: 0,
      barcode: null, price_amount: "180000.000000", currency_code: "COP",
    }, `${suffix}:pack`));
    return { productId, unitId, packId: added.result["presentation_id"] as string };
  }

  function declare(
    send: (request: unknown) => Promise<ChannelResponse>,
    ids: { productId: string; unitId: string; packId: string },
    key: string,
    factor = "12.000000",
  ): Promise<ChannelResponse> {
    return send(mutating("catalog.conversion.declare", {
      product_id: ids.productId,
      source_presentation_id: ids.packId,
      target_presentation_id: ids.unitId,
      factor,
      reversible: true,
    }, key));
  }

  function apply(
    send: (request: unknown) => Promise<ChannelResponse>,
    ids: { unitId: string; packId: string },
    quantity: string,
    key: string,
  ): Promise<ChannelResponse> {
    return send(mutating("inventory.conversion.apply", {
      source_presentation_id: ids.packId,
      target_presentation_id: ids.unitId,
      source_quantity: quantity,
      reason_code: "BREAK_PACK",
      business_date: "2026-09-03",
    }, key));
  }

  /**
   * Abrir una paca es una salida de la paca: si no bajara de su lote, la
   * tanda seguiría contando pacas que ya se volvieron unidades.
   */
  it("abrir pacas descuenta de los lotes de la paca por FEFO", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnvlot");
      expect((await declare(send, ids, "cnvlot:decl")).result["outcome"]).toBe("DECLARED");
      for (const [code, quantity, expiry, received] of [
        ["PK-TARDIA", "3.000000", "2026-10-30", "2026-08-30"],
        ["PK-PRONTO", "2.000000", "2026-09-20", "2026-09-01"],
      ] as const) {
        const r = await send(mutating("inventory.lot.receive", {
          presentation_id: ids.packId, lot_code: code, quantity,
          manufactured_date: null, expiry_date: expiry,
          reason_code: "SUPPLIER_DELIVERY", business_date: received,
        }, `cnvlot:${code}`));
        expect(r.result["outcome"]).toBe("RECEIVED");
      }

      expect((await apply(send, ids, "3.000000", "cnvlot:apply")).result["outcome"]).toBe("CONVERTED");
      const again = await apply(send, ids, "3.000000", "cnvlot:apply");
      expect(again.result["outcome"]).toBe("IDEMPOTENT");

      const lots = Object.fromEntries((database.native.prepare(
        "SELECT lot_code, quantity_on_hand, status FROM inventory_lot WHERE presentation_id=?",
      ).all(ids.packId) as { lot_code: string; quantity_on_hand: string; status: string }[])
        .map((r) => [r.lot_code, `${r.quantity_on_hand}/${r.status}`]));
      // La que vence antes se agota primero; repetir no descuenta otra vez.
      expect(lots).toEqual({ "PK-PRONTO": "0.000000/CONSUMED", "PK-TARDIA": "2.000000/ACTIVE" });
      expect(countOf(
        database,
        `SELECT COUNT(*) n FROM inventory_lot_allocation a
           JOIN inventory_movement m ON m.tenant_id=a.tenant_id AND m.id=a.movement_id
          WHERE m.movement_type='CONVERSION_OUT' AND a.sale_id IS NULL`,
      )).toBe(2);

      // Las 36 unidades heredan su tanda: 2 pacas de PK-PRONTO son 24
      // unidades de PK-PRONTO, y 1 de PK-TARDIA son 12. Con las mismas fechas,
      // y la repetición IDEMPOTENT no hereda otra vez.
      const unitLots = database.native.prepare(
        `SELECT lot_code, quantity_on_hand, expiry_date, received_date, origin_lot_id
           FROM inventory_lot WHERE presentation_id=? ORDER BY lot_code`,
      ).all(ids.unitId) as {
        lot_code: string; quantity_on_hand: string; expiry_date: string;
        received_date: string; origin_lot_id: string;
      }[];
      const packLotId = (code: string): string => (database.native.prepare(
        "SELECT id FROM inventory_lot WHERE presentation_id=? AND lot_code=?",
      ).get(ids.packId, code) as { id: string }).id;
      expect(unitLots).toEqual([
        {
          lot_code: "PK-PRONTO", quantity_on_hand: "24.000000", expiry_date: "2026-09-20",
          received_date: "2026-09-01", origin_lot_id: packLotId("PK-PRONTO"),
        },
        {
          lot_code: "PK-TARDIA", quantity_on_hand: "12.000000", expiry_date: "2026-10-30",
          received_date: "2026-08-30", origin_lot_id: packLotId("PK-TARDIA"),
        },
      ]);

      // Se venden 30 unidades: por FEFO, las 24 de PK-PRONTO y 6 de PK-TARDIA.
      const venta = await send(mutating("sale.create", {
        cash_register_id: REGISTER, channel: "POS", business_date: "2026-09-03",
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{ product_id: ids.productId, presentation_id: ids.unitId, quantity: "30.000000" }],
      }, "cnvlot:venta"));
      expect(venta.status).toBe("SUCCEEDED");
      const saleId = venta.result["sale_id"] as string;
      const pago = await send(mutating("payment.register.cash", {
        sale_id: saleId, amount: venta.result["payable_amount"], tendered_amount: null,
      }, "cnvlot:pago"));
      expect(pago.result["sale_completed"]).toBe(true);

      // El retiro que empieza por la paca baja a sus unidades...
      const pack = await send(reading("inventory.lot.trace", {
        presentation_id: ids.packId, lot_code: "PK-PRONTO",
      }));
      expect(pack.result["origin_lot"]).toBeNull();
      expect(pack.result["derived_lots"]).toEqual([{
        presentation_id: ids.unitId, lot_code: "PK-PRONTO",
        quantity_on_hand: "0.000000", status: "CONSUMED",
      }]);
      // ...y ahí están las ventas que la paca, por sí sola, no mostraba.
      const units = await send(reading("inventory.lot.trace", {
        presentation_id: ids.unitId, lot_code: "PK-PRONTO",
      }));
      expect(units.result["origin_lot"]).toEqual({ presentation_id: ids.packId, lot_code: "PK-PRONTO" });
      expect((units.result["outflows"] as Record<string, unknown>[]).map(
        (o) => [o["movement_type"], o["quantity"], o["sale_id"]],
      )).toEqual([["SALE", "24.000000", saleId]]);
      expect(units.result["quantity_received"]).toBe("24.000000");
      // Recepción, apertura, herencia y venta: todos los lotes cuadran con su libro.
      expect(lotLedgerMismatches(database)).toEqual([]);
    });
  }, 60_000);

  /**
   * Abrir otra paca de la misma tanda suma al lote de unidades que ya salió
   * de ella. Pero si en las unidades ya existe ese código **con otro origen**,
   * no se fusiona: dos tandas bajo un código harían ambiguo un retiro, y lo
   * que no se puede heredar con verdad entra sin lote.
   */
  it("otra paca de la misma tanda suma a sus unidades; un código ajeno no se fusiona", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnvsum");
      expect((await declare(send, ids, "cnvsum:decl")).result["outcome"]).toBe("DECLARED");
      const receiveLot = async (presentationId: string, code: string, quantity: string) => {
        const r = await send(mutating("inventory.lot.receive", {
          presentation_id: presentationId, lot_code: code, quantity,
          manufactured_date: null, expiry_date: "2026-12-31",
          reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-01",
        }, `cnvsum:${presentationId}:${code}`));
        expect(r.result["outcome"]).toBe("RECEIVED");
      };
      await receiveLot(ids.packId, "MISMA", "3.000000");
      expect((await apply(send, ids, "1.000000", "cnvsum:1")).result["outcome"]).toBe("CONVERTED");
      expect((await apply(send, ids, "1.000000", "cnvsum:2")).result["outcome"]).toBe("CONVERTED");
      const unitLot = (code: string) => database.native.prepare(
        "SELECT quantity_on_hand, origin_lot_id IS NOT NULL AS inherited FROM inventory_lot WHERE presentation_id=? AND lot_code=?",
      ).get(ids.unitId, code);
      expect(unitLot("MISMA")).toEqual({ quantity_on_hand: "24.000000", inherited: 1 });

      // «AJENA» ya existe en las unidades, recibida directamente: otro origen.
      await receiveLot(ids.unitId, "AJENA", "5.000000");
      await receiveLot(ids.packId, "AJENA", "1.000000");
      const before = stockOf(database, ids.unitId);
      // FEFO de la paca: ambas vencen igual; sale «AJENA», que llegó el mismo día
      // y ordena antes que «MISMA» por código.
      expect((await apply(send, ids, "1.000000", "cnvsum:3")).result["outcome"]).toBe("CONVERTED");
      expect(unitLot("AJENA")).toEqual({ quantity_on_hand: "5.000000", inherited: 0 });
      // Las 12 unidades entraron al saldo, sin lote: medible, no escondido.
      expect(stockOf(database, ids.unitId)).toBe(
        `${String(Number(before.split(".")[0]) + 12)}.000000`,
      );
    });
  }, 60_000);

  it("1 paca sale y 12 unidades entran, en la misma transacción", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnv1");
      expect((await declare(send, ids, "cnv1:decl")).result["outcome"]).toBe("DECLARED");

      await send(mutating("inventory.stock.receive", {
        presentation_id: ids.packId, movement_type: "PURCHASE_RECEIPT", quantity: "3.000000",
        reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-03",
      }, "cnv1:stock"));

      const converted = await apply(send, ids, "1.000000", "cnv1:apply");
      expect(converted.status).toBe("SUCCEEDED");
      expect(converted.result["outcome"]).toBe("CONVERTED");
      expect(converted.result["source_quantity_after"]).toBe("2.000000");
      expect(converted.result["target_quantity_after"]).toBe("24.000000");

      // El efecto, donde queda escrito: 3−1 pacas y 12+12 unidades.
      expect(stockOf(database, ids.packId)).toBe("2.000000");
      expect(stockOf(database, ids.unitId)).toBe("24.000000");

      // Y con su propio nombre, no disfrazado de traslado ni de ajuste.
      expect(countOf(
        database, "SELECT COUNT(*) n FROM inventory_movement WHERE movement_type=? AND presentation_id=?",
        "CONVERSION_OUT", ids.packId,
      )).toBe(1);
      expect(countOf(
        database, "SELECT COUNT(*) n FROM inventory_movement WHERE movement_type=? AND presentation_id=?",
        "CONVERSION_IN", ids.unitId,
      )).toBe(1);
    });
  }, 30_000);

  /**
   * La invariante de `DEC-004` §1736: no puede quedar salida sin entrada. Se
   * comprueba provocando el fallo en la **segunda** mitad y verificando que la
   * primera tampoco quedó escrita.
   */
  it("si la entrada no cabe, la salida se deshace con ella", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnv2");
      // La unidad se vende entera (`unit_precision` 0) y el factor daría media.
      expect((await declare(send, ids, "cnv2:decl", "0.500000")).result["outcome"]).toBe("DECLARED");

      await send(mutating("inventory.stock.receive", {
        presentation_id: ids.packId, movement_type: "PURCHASE_RECEIPT", quantity: "3.000000",
        reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-03",
      }, "cnv2:stock"));

      const rejectedApply = await apply(send, ids, "1.000000", "cnv2:apply");
      expect(rejectedApply.status).toBe("REJECTED");
      expect(rejectedApply.result["outcome"]).toBe("TARGET_PRECISION_EXCEEDED");
      expect(rejectedApply.result["detail_quantity"]).toBe("0.500000");

      // Ni salida ni entrada: los dos saldos intactos.
      expect(stockOf(database, ids.packId)).toBe("3.000000");
      expect(stockOf(database, ids.unitId)).toBe("12.000000");
      expect(countOf(
        database, "SELECT COUNT(*) n FROM inventory_movement WHERE movement_type IN (?,?)",
        "CONVERSION_OUT", "CONVERSION_IN",
      )).toBe(0);
    });
  }, 30_000);

  it("sin existencia en origen no convierte nada y dice cuánta hay", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnv3");
      await declare(send, ids, "cnv3:decl");

      const response = await apply(send, ids, "1.000000", "cnv3:apply");
      expect(response.result["outcome"]).toBe("INSUFFICIENT_STOCK");
      expect(response.result["detail_quantity"]).toBe("0.000000");
      expect(stockOf(database, ids.unitId)).toBe("12.000000");
    });
  }, 30_000);

  it("sin factor declarado se rechaza en vez de inventarlo", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnv4");
      await send(mutating("inventory.stock.receive", {
        presentation_id: ids.packId, movement_type: "PURCHASE_RECEIPT", quantity: "3.000000",
        reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-03",
      }, "cnv4:stock"));

      const response = await apply(send, ids, "1.000000", "cnv4:apply");
      expect(response.status).toBe("REJECTED");
      expect(response.result["outcome"]).toBe("CONVERSION_NOT_DECLARED");
      expect(stockOf(database, ids.packId)).toBe("3.000000");
    });
  }, 30_000);

  it("repetir la conversión es IDEMPOTENT y no mueve los saldos dos veces", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnv5");
      await declare(send, ids, "cnv5:decl");
      await send(mutating("inventory.stock.receive", {
        presentation_id: ids.packId, movement_type: "PURCHASE_RECEIPT", quantity: "3.000000",
        reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-03",
      }, "cnv5:stock"));

      expect((await apply(send, ids, "1.000000", "cnv5:apply")).result["outcome"]).toBe("CONVERTED");
      const repeat = await apply(send, ids, "1.000000", "cnv5:apply");
      expect(repeat.result["outcome"]).toBe("IDEMPOTENT");

      expect(stockOf(database, ids.packId)).toBe("2.000000");
      expect(stockOf(database, ids.unitId)).toBe("24.000000");
    });
  }, 30_000);

  it("no admite dos factores vigentes para el mismo par y dice cuál manda", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await twoPresentations(send, database, "cnv6");
      const first = await declare(send, ids, "cnv6:decl");
      const second = await declare(send, ids, "cnv6:decl2", "24.000000");

      expect(second.status).toBe("REJECTED");
      expect(second.result["outcome"]).toBe("CONVERSION_ALREADY_DECLARED");
      expect(second.result["conversion_id"]).toBe(first.result["conversion_id"]);
    });
  }, 30_000);

  it("rechaza declarar entre presentaciones de productos distintos", async () => {
    await withRealChannel(async (send, database) => {
      const first = await twoPresentations(send, database, "cnv7");
      // Un segundo producto de verdad. `prepareCounter` no sirve dos veces en
      // la misma base: usa un código de barras constante y la segunda llamada
      // chocaría devolviendo la presentación del primero.
      const otherProduct = await send(mutating("catalog.product.register", {
        code: "OTRO-CNV7", name: "Otro producto", stock_controlled: true,
        presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
        barcode: "7709000000077", price_amount: "1000.000000", currency_code: "COP",
      }, "cnv7:other"));
      expect(otherProduct.result["outcome"]).toBe("REGISTERED");

      const response = await send(mutating("catalog.conversion.declare", {
        product_id: first.productId,
        source_presentation_id: first.packId,
        target_presentation_id: otherProduct.result["presentation_id"],
        factor: "12.000000",
        reversible: false,
      }, "cnv7:decl"));

      expect(response.status).toBe("REJECTED");
      expect(response.result["outcome"]).toBe("PRESENTATIONS_NOT_SAME_PRODUCT");
    });
  }, 30_000);
});

/**
 * Venta por peso — avícola, carnicería, embutidos, fruver.
 *
 * ## Por qué esta prueba, y por qué en gramos
 *
 * Es el negocio prioritario, y su operación entera es peso. Medido el
 * 2026-09-22 por este mismo socket, hay **dos formas de modelarlo y sólo una
 * llega hasta la factura**:
 *
 * - **Kilogramo con decimales.** `unit_precision: 3` deja vender 2.355 kg, la
 *   venta se completa y el inventario baja bien — y la factura se detiene en
 *   `PAYLOAD_ASSEMBLY_BLOCKED` con
 *   `AMOUNT_NOT_REPRESENTABLE / QUANTITY_EXCEEDS_PROVIDER_PRECISION`. Es
 *   `D-18`, y es fail-closed correcto: más vale no facturar que declarar una
 *   cantidad falsa. Con `unit_precision: 2` factura, pero 10 g de granularidad
 *   no es lo que marca una balanza.
 * - **Gramo entero.** `unit_code: "GRM"`, `unit_precision: 0`, precio por
 *   gramo. La cantidad es un entero, así que no hay precisión que exceder, y
 *   la cadena llega entera hasta el CUFE.
 *
 * Esta prueba fija la segunda, que es la que un mostrador puede usar hoy.
 *
 * ## Lo que NO demuestra, y hay que decirlo
 *
 * El `unit_measure_code` que viaja en la factura es `94` = **«Unidad»**, que
 * es falso para un producto por peso. `UNIT_MEASURE_CODES` sólo tiene ese
 * código verificado (`D-9`, tablas parciales a propósito), y declarar el real
 * se rechaza con `UNIT_MEASURE_CODE_NOT_VERIFIED` — comprobado. Falta la
 * fuente documental de la DIAN, que no es código.
 *
 * El proveedor está sustituido por el desenlace del arnés: esto demuestra que
 * el payload se **ensambla** y la cadena local llega al final, no que FACTUS
 * lo acepte. Eso es `F6`.
 */
describe("venta por peso: el mostrador de una avicola, de la balanza a la factura", () => {
  it("vende 2355 g, cobra, descuenta al gramo y emite", async () => {
    await withRealFiscalChannel({
      kind: "EVIDENCED", transportStatus: "COMPLETED", normalizedResult: "ACCEPTED",
      externalIdentity: { providerOperationId: "op", providerDocumentId: null, prefix: "SETP", number: "990000001", cufe: "b".repeat(96) },
      providerStatus: { providerCode: "0", providerStatus: "processed", httpStatus: 200 },
    }, async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER, opening_amount: "0.000000", business_date: "2026-09-03",
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
      }, "peso:shift"));

      const cliente = await send(mutating("customer.register", {
        identification_document_code: "13", identification: "1020304050",
        verification_digit: null, legal_organization_code: "2", company: null,
        names: "Cliente Avicola", tribute_code: "ZZ", fiscal_responsibility_codes: ["R-99-PN"],
        email: null, phone: null, address: null, country_code: null, municipality_code: null,
      }, "peso:cliente"));

      // 12.000 COP/kg expresado por gramo. Cualquier precio entero por kilo
      // cabe en la escala 6 al dividirlo entre mil, asi que la conversion es
      // exacta y no hay redondeo escondido en el precio.
      const pollo = await send(mutating("catalog.product.register", {
        code: "POLLO-ENTERO", name: "Pollo entero fresco", stock_controlled: true,
        presentation_name: "Gramo", unit_code: "GRM", unit_precision: 0,
        barcode: "7701234567003", price_amount: "12.000000", currency_code: "COP",
      }, "peso:catalogo"));
      expect(pollo.result["outcome"]).toBe("REGISTERED");
      const presentationId = pollo.result["presentation_id"] as string;

      expect((await declareFiscalAttribute(send, presentationId, "peso:attr")).result["outcome"]).toBe("SET");
      seedFiscalRange(database);
      const productId = (await send(reading("catalog.item.find", { barcode: "7701234567003" })))
        .result["product_id"] as string;

      // 20 kg de pollo en la nevera.
      await send(mutating("inventory.stock.receive", {
        presentation_id: presentationId, movement_type: "PURCHASE_RECEIPT",
        quantity: "20000.000000", reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-03",
      }, "peso:inventario"));

      // La balanza marca 2.355 kg.
      const venta = await send(mutating("sale.create", {
        // La venta nombra al cliente que se va a facturar (`D-40`): sin eso,
        // la emisión se detendría pidiendo confirmar la diferencia.
        customer_id: cliente.result["customer_id"],
        cash_register_id: REGISTER, channel: "POS", business_date: "2026-09-03",
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{ product_id: productId, presentation_id: presentationId, quantity: "2355.000000" }],
      }, "peso:venta"));
      expect(venta.status).toBe("SUCCEEDED");

      // 2355 x 12 = 28.260 de base. Con IVA 19% son 33.629,40, y lo que se
      // cobra es 33.650: `nearestFiftyHalfAwayFromZero` redondea a 50 pesos y
      // guarda la diferencia como ajuste comercial, sin tocar el total fiscal.
      expect(venta.result["payable_amount"]).toBe("33650.000000");

      const saleId = venta.result["sale_id"] as string;
      const pago = await send(mutating("payment.register.cash", {
        sale_id: saleId, amount: "33650.000000", tendered_amount: null,
      }, "peso:pago"));
      expect(pago.result["sale_completed"]).toBe(true);

      // **Al gramo.** 20000 - 2355 = 17645. Si el inventario de un producto
      // por peso se redondeara, el descuadre se acumularia venta a venta.
      expect(stockOf(database, presentationId)).toBe("17645.000000");

      const factura = await send(mutating("fiscal.document.issue", {
        sale_id: saleId, document_type: "SALES_INVOICE",
        customer: { kind: "IDENTIFIED", customer_id: cliente.result["customer_id"] }, observation: null,
      }, "peso:factura"));
      expect(factura.status).toBe("SUCCEEDED");
      expect(factura.result["outcome"]).toBe("ISSUED");
      expect(factura.result["cufe"]).toBe("b".repeat(96));
    });
  }, 60_000);
});

/**
 * Lotes y vencimiento por el canal real — `UC-INVENTORY-002` §Lotes.
 *
 * Es lo que una carnicería necesita para acotar un retiro sanitario: saber de
 * qué tanda salió cada cosa y qué está vencido antes de venderlo.
 *
 * **Lo que este tramo NO hace, y se dice aquí para que no se lea de más:** la
 * venta todavía **no consume lotes por FEFO**. Declarar la tanda y verla ya
 * sirve —la mitad del valor sanitario es ver qué vence—, pero el rastro de
 * venta a lote es el tramo siguiente.
 */
describe("lotes y vencimiento: declarar la tanda y ver que vence primero", () => {
  it("recibe dos tandas, las ordena por vencimiento y marca la vencida", async () => {
    await withRealChannel(async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));

      const carne = await send(mutating("catalog.product.register", {
        code: "RES-MOLIDA", name: "Carne molida de res", stock_controlled: true,
        presentation_name: "Gramo", unit_code: "GRM", unit_precision: 0,
        barcode: "7705555000001", price_amount: "22.000000", currency_code: "COP",
      }, "lote:catalogo"));
      const presentationId = carne.result["presentation_id"] as string;

      // **El orden de llegada y el de vencimiento tienen que discrepar**, o la
      // prueba pasaria por coincidencia. Se comprobo: con los tres recibidos
      // en fechas que coincidian con su vencimiento, ordenar por llegada daba
      // el mismo resultado que FEFO y la prueba seguia verde con el ORDER BY
      // equivocado.
      //
      // Aqui la tanda que vence MAS TARDE es la que llego PRIMERO, y ademas su
      // codigo ordena antes alfabeticamente: ni por llegada ni por nombre sale
      // el orden correcto.
      const tardia = await send(mutating("inventory.lot.receive", {
        presentation_id: presentationId, lot_code: "A-VENCE-TARDE",
        quantity: "5000.000000", manufactured_date: "2026-09-09",
        expiry_date: "2026-12-31", reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-10",
      }, "lote:tardia"));
      expect(tardia.status).toBe("SUCCEEDED");
      expect(tardia.result["outcome"]).toBe("RECEIVED");
      expect(tardia.result["lot_quantity_on_hand"]).toBe("5000.000000");

      const proxima = await send(mutating("inventory.lot.receive", {
        presentation_id: presentationId, lot_code: "Z-VENCE-PRONTO",
        quantity: "3000.000000", manufactured_date: null,
        expiry_date: "2026-09-24", reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-22",
      }, "lote:proxima"));
      expect(proxima.result["outcome"]).toBe("RECEIVED");

      // Una tanda que ya vencio. **Se recibe con fecha del 15**, no de hoy: el
      // esquema rechaza recibir algo que vencio antes de recibirse, y tiene
      // razon — eso no es una tanda vieja, es una fecha mal capturada. Vencio
      // el 18 y hoy es 22, que es como se vence de verdad: con el tiempo.
      const vencida = await send(mutating("inventory.lot.receive", {
        presentation_id: presentationId, lot_code: "M-YA-VENCIDA",
        quantity: "1000.000000", manufactured_date: null,
        expiry_date: "2026-09-18", reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-15",
      }, "lote:vencida"));
      expect(vencida.result["outcome"]).toBe("RECEIVED");

      // La existencia total es la suma: el lote no sustituye al saldo, lo detalla.
      expect(stockOf(database, presentationId)).toBe("9000.000000");

      const lista = await send(reading("inventory.lot.list", {
        presentation_id: presentationId, business_date: "2026-09-22",
      }));
      expect(lista.status).toBe("SUCCEEDED");
      const lotes = lista.result["lots"] as { lot_code: string; expiry_state: string }[];

      // **FEFO**: por vencimiento, no por llegada ni por nombre.
      //   llegada    : A-VENCE-TARDE (10), M-YA-VENCIDA (15), Z-VENCE-PRONTO (22)
      //   alfabetico : A-VENCE-TARDE, M-YA-VENCIDA, Z-VENCE-PRONTO
      //   vencimiento: M (18 sep), Z (24 sep), A (31 dic)   <- este
      expect(lotes.map((l) => l.lot_code)).toEqual([
        "M-YA-VENCIDA", "Z-VENCE-PRONTO", "A-VENCE-TARDE",
      ]);
      // Z vence el 24 y hoy es 22: dentro de los 7 días de «próximo a vencer»
      // (decisión del propietario del 2026-09-26; hasta ese día salía VALID).
      expect(lotes.map((l) => l.expiry_state)).toEqual(["EXPIRED", "NEAR_EXPIRY", "VALID"]);
      expect(lista.result["near_expiry_days"]).toBe(7);
    });
  }, 60_000);

  it("recibir el mismo codigo con otras fechas se rechaza en vez de fusionar", async () => {
    await withRealChannel(async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));

      const p = await send(mutating("catalog.product.register", {
        code: "POLLO-L", name: "Pollo", stock_controlled: true,
        presentation_name: "Gramo", unit_code: "GRM", unit_precision: 0,
        barcode: "7705555000002", price_amount: "12.000000", currency_code: "COP",
      }, "conf:catalogo"));
      const presentationId = p.result["presentation_id"] as string;

      const base = {
        presentation_id: presentationId, lot_code: "MISMA-TANDA",
        quantity: "1000.000000", manufactured_date: null,
        reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-22",
      };
      expect((await send(mutating("inventory.lot.receive", {
        ...base, expiry_date: "2026-09-30",
      }, "conf:1"))).result["outcome"]).toBe("RECEIVED");

      // Segunda remesa de la MISMA tanda: suma.
      const suma = await send(mutating("inventory.lot.receive", {
        ...base, expiry_date: "2026-09-30",
      }, "conf:2"));
      expect(suma.result["outcome"]).toBe("RECEIVED");
      expect(suma.result["lot_quantity_on_hand"]).toBe("2000.000000");

      // Mismo codigo, OTRO vencimiento: son dos tandas distintas bajo un mismo
      // nombre. Fusionarlas haria ambiguo un retiro sanitario.
      const choque = await send(mutating("inventory.lot.receive", {
        ...base, expiry_date: "2026-10-15",
      }, "conf:3"));
      expect(choque.status).toBe("REJECTED");
      expect(choque.result["outcome"]).toBe("LOT_CODE_CONFLICT");
      // Dice con qué fechas existe ya, para corregir la captura sin buscarlas.
      expect(choque.result["conflicting_lot"]).toEqual({
        where: "SAME_BRANCH", manufactured_date: null, expiry_date: "2026-09-30",
      });
      expect(suma.result["conflicting_lot"]).toBeNull();
      // Conflicto con el estado, no un fallo del servicio.
      expect(choque.error?.category).toBe("CONFLICT");
      // Y no toco nada: ni el lote ni la existencia.
      expect(stockOf(database, presentationId)).toBe("2000.000000");

      /**
       * Fechas incoherentes: vence antes de recibirse. El `CHECK` del lote lo
       * rechaza **después** de escrito el movimiento de entrada; si el
       * rechazo no deshace la transacción, la existencia sube sin lote.
       * Medido el 2026-09-26: subía.
       */
      const fechas = await send(mutating("inventory.lot.receive", {
        ...base, lot_code: "FECHAS-MAL", business_date: "2026-09-22", expiry_date: "2026-09-20",
      }, "conf:4"));
      expect(fechas.status).toBe("REJECTED");
      expect(fechas.result["outcome"]).toBe("LOT_DATES_INVALID");
      expect(fechas.error?.category).toBe("VALIDATION");
      expect(stockOf(database, presentationId)).toBe("2000.000000");
      expect(countOf(
        database, "SELECT COUNT(*) n FROM inventory_movement WHERE idempotency_key LIKE '%conf:4%'",
      )).toBe(0);
    });
  }, 60_000);
});

/**
 * Carga inicial del catálogo — `catalog.item.import`.
 *
 * ## Qué mide, y por qué importa más que parecer
 *
 * Poner **un** artículo vendible y facturable costaba tres operaciones de una
 * en una. Un minimercado tiene miles de referencias: son diez o quince mil
 * capturas antes de vender la primera gaseosa. Eso, y no el motor, es lo que
 * impide estrenar un POS.
 *
 * La prueba **no se conforma con que la carga responda `COMPLETED`**: coge un
 * artículo cargado y lo vende y lo factura por la cadena real. Un importador
 * que deja artículos que no se pueden vender habría pasado cualquier prueba
 * que sólo mirase su propia respuesta.
 */
describe("carga inicial: del fichero del comerciante a una venta facturada", () => {
  it("importa un lote mixto, y lo importado se vende y se factura", async () => {
    await withRealFiscalChannel({
      kind: "EVIDENCED", transportStatus: "COMPLETED", normalizedResult: "ACCEPTED",
      externalIdentity: { providerOperationId: "op", providerDocumentId: null, prefix: "SETP", number: "990000001", cufe: "b".repeat(96) },
      providerStatus: { providerCode: "0", providerStatus: "processed", httpStatus: 200 },
    }, async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
      await send(mutating("cash.shift.open", {
        cash_register_id: REGISTER, opening_amount: "0.000000", business_date: "2026-09-22",
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
      }, "imp:shift"));

      const fiscal = {
        code_reference: "REF-IMPORT", unit_measure_code: "94",
        standard_code: "999", tax_code: "01", tax_rate: "19.000000",
      };
      const carga = await send(mutating("catalog.item.import", {
        business_date: "2026-09-22",
        reason_code: "INITIAL_COUNT",
        items: [
          // Completo: con existencia y con códigos fiscales. Se vende y factura.
          {
            code: "ARROZ-500", name: "Arroz 500 g", stock_controlled: true,
            presentation_name: "Bolsa 500 g", unit_code: "UND", unit_precision: 0,
            barcode: "7709000000101", price_amount: "3200.000000", currency_code: "COP",
            initial_quantity: "40.000000", fiscal,
          },
          // Sin existencia: ficha creada, todavía no llegó. Estado legítimo.
          {
            code: "PANELA-1K", name: "Panela 1 kg", stock_controlled: true,
            presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
            barcode: "7709000000102", price_amount: "5500.000000", currency_code: "COP",
            initial_quantity: null, fiscal,
          },
          // Sin códigos fiscales: se vende y **no se factura**, fail-closed.
          {
            code: "BOLSA-EMP", name: "Bolsa de empaque", stock_controlled: false,
            presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
            barcode: "7709000000103", price_amount: "200.000000", currency_code: "COP",
            initial_quantity: null, fiscal: null,
          },
        ],
      }, "imp:carga"));

      expect(carga.status).toBe("SUCCEEDED");
      expect(carga.result["outcome"]).toBe("COMPLETED");
      expect(carga.result["imported"]).toBe(3);
      expect(carga.result["rejected"]).toEqual([]);

      // La existencia inicial entró como `OPENING_COUNT`, que es lo que es: un
      // conteo de apertura, no una compra que nadie hizo.
      const arroz = await send(reading("catalog.item.find", { barcode: "7709000000101" }));
      const presentationId = arroz.result["presentation_id"] as string;
      expect(stockOf(database, presentationId)).toBe("40.000000");
      expect(countOf(
        database,
        "SELECT COUNT(*) n FROM inventory_movement WHERE presentation_id=? AND movement_type='OPENING_COUNT'",
        presentationId,
      )).toBe(1);

      // La panela existe sin existencia: distinguible de «se agotó».
      expect((await send(reading("catalog.item.find", { barcode: "7709000000102" }))).status)
        .toBe("SUCCEEDED");

      // **Lo cargado se vende y se factura.** Es la única afirmación que vale.
      seedFiscalRange(database);
      const cliente = await send(mutating("customer.register", {
        identification_document_code: "13", identification: "1020304050",
        verification_digit: null, legal_organization_code: "2", company: null,
        names: "Cliente Minimercado", tribute_code: "ZZ",
        fiscal_responsibility_codes: ["R-99-PN"],
        email: null, phone: null, address: null, country_code: null, municipality_code: null,
      }, "imp:cliente"));

      const venta = await send(mutating("sale.create", {
        // La venta nombra al cliente que se va a facturar (`D-40`): sin eso,
        // la emisión se detendría pidiendo confirmar la diferencia.
        customer_id: cliente.result["customer_id"],
        cash_register_id: REGISTER, channel: "POS", business_date: "2026-09-22",
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{
          product_id: arroz.result["product_id"], presentation_id: presentationId,
          quantity: "2.000000",
        }],
      }, "imp:venta"));
      expect(venta.status).toBe("SUCCEEDED");

      const saleId = venta.result["sale_id"] as string;
      const pago = await send(mutating("payment.register.cash", {
        sale_id: saleId, amount: venta.result["payable_amount"] as string, tendered_amount: null,
      }, "imp:pago"));
      expect(pago.result["sale_completed"]).toBe(true);
      expect(stockOf(database, presentationId)).toBe("38.000000");

      const factura = await send(mutating("fiscal.document.issue", {
        sale_id: saleId, document_type: "SALES_INVOICE",
        customer: { kind: "IDENTIFIED", customer_id: cliente.result["customer_id"] },
        observation: null,
      }, "imp:factura"));
      expect(factura.result["outcome"]).toBe("ISSUED");
    });
  }, 60_000);

  /**
   * Una fila mala no puede llevarse por delante a las buenas: es la diferencia
   * entre corregir una línea y reimportar cinco mil a ciegas.
   */
  it("una fila con codigo de barras repetido no descarta las demas", async () => {
    await withRealChannel(async (send, database) => {
      new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
        signAuthorization(authorizationClaims()),
        { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
      );
      seedRegister(database);
      await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));

      // Ya existe un articulo con ese codigo de barras.
      await send(mutating("catalog.product.register", {
        code: "PREEXISTENTE", name: "Ya estaba", stock_controlled: true,
        presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
        barcode: "7709000000201", price_amount: "1000.000000", currency_code: "COP",
      }, "choque:previo"));

      const carga = await send(mutating("catalog.item.import", {
        business_date: "2026-09-22", reason_code: "INITIAL_COUNT",
        items: [
          {
            code: "BUENA-1", name: "Buena 1", stock_controlled: true,
            presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
            barcode: "7709000000301", price_amount: "1000.000000", currency_code: "COP",
            initial_quantity: "5.000000", fiscal: null,
          },
          {
            code: "CHOCA", name: "Choca con el previo", stock_controlled: true,
            presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
            barcode: "7709000000201", price_amount: "1000.000000", currency_code: "COP",
            initial_quantity: "5.000000", fiscal: null,
          },
          {
            code: "BUENA-2", name: "Buena 2", stock_controlled: true,
            presentation_name: "Unidad", unit_code: "UND", unit_precision: 0,
            barcode: "7709000000302", price_amount: "1000.000000", currency_code: "COP",
            initial_quantity: "5.000000", fiscal: null,
          },
        ],
      }, "choque:carga"));

      expect(carga.status).toBe("SUCCEEDED");
      expect(carga.result["imported"]).toBe(2);
      expect(carga.result["rejected"]).toEqual([
        { index: 1, code: "CHOCA", outcome: "BARCODE_ALREADY_REGISTERED" },
      ]);

      // **La fila posterior a la mala tambien entro**: el lote no se corta.
      expect((await send(reading("catalog.item.find", { barcode: "7709000000302" }))).status)
        .toBe("SUCCEEDED");
    });
  }, 60_000);
});

/**
 * De qué lote salió cada venta — `MIGRATION_027`, `UC-INVENTORY-002`.
 *
 * El escenario está construido para que **sólo FEFO sobre lotes vigentes**
 * dé el resultado correcto. Hay una tanda vencida (vence antes que todas: un
 * FEFO que no filtrara vencidos la tomaría primero), una que vence pronto y
 * llegó tarde, y otra que vence tarde y llegó primero (un FIFO por llegada la
 * tomaría primero).
 */
describe("trazabilidad de venta a lote: FEFO sobre lotes vigentes", () => {
  async function counter(
    send: (request: unknown) => Promise<ChannelResponse>,
    database: LocalDatabase,
    suffix: string,
  ): Promise<{ productId: string; presentationId: string }> {
    new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
      signAuthorization(authorizationClaims()),
      { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
    );
    seedRegister(database);
    await send(reading("session.activate", { session_assertion: signSession(sessionClaims()) }));
    await send(mutating("cash.shift.open", {
      cash_register_id: REGISTER, opening_amount: "0.000000", business_date: "2026-09-22",
      timezone_id: "America/Bogota", utc_offset_minutes: -300,
    }, `${suffix}:shift`));
    const carne = await send(mutating("catalog.product.register", {
      code: `MOLIDA-${suffix}`, name: "Carne molida", stock_controlled: true,
      presentation_name: "Gramo", unit_code: "GRM", unit_precision: 0,
      barcode: `77066${suffix.padStart(8, "0").slice(-8)}`, price_amount: "22.000000", currency_code: "COP",
    }, `${suffix}:catalogo`));
    const presentationId = carne.result["presentation_id"] as string;
    const found = await send(reading("catalog.item.find", { barcode: `77066${suffix.padStart(8, "0").slice(-8)}` }));
    return { productId: found.result["product_id"] as string, presentationId };
  }

  async function lot(
    send: (request: unknown) => Promise<ChannelResponse>,
    presentationId: string, code: string, quantity: string, expiry: string, received: string,
  ): Promise<void> {
    const r = await send(mutating("inventory.lot.receive", {
      presentation_id: presentationId, lot_code: code, quantity,
      manufactured_date: null, expiry_date: expiry,
      reason_code: "SUPPLIER_DELIVERY", business_date: received,
    }, `lot:${code}`));
    expect(r.result["outcome"]).toBe("RECEIVED");
  }

  async function sellAndPay(
    send: (request: unknown) => Promise<ChannelResponse>,
    ids: { productId: string; presentationId: string }, grams: string, key: string,
    customerId?: string,
  ): Promise<{ saleId: string; paymentKey: string; amount: string }> {
    const venta = await send(mutating("sale.create", {
      ...(customerId === undefined ? {} : { customer_id: customerId }),
      cash_register_id: REGISTER, channel: "POS", business_date: "2026-09-22",
      timezone_id: "America/Bogota", utc_offset_minutes: -300,
      document_series: "A", currency_code: "COP",
      lines: [{ product_id: ids.productId, presentation_id: ids.presentationId, quantity: grams }],
    }, `${key}:venta`));
    expect(venta.status).toBe("SUCCEEDED");
    const saleId = venta.result["sale_id"] as string;
    const amount = venta.result["payable_amount"] as string;
    const pago = await send(mutating("payment.register.cash", {
      sale_id: saleId, amount, tendered_amount: null,
    }, `${key}:pago`));
    expect(pago.result["sale_completed"]).toBe(true);
    return { saleId, paymentKey: `${key}:pago`, amount };
  }

  function allocationsOf(database: LocalDatabase, saleId: string): Record<string, string> {
    const rows = database.native.prepare(
      `SELECT l.lot_code, a.quantity FROM inventory_lot_allocation a
         JOIN inventory_lot l ON l.tenant_id=a.tenant_id AND l.id=a.lot_id
        WHERE a.sale_id=? ORDER BY l.lot_code`,
    ).all(saleId) as { lot_code: string; quantity: string }[];
    return Object.fromEntries(rows.map((r) => [r.lot_code, r.quantity]));
  }

  function lotState(database: LocalDatabase, code: string): string {
    const row = database.native.prepare(
      "SELECT quantity_on_hand, status FROM inventory_lot WHERE lot_code=?",
    ).get(code) as { quantity_on_hand: string; status: string };
    return `${row.quantity_on_hand}/${row.status}`;
  }

  it("una venta de 1500 g sale de la tanda vigente que vence antes, y nunca de la vencida", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await counter(send, database, "fefo");
      // Vence ANTES que todas, pero ya venció: FEFO sobre vigentes la salta.
      await lot(send, ids.presentationId, "C-VENCIDA", "800.000000", "2026-09-18", "2026-09-15");
      // Llegó PRIMERO y vence tarde: un FIFO por llegada la tomaría primero.
      await lot(send, ids.presentationId, "B-TARDIA", "5000.000000", "2026-12-31", "2026-09-10");
      // Vence pronto y llegó tarde: es la que FEFO debe vaciar primero.
      await lot(send, ids.presentationId, "A-PRONTO", "1000.000000", "2026-09-24", "2026-09-22");

      const { saleId } = await sellAndPay(send, ids, "1500.000000", "fefo:1");

      // 1000 de la que vence el 24 —la agota— y 500 de la del 31 de diciembre.
      expect(allocationsOf(database, saleId)).toEqual({
        "A-PRONTO": "1000.000000",
        "B-TARDIA": "500.000000",
      });
      // La agotada no desaparece: su rastro es lo que un retiro consulta.
      expect(lotState(database, "A-PRONTO")).toBe("0.000000/CONSUMED");
      expect(lotState(database, "B-TARDIA")).toBe("4500.000000/ACTIVE");
      // La vencida, intacta: lo vencido sale por merma, no por venta.
      expect(lotState(database, "C-VENCIDA")).toBe("800.000000/ACTIVE");
      // El saldo total baja lo vendido: el lote detalla, no sustituye.
      expect(stockOf(database, ids.presentationId)).toBe("5300.000000");
      expect(lotLedgerMismatches(database)).toEqual([]);
    });
  }, 60_000);

  /**
   * Lo que ningún lote vigente cubre **no se reparte en un lote cualquiera**:
   * fabricaría un rastro falso, peor que ninguno en un retiro. Queda sin
   * asignar y es medible.
   */
  it("lo que no cubren los lotes vigentes queda sin asignar, y se puede medir", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await counter(send, database, "corto");
      // 1000 g que entraron SIN lote —conteo inicial—, y una tanda de 300 g.
      await send(mutating("inventory.stock.receive", {
        presentation_id: ids.presentationId, movement_type: "OPENING_COUNT",
        quantity: "1000.000000", reason_code: "INITIAL_COUNT", business_date: "2026-09-22",
      }, "corto:inicial"));
      await lot(send, ids.presentationId, "UNICA", "300.000000", "2026-09-30", "2026-09-22");

      const { saleId } = await sellAndPay(send, ids, "800.000000", "corto:1");

      expect(allocationsOf(database, saleId)).toEqual({ UNICA: "300.000000" });
      // La venta de 800 existe entera; 500 no tienen lote, y eso se lee así:
      const traced = database.native.prepare(
        `SELECT m.quantity AS vendido, COALESCE(SUM(CAST(REPLACE(a.quantity,'.','') AS INTEGER)),0) AS asignado
           FROM inventory_movement m
           LEFT JOIN inventory_lot_allocation a ON a.tenant_id=m.tenant_id AND a.movement_id=m.id
          WHERE m.sale_id=? GROUP BY m.id`,
      ).get(saleId) as { vendido: string; asignado: number };
      expect(traced.vendido).toBe("800.000000");
      expect(traced.asignado).toBe(300_000000);
      expect(stockOf(database, ids.presentationId)).toBe("500.000000");
    });
  }, 60_000);

  it("un producto sin lotes vende exactamente igual que antes", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await counter(send, database, "sinlote");
      await send(mutating("inventory.stock.receive", {
        presentation_id: ids.presentationId, movement_type: "OPENING_COUNT",
        quantity: "1000.000000", reason_code: "INITIAL_COUNT", business_date: "2026-09-22",
      }, "sinlote:inicial"));

      const { saleId } = await sellAndPay(send, ids, "200.000000", "sinlote:1");

      expect(allocationsOf(database, saleId)).toEqual({});
      expect(stockOf(database, ids.presentationId)).toBe("800.000000");
    });
  }, 60_000);

  /**
   * Reintentar el cobro por el canal no descuenta dos veces del lote.
   *
   * Ojo con lo que esto mide: el pago idempotente responde antes de llegar al
   * descuento de inventario, así que esta prueba cubre la capa de pagos. La
   * guarda `IDEMPOTENT` de `appendSaleDeduction` —que es la que impide asignar
   * dos veces si la finalización sí se repite— la mide `inventory.test.ts`,
   * llamando al almacén directamente. Una mutación en esa guarda no la detecta
   * esta prueba; la otra sí.
   */
  it("reintentar el mismo cobro no vuelve a asignar", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await counter(send, database, "reintento");
      await lot(send, ids.presentationId, "R1", "1000.000000", "2026-09-30", "2026-09-22");

      const { saleId, paymentKey, amount } = await sellAndPay(send, ids, "400.000000", "reintento:1");
      const retry = await send(mutating("payment.register.cash", {
        sale_id: saleId, amount, tendered_amount: null,
      }, paymentKey));
      expect(retry.status).toBe("SUCCEEDED");

      expect(allocationsOf(database, saleId)).toEqual({ R1: "400.000000" });
      expect(lotState(database, "R1")).toBe("600.000000/ACTIVE");
    });
  }, 60_000);

  it("una asignacion no se puede editar ni borrar: es un rastro sanitario", async () => {
    await withRealChannel(async (send, database) => {
      const ids = await counter(send, database, "append");
      await lot(send, ids.presentationId, "AP1", "1000.000000", "2026-09-30", "2026-09-22");
      await sellAndPay(send, ids, "100.000000", "append:1");

      expect(() => database.native.prepare(
        "UPDATE inventory_lot_allocation SET quantity='1.000000'",
      ).run()).toThrow(/append-only/);
      expect(() => database.native.prepare(
        "DELETE FROM inventory_lot_allocation",
      ).run()).toThrow(/append-only/);
    });
  }, 60_000);

  /**
   * Entradas a una tanda que ya existe (`MIGRATION_030`). Una tanda que crece
   * sin decir por qué es indistinguible de una recibida, y el ajuste es la vía
   * por la que se roba: cada entrada queda en el libro del lote con su
   * movimiento, y el rastro la muestra con su motivo.
   */
  describe("entradas a una tanda existente", () => {
    it("un ajuste positivo nombrando la tanda suma a ella, la reactiva y queda en su libro", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "apos");
        await lot(send, ids.presentationId, "AP-1", "500.000000", "2026-12-31", "2026-09-22");
        await sellAndPay(send, ids, "500.000000", "apos:1");
        expect(lotState(database, "AP-1")).toBe("0.000000/CONSUMED");

        const ajuste = await send(mutating("inventory.stock.adjust", {
          presentation_id: ids.presentationId, movement_type: "ADJUSTMENT_POSITIVE",
          quantity: "30.000000", reason_code: "COUNT_CORRECTION", business_date: "2026-09-22",
          lot_code: "AP-1",
        }, "apos:ajuste"));
        expect(ajuste.result["outcome"]).toBe("POSTED");
        expect(lotState(database, "AP-1")).toBe("30.000000/ACTIVE");

        // Reactivada, la siguiente venta la toma por FEFO.
        const { saleId } = await sellAndPay(send, ids, "20.000000", "apos:2");
        expect(allocationsOf(database, saleId)).toEqual({ "AP-1": "20.000000" });

        const trace = await send(reading("inventory.lot.trace", {
          presentation_id: ids.presentationId, lot_code: "AP-1",
        }));
        expect((trace.result["inflows"] as Record<string, unknown>[]).map(
          (i) => [i["movement_type"], i["quantity"], i["reason_code"]],
        )).toEqual([
          ["PURCHASE_RECEIPT", "500.000000", "SUPPLIER_DELIVERY"],
          ["ADJUSTMENT_POSITIVE", "30.000000", "COUNT_CORRECTION"],
        ]);
        expect(trace.result["quantity_received"]).toBe("530.000000");
        expect(lotLedgerMismatches(database)).toEqual([]);

        // Repetir el mismo ajuste es IDEMPOTENT y no vuelve a sumar.
        const repeat = await send(mutating("inventory.stock.adjust", {
          presentation_id: ids.presentationId, movement_type: "ADJUSTMENT_POSITIVE",
          quantity: "30.000000", reason_code: "COUNT_CORRECTION", business_date: "2026-09-22",
          lot_code: "AP-1",
        }, "apos:ajuste"));
        expect(repeat.result["outcome"]).toBe("IDEMPOTENT");
        expect(lotState(database, "AP-1")).toBe("10.000000/ACTIVE");
        expect(lotLedgerMismatches(database)).toEqual([]);
      });
    }, 60_000);

    it("un ajuste positivo a una tanda que no existe es LOT_NOT_FOUND y no mueve el saldo", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "aposnf");
        await lot(send, ids.presentationId, "AN-1", "100.000000", "2026-12-31", "2026-09-22");
        const ajuste = await send(mutating("inventory.stock.adjust", {
          presentation_id: ids.presentationId, movement_type: "ADJUSTMENT_POSITIVE",
          quantity: "30.000000", reason_code: "COUNT_CORRECTION", business_date: "2026-09-22",
          lot_code: "NO-EXISTE",
        }, "aposnf:ajuste"));
        expect(ajuste.status).toBe("REJECTED");
        expect(ajuste.result["outcome"]).toBe("LOT_NOT_FOUND");
        expect(stockOf(database, ids.presentationId)).toBe("100.000000");
        expect(countOf(
          database, "SELECT COUNT(*) n FROM inventory_movement WHERE movement_type='ADJUSTMENT_POSITIVE'",
        )).toBe(0);
      });
    }, 60_000);

    /**
     * Medido el 2026-09-26: una remesa sobre una tanda agotada sumaba la
     * cantidad y la dejaba en `CONSUMED`. FEFO sólo toma `ACTIVE`, así que
     * esa existencia no se vendía nunca desde el lote.
     */
    it("una remesa sobre una tanda agotada la reactiva y la venta vuelve a tomarla", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "remesa");
        await lot(send, ids.presentationId, "RM-1", "100.000000", "2026-12-31", "2026-09-22");
        await sellAndPay(send, ids, "100.000000", "remesa:1");
        expect(lotState(database, "RM-1")).toBe("0.000000/CONSUMED");

        const again = await send(mutating("inventory.lot.receive", {
          presentation_id: ids.presentationId, lot_code: "RM-1", quantity: "40.000000",
          manufactured_date: null, expiry_date: "2026-12-31",
          reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-22",
        }, "remesa:2"));
        expect(again.result["outcome"]).toBe("RECEIVED");
        expect(lotState(database, "RM-1")).toBe("40.000000/ACTIVE");

        const { saleId } = await sellAndPay(send, ids, "15.000000", "remesa:3");
        expect(allocationsOf(database, saleId)).toEqual({ "RM-1": "15.000000" });
        expect(lotLedgerMismatches(database)).toEqual([]);
      });
    }, 60_000);
  });

  /**
   * Lo que vence esta semana, en todo el negocio — `inventory.lot.expiring`.
   * La pregunta de cada mañana: qué vender primero y qué sacar por merma.
   */
  describe("lo que vence esta semana", () => {
    it("lista las tandas con existencia vencidas o a 7 días o menos, de todos los productos", async () => {
      await withRealChannel(async (send, database) => {
        const carne = await counter(send, database, "vence");
        const pollo = await send(mutating("catalog.product.register", {
          code: "POLLO-VENCE", name: "Pechuga de pollo", stock_controlled: true,
          presentation_name: "Gramo", unit_code: "GRM", unit_precision: 0,
          barcode: "7706600000017", price_amount: "18.000000", currency_code: "COP",
        }, "vence:pollo"));
        const polloId = pollo.result["presentation_id"] as string;

        await lot(send, carne.presentationId, "V-VENCIDA", "800.000000", "2026-09-18", "2026-09-15");
        await lot(send, carne.presentationId, "V-HOY", "300.000000", "2026-09-22", "2026-09-20");
        await lot(send, carne.presentationId, "V-DIA7", "400.000000", "2026-09-29", "2026-09-20");
        await lot(send, carne.presentationId, "V-DIA8", "500.000000", "2026-09-30", "2026-09-20");
        await lot(send, carne.presentationId, "V-AGOTADA", "100.000000", "2026-09-23", "2026-09-20");
        await lot(send, polloId, "P-JUEVES", "900.000000", "2026-09-25", "2026-09-20");
        // Sin vencimiento declarado: no compite por salir.
        expect((await send(mutating("inventory.lot.receive", {
          presentation_id: carne.presentationId, lot_code: "V-SIN-FECHA", quantity: "50.000000",
          manufactured_date: null, expiry_date: null,
          reason_code: "SUPPLIER_DELIVERY", business_date: "2026-09-20",
        }, "vence:sinfecha"))).result["outcome"]).toBe("RECEIVED");
        // Agotada por merma: no hay nada que vender ni que botar.
        expect((await send(mutating("inventory.stock.adjust", {
          presentation_id: carne.presentationId, movement_type: "SHRINKAGE",
          quantity: "100.000000", reason_code: "DAMAGED", business_date: "2026-09-22",
          lot_code: "V-AGOTADA",
        }, "vence:merma"))).result["outcome"]).toBe("POSTED");

        const semana = await send(reading("inventory.lot.expiring", { business_date: "2026-09-22" }));
        expect(semana.status).toBe("SUCCEEDED");
        expect(semana.result["near_expiry_days"]).toBe(7);
        expect(semana.result["truncated"]).toBe(false);
        const lots = semana.result["lots"] as Record<string, unknown>[];
        expect(lots.map((l) => [l["lot_code"], l["expiry_state"], l["quantity_on_hand"]])).toEqual([
          ["V-VENCIDA", "EXPIRED", "800.000000"],
          ["V-HOY", "NEAR_EXPIRY", "300.000000"],
          ["P-JUEVES", "NEAR_EXPIRY", "900.000000"],
          ["V-DIA7", "NEAR_EXPIRY", "400.000000"],
        ]);
        expect(lots[2]!["presentation_id"]).toBe(polloId);

        // El nombre lo da su dueño, Catálogo: así lo compone la pantalla.
        const nombre = await send(reading("catalog.item.get", { presentation_id: polloId }));
        expect(nombre.result["name"]).toBe("Pechuga de pollo");
      });
    }, 60_000);
  });

  /**
   * El rastro — `inventory.lot.trace`. Es la pregunta de un retiro sanitario:
   * «la tanda T-A salió contaminada; ¿qué ventas se la llevaron?».
   */
  describe("el rastro de un lote", () => {
    it("dice qué ventas y qué mermas se llevaron cada tanda, y cada venta se abre con su recibo", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "traza");
        await lot(send, ids.presentationId, "T-A", "1000.000000", "2026-09-24", "2026-09-22");
        await lot(send, ids.presentationId, "T-B", "5000.000000", "2026-12-31", "2026-09-10");

        const first = await sellAndPay(send, ids, "700.000000", "traza:1");
        // 300 de T-A la agotan y 200 salen de T-B: una venta en dos tandas.
        const second = await sellAndPay(send, ids, "500.000000", "traza:2");
        expect((await send(mutating("inventory.stock.adjust", {
          presentation_id: ids.presentationId, movement_type: "SHRINKAGE",
          quantity: "50.000000", reason_code: "DAMAGED", business_date: "2026-09-22",
          lot_code: "T-B",
        }, "traza:merma"))).result["outcome"]).toBe("POSTED");

        const a = await send(reading("inventory.lot.trace", {
          presentation_id: ids.presentationId, lot_code: "T-A",
        }));
        expect(a.status).toBe("SUCCEEDED");
        expect(a.result["outcome"]).toBe("FOUND");
        expect(a.result["quantity_received"]).toBe("1000.000000");
        expect(a.result["lot"]).toMatchObject({
          lot_code: "T-A", quantity_on_hand: "0.000000", status: "CONSUMED", expiry_date: "2026-09-24",
        });
        expect((a.result["outflows"] as Record<string, unknown>[]).map(
          (o) => [o["movement_type"], o["quantity"], o["sale_id"]],
        )).toEqual([
          ["SALE", "700.000000", first.saleId],
          ["SALE", "300.000000", second.saleId],
        ]);
        expect(a.result["truncated"]).toBe(false);

        const b = await send(reading("inventory.lot.trace", {
          presentation_id: ids.presentationId, lot_code: "T-B",
        }));
        // Lo que entró = lo que queda + lo que salió: 4750 + 200 + 50.
        expect(b.result["quantity_received"]).toBe("5000.000000");
        expect((b.result["lot"] as Record<string, unknown>)["quantity_on_hand"]).toBe("4750.000000");
        expect((b.result["outflows"] as Record<string, unknown>[]).map(
          (o) => [o["movement_type"], o["quantity"], o["sale_id"], o["reason_code"]],
        )).toEqual([
          ["SALE", "200.000000", second.saleId, "SALE_COMPLETED"],
          ["SHRINKAGE", "50.000000", null, "DAMAGED"],
        ]);

        // El rastro devuelve la venta; su dueño —Sales— la abre. Así es como
        // la pantalla llega del lote al recibo sin leer tablas ajenas.
        for (const saleId of [first.saleId, second.saleId]) {
          const receipt = await send(reading("sales.receipt.get", { sale_id: saleId }));
          expect(receipt.result["outcome"]).toBe("FOUND");
          expect(receipt.result["sale_number"]).toEqual(expect.any(Number));
        }
      });
    }, 60_000);

    /**
     * Del lote a la persona, en tres saltos y tres dueños: el rastro (Inventario)
     * da la venta, el recibo (Ventas) da el cliente que la venta nombró, y
     * `customer.get` (Clientes) da nombre y contacto. Ninguno lee tablas de otro.
     * La venta de mostrador llega hasta la venta y ahí se detiene: no tiene
     * comprador, y el recibo lo dice con `null`, no con un hueco.
     */
    it("lleva del lote al comprador que la venta nombró, y la venta anónima lo dice", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "comprador");
        await lot(send, ids.presentationId, "CP-L1", "1000.000000", "2026-12-31", "2026-09-22");
        const cliente = await send(mutating("customer.register", {
          identification_document_code: "13", identification: "52123456",
          verification_digit: null, legal_organization_code: "2",
          company: null, names: "Ana Compradora", tribute_code: "ZZ",
          fiscal_responsibility_codes: ["R-99-PN"],
          email: "ana@example.com", phone: "3001234567",
          address: null, country_code: null, municipality_code: null,
        }, "comprador:cliente"));
        expect(cliente.result["outcome"]).toBe("REGISTERED");
        const customerId = cliente.result["customer_id"] as string;

        const nominada = await sellAndPay(send, ids, "300.000000", "comprador:1", customerId);
        const anonima = await sellAndPay(send, ids, "200.000000", "comprador:2");

        const trace = await send(reading("inventory.lot.trace", {
          presentation_id: ids.presentationId, lot_code: "CP-L1",
        }));
        const sales = (trace.result["outflows"] as Record<string, unknown>[]).map((o) => o["sale_id"]);
        expect(sales).toEqual([nominada.saleId, anonima.saleId]);

        const r1 = await send(reading("sales.receipt.get", { sale_id: nominada.saleId }));
        expect(r1.result["customer_id"]).toBe(customerId);
        // Lo que dice el recibo es lo que quedó escrito en la venta.
        expect(database.native.prepare(
          "SELECT customer_id FROM sales_sales WHERE id=?",
        ).get(nominada.saleId)).toEqual({ customer_id: customerId });

        const persona = await send(reading("customer.get", { customer_id: customerId }));
        expect(persona.result["outcome"]).toBe("FOUND");
        expect(persona.result["names"]).toBe("Ana Compradora");
        expect(persona.result["phone"]).toBe("3001234567");
        expect(persona.result["email"]).toBe("ana@example.com");

        const r2 = await send(reading("sales.receipt.get", { sale_id: anonima.saleId }));
        expect(r2.result["outcome"]).toBe("FOUND");
        expect(r2.result["customer_id"]).toBeNull();
      });
    }, 60_000);

    it("un código que no existe es NOT_FOUND; un lote sin salidas es FOUND con la lista vacía", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "trnf");
        const missing = await send(reading("inventory.lot.trace", {
          presentation_id: ids.presentationId, lot_code: "NO-EXISTE",
        }));
        expect(missing.status).toBe("REJECTED");
        expect(missing.result["outcome"]).toBe("NOT_FOUND");
        expect(missing.error?.category).toBe("NOT_FOUND");
        expect(missing.result["outflows"]).toEqual([]);

        await lot(send, ids.presentationId, "INTACTO", "300.000000", "2026-12-31", "2026-09-22");
        const intact = await send(reading("inventory.lot.trace", {
          presentation_id: ids.presentationId, lot_code: "INTACTO",
        }));
        expect(intact.result["outcome"]).toBe("FOUND");
        expect(intact.result["outflows"]).toEqual([]);
        expect(intact.result["quantity_received"]).toBe("300.000000");
      });
    }, 60_000);
  });

  /**
   * Las demás salidas — `UC-INVENTORY-002` §Salidas, §Mermas, §Lote vencido.
   *
   * Si la merma baja el saldo y no el lote, el lote dice tener lo que ya se
   * botó, y la siguiente venta lo toma por FEFO: el rastro de a quién se
   * vendió qué tanda queda falso justo después de la primera merma.
   */
  describe("las demás salidas también bajan del lote", () => {
    function adjust(
      send: (request: unknown) => Promise<ChannelResponse>,
      presentationId: string,
      payload: Record<string, unknown>,
      key: string,
    ): Promise<ChannelResponse> {
      return send(mutating("inventory.stock.adjust", {
        presentation_id: presentationId, business_date: "2026-09-22", ...payload,
      }, key));
    }

    function movementAllocations(database: LocalDatabase, movementType: string): Record<string, string> {
      const rows = database.native.prepare(
        `SELECT l.lot_code, a.quantity, a.sale_id FROM inventory_lot_allocation a
           JOIN inventory_lot l ON l.tenant_id=a.tenant_id AND l.id=a.lot_id
           JOIN inventory_movement m ON m.tenant_id=a.tenant_id AND m.id=a.movement_id
          WHERE m.movement_type=? ORDER BY l.lot_code`,
      ).all(movementType) as { lot_code: string; quantity: string; sale_id: string | null }[];
      // Ninguna de estas salidas es una venta: no pueden llevar venta.
      for (const row of rows) expect(row.sale_id).toBeNull();
      return Object.fromEntries(rows.map((r) => [r.lot_code, r.quantity]));
    }

    it("la merma por vencimiento sale del lote vencido que se nombra, y saldo y lote bajan juntos", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "mvenc");
        await lot(send, ids.presentationId, "MV-VENCIDA", "800.000000", "2026-09-18", "2026-09-15");
        await lot(send, ids.presentationId, "MV-VIGENTE", "1000.000000", "2026-12-31", "2026-09-20");

        const merma = await adjust(send, ids.presentationId, {
          movement_type: "SHRINKAGE", quantity: "800.000000", reason_code: "EXPIRED",
          lot_code: "MV-VENCIDA",
        }, "mvenc:merma");
        expect(merma.status).toBe("SUCCEEDED");
        expect(merma.result["outcome"]).toBe("POSTED");
        expect(merma.result["quantity_after"]).toBe("1000.000000");

        // Sale la vencida —que FEFO nunca elegiría— y la vigente queda intacta.
        expect(lotState(database, "MV-VENCIDA")).toBe("0.000000/CONSUMED");
        expect(lotState(database, "MV-VIGENTE")).toBe("1000.000000/ACTIVE");
        expect(movementAllocations(database, "SHRINKAGE")).toEqual({ "MV-VENCIDA": "800.000000" });
      });
    }, 60_000);

    it("una merma por vencimiento sin lote se rechaza y no mueve nada", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "msinl");
        await lot(send, ids.presentationId, "MS-VENCIDA", "800.000000", "2026-09-18", "2026-09-15");

        const merma = await adjust(send, ids.presentationId, {
          movement_type: "SHRINKAGE", quantity: "800.000000", reason_code: "EXPIRED",
        }, "msinl:merma");
        expect(merma.status).toBe("REJECTED");
        expect(merma.result["outcome"]).toBe("LOT_REQUIRED");
        // Falta un dato en la petición: validación, no fallo interno.
        expect(merma.error?.category).toBe("VALIDATION");
        expect(stockOf(database, ids.presentationId)).toBe("800.000000");
        expect(lotState(database, "MS-VENCIDA")).toBe("800.000000/ACTIVE");
        expect(countOf(
          database, "SELECT COUNT(*) n FROM inventory_movement WHERE movement_type='SHRINKAGE'",
        )).toBe(0);
      });
    }, 60_000);

    it("un ajuste negativo y un traslado sin lote bajan por FEFO sobre vigentes, saltando el vencido", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "afefo");
        await lot(send, ids.presentationId, "AF-C-VENCIDA", "800.000000", "2026-09-18", "2026-09-15");
        await lot(send, ids.presentationId, "AF-B-TARDIA", "1000.000000", "2026-12-31", "2026-09-10");
        await lot(send, ids.presentationId, "AF-A-PRONTO", "300.000000", "2026-09-24", "2026-09-22");

        expect((await adjust(send, ids.presentationId, {
          movement_type: "ADJUSTMENT_NEGATIVE", quantity: "200.000000", reason_code: "COUNT_CORRECTION",
        }, "afefo:ajuste")).result["outcome"]).toBe("POSTED");
        expect((await adjust(send, ids.presentationId, {
          movement_type: "TRANSFER_OUT", quantity: "300.000000", reason_code: "BRANCH_TRANSFER",
        }, "afefo:traslado")).result["outcome"]).toBe("POSTED");

        expect(movementAllocations(database, "ADJUSTMENT_NEGATIVE")).toEqual({ "AF-A-PRONTO": "200.000000" });
        expect(movementAllocations(database, "TRANSFER_OUT")).toEqual({
          "AF-A-PRONTO": "100.000000",
          "AF-B-TARDIA": "200.000000",
        });
        expect(lotState(database, "AF-A-PRONTO")).toBe("0.000000/CONSUMED");
        expect(lotState(database, "AF-B-TARDIA")).toBe("800.000000/ACTIVE");
        expect(lotState(database, "AF-C-VENCIDA")).toBe("800.000000/ACTIVE");
        expect(stockOf(database, ids.presentationId)).toBe("1600.000000");

        // Una entrada no toca lotes: sumar a una tanda es recibirla con sus fechas.
        expect((await adjust(send, ids.presentationId, {
          movement_type: "ADJUSTMENT_POSITIVE", quantity: "50.000000", reason_code: "COUNT_CORRECTION",
        }, "afefo:positivo")).result["outcome"]).toBe("POSTED");
        expect(lotState(database, "AF-B-TARDIA")).toBe("800.000000/ACTIVE");
        expect(lotState(database, "AF-C-VENCIDA")).toBe("800.000000/ACTIVE");
        expect(stockOf(database, ids.presentationId)).toBe("1650.000000");
      });
    }, 60_000);

    /**
     * El saldo alcanza —hay existencia sin lote— pero el lote nombrado no. El
     * movimiento llega a escribirse y el rechazo lo deshace: si no, el saldo
     * quedaría descontado sin lote, que es justo lo que esto viene a evitar.
     */
    it("un lote nombrado que no alcanza rechaza y deshace el movimiento", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "lcorto");
        await send(mutating("inventory.stock.receive", {
          presentation_id: ids.presentationId, movement_type: "OPENING_COUNT",
          quantity: "1000.000000", reason_code: "INITIAL_COUNT", business_date: "2026-09-22",
        }, "lcorto:conteo"));
        await lot(send, ids.presentationId, "LC-CORTO", "100.000000", "2026-12-31", "2026-09-22");

        const merma = await adjust(send, ids.presentationId, {
          movement_type: "SHRINKAGE", quantity: "150.000000", reason_code: "DAMAGED",
          lot_code: "LC-CORTO",
        }, "lcorto:merma");
        expect(merma.status).toBe("REJECTED");
        expect(merma.result["outcome"]).toBe("LOT_INSUFFICIENT");
        expect(merma.error?.category).toBe("CONFLICT");
        // Lo que tiene el lote, no el saldo: es lo que corrige la captura.
        expect(merma.result["available"]).toBe("100.000000");

        expect(stockOf(database, ids.presentationId)).toBe("1100.000000");
        expect(lotState(database, "LC-CORTO")).toBe("100.000000/ACTIVE");
        expect(countOf(
          database, "SELECT COUNT(*) n FROM inventory_movement WHERE movement_type='SHRINKAGE'",
        )).toBe(0);

        const inexistente = await adjust(send, ids.presentationId, {
          movement_type: "SHRINKAGE", quantity: "10.000000", reason_code: "DAMAGED",
          lot_code: "NO-EXISTE",
        }, "lcorto:inexistente");
        expect(inexistente.result["outcome"]).toBe("LOT_NOT_FOUND");
        expect(inexistente.error?.category).toBe("NOT_FOUND");
        expect(stockOf(database, ids.presentationId)).toBe("1100.000000");
      });
    }, 60_000);

    /**
     * A diferencia del cobro reintentado, aquí nada corta antes: la repetición
     * llega al almacén. Es la prueba de la guarda de idempotencia del ajuste.
     */
    it("repetir la misma merma es IDEMPOTENT y descuenta del lote una sola vez", async () => {
      await withRealChannel(async (send, database) => {
        const ids = await counter(send, database, "midem");
        await lot(send, ids.presentationId, "MI-LOTE", "500.000000", "2026-12-31", "2026-09-22");
        const payload = {
          movement_type: "SHRINKAGE", quantity: "100.000000", reason_code: "DAMAGED",
          lot_code: "MI-LOTE",
        };
        expect((await adjust(send, ids.presentationId, payload, "midem:merma")).result["outcome"]).toBe("POSTED");
        const repeat = await adjust(send, ids.presentationId, payload, "midem:merma");
        expect(repeat.status).toBe("SUCCEEDED");
        expect(repeat.result["outcome"]).toBe("IDEMPOTENT");

        expect(lotState(database, "MI-LOTE")).toBe("400.000000/ACTIVE");
        expect(movementAllocations(database, "SHRINKAGE")).toEqual({ "MI-LOTE": "100.000000" });
        expect(stockOf(database, ids.presentationId)).toBe("400.000000");

        // La misma clave con otro lote no es un reintento: es otra decisión.
        await lot(send, ids.presentationId, "MI-OTRO", "500.000000", "2026-12-31", "2026-09-22");
        const other = await adjust(send, ids.presentationId, { ...payload, lot_code: "MI-OTRO" }, "midem:merma");
        expect(other.result["outcome"]).toBe("IDEMPOTENCY_CONFLICT");
        expect(lotState(database, "MI-OTRO")).toBe("500.000000/ACTIVE");
      });
    }, 60_000);
  });
});
