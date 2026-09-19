import { generateKeyPairSync, createPublicKey, randomUUID, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type {
  AuthorizationSnapshotClaims,
  SessionAssertionClaims,
  SignedAuthorizationSnapshot,
} from "@pos-platform/contracts";
import {
  unsignedAuthorizationSnapshotBytes,
  unsignedSessionAssertionBytes,
} from "../src/index.js";
import {
  SqliteTrustAnchorStore,
  AuthorizationSnapshotVerifier,
  TrustedClockGuard,
  type TrustAnchorPurpose,
} from "../src/security/index.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import { SnapshotAcquisitionService } from "../src/authorization/snapshot-acquisition.js";
import type { SnapshotProvider } from "../src/authorization/snapshot-provider.js";
import type { SnapshotBinding } from "../src/authorization/authorization-snapshot-store.js";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { CommercialRequestHandler } from "../src/commercial/commercial-request-handler.js";
import type { ServiceConfig } from "../src/config.js";

/**
 * La cadena de confianza, abierta de punta a punta desde una tabla.
 *
 * ## Qué demuestra este archivo y por qué no existía antes
 *
 * Hasta `MIGRATION_022` el mapa de claves de firma no tenía origen posible:
 * `main.ts` construía `CommercialComponent` con `new Map()` literal. La
 * consecuencia no era teórica — **veinticinco operaciones ruteadas y ninguna
 * alcanzable**: `session.activate` rechazaba toda SSA con `SIGNATURE_INVALID`
 * porque ninguna `key_id` podía existir en un mapa vacío, y sin vínculo de
 * sesión el resto de la superficie comercial quedaba detrás de
 * `SESSION_NOT_BOUND`.
 *
 * Lo que se prueba aquí es que ese cable existe y conduce: las claves salen de
 * `local_trust_anchor`, y con ellas la cadena entera —sesión → autorización →
 * turno → venta → cobro— se abre contra SQLite real y contra los casos de uso
 * reales, sin inyectar el snapshot a mano y sin dobles.
 *
 * ## Lo que este archivo NO prueba, y conviene leerlo antes de celebrar
 *
 * No prueba que exista confianza en producción. `DEC-011` mantiene `BLOCKED`
 * la emisión real de material y prohíbe expresamente los autofirmados como
 * sustituto. Aquí las anclas se provisionan con claves generadas para la
 * prueba, que es lo que el ADR autoriza. Un equipo real sigue arrancando con
 * el ancla vacía y sigue fallando cerrado — y el primer caso de este archivo
 * es precisamente esa situación, probada como comportamiento esperado y no
 * como defecto.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO DE ESTE ARCHIVO ES EXCLUSIVO DE TEST.
 * Las claves se generan en memoria. No constituyen ni sustituyen un trust
 * anchor de producción.
 */

const sessionKeyPair = generateKeyPairSync("ed25519");
/** Deliberadamente distinta: la separación por propósito se prueba, no se supone. */
const authorizationKeyPair = generateKeyPairSync("ed25519");

const TENANT = "018f0000-0000-7000-8000-0000000000f1";
const COMPANY = "018f0000-0000-7000-8000-0000000000f2";
const BRANCH = "018f0000-0000-7000-8000-0000000000f3";
const DEVICE = "018f0000-0000-7000-8000-0000000000f4";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000f5";
const USER = "018f0000-0000-7000-8000-0000000000f6";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000f7";
const SSA_SESSION = "018f0000-0000-7000-8000-0000000000f8";
const REGISTER = "018f0000-0000-7000-8000-00000000ff01";

const SESSION_KEY_ID = "TEST_SESSION_ANCHOR_1";
const AUTHZ_KEY_ID = "TEST_AUTHZ_ANCHOR_1";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const BUSINESS_DATE = "2026-09-10";
const BARCODE = "7701234567890";

const PERMISSIONS = [
  "CASH_SHIFT_OPEN", "CATALOG_PRODUCT_REGISTER", "INVENTORY_STOCK_RECEIVE",
  "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER",
];

const BINDING: SnapshotBinding = { userId: USER, installationId: INSTALLATION, deviceId: DEVICE };

// ── Limpieza ─────────────────────────────────────────────────────────────────

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

/** SPKI DER en `base64url`, que es exactamente lo que guarda la tabla. */
function spki(privateKey: Parameters<typeof createPublicKey>[0]): string {
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
}

// ── Fixtures firmadas ────────────────────────────────────────────────────────

function sessionClaims(overrides: Partial<SessionAssertionClaims> = {}): SessionAssertionClaims {
  return {
    session_id: SSA_SESSION,
    user_id: USER,
    tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    issued_at: "2026-09-10T00:00:00.000Z",
    offline_valid_until: "2026-09-11T00:00:00.000Z",
    sequence: 1,
    key_id: SESSION_KEY_ID,
    ...overrides,
  } as SessionAssertionClaims;
}

function signSession(claims: SessionAssertionClaims, key = sessionKeyPair.privateKey) {
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionBytes(claims), key).toString("base64url"),
  };
}

function authorizationClaims(keyId = AUTHZ_KEY_ID, sequence = 1): AuthorizationSnapshotClaims {
  return {
    snapshot_id: "018f0000-0000-7000-8000-0000000000fa",
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence,
    issued_at: "2026-09-10T00:00:00.000Z",
    expires_at: "2026-09-11T00:00:00.000Z",
    key_id: keyId,
    assignments: [{
      tenant_id: TENANT,
      company_id: COMPANY,
      branch_id: BRANCH,
      status: "ACTIVE",
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_until: null,
      role_status: "ACTIVE",
      permissions: PERMISSIONS.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
}

function signAuthorization(
  claims: AuthorizationSnapshotClaims,
  key = authorizationKeyPair.privateKey,
): SignedAuthorizationSnapshot {
  return {
    claims,
    signature: sign(null, unsignedAuthorizationSnapshotBytes(claims), key).toString("base64url"),
  } as SignedAuthorizationSnapshot;
}

/**
 * El proveedor de snapshot en memoria.
 *
 * Es un adaptador del puerto, no un doble del servicio: `SnapshotProvider`
 * existe porque el transporte productivo —HTTP hacia la API central— no está
 * escrito. Lo que se verifica y lo que se persiste es real.
 */
class FixtureSnapshotProvider implements SnapshotProvider {
  constructor(private readonly signed: SignedAuthorizationSnapshot) {}
  async fetch(_binding: SnapshotBinding): Promise<SignedAuthorizationSnapshot> {
    return this.signed;
  }
}

// ── Entorno ──────────────────────────────────────────────────────────────────

function config(): ServiceConfig {
  return {
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    device_id: DEVICE,
    installation_id: INSTALLATION,
  } as ServiceConfig;
}

interface AnchorSeed {
  readonly purpose: TrustAnchorPurpose;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED";
}

const DEFAULT_ANCHORS: readonly AnchorSeed[] = [
  {
    purpose: "SESSION_ASSERTION", keyId: SESSION_KEY_ID,
    publicKeySpki: spki(sessionKeyPair.privateKey), status: "ACTIVE",
  },
  {
    purpose: "AUTHORIZATION_SNAPSHOT", keyId: AUTHZ_KEY_ID,
    publicKeySpki: spki(authorizationKeyPair.privateKey), status: "ACTIVE",
  },
];

async function buildEnv(anchors: readonly AnchorSeed[] = DEFAULT_ANCHORS) {
  const dir = await mkdtemp(join(tmpdir(), "pos-trust-anchor-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);

  const trustAnchors = new SqliteTrustAnchorStore(database, () => NOW);
  for (const anchor of anchors) trustAnchors.provision(anchor);

  const durableSync = new DurableSyncStore(database);
  const commercial = new CommercialComponent(
    config(),
    { database } as never,
    { store: durableSync } as never,
    // Exactamente la forma que usa `main.ts`: perezosa y contra la tabla.
    () => trustAnchors.keysFor("SESSION_ASSERTION"),
    () => NOW,
  );
  await commercial.start();

  return {
    database, trustAnchors, commercial,
    handler: new CommercialRequestHandler(config(), commercial),
  };
}

/**
 * Adquiere el snapshot por la ruta canónica de `SAS-003`: proveedor →
 * verificador (con claves del ancla) → store. No se llama a `activate`
 * directamente, que es justamente lo que otras pruebas sí hacen para llegar
 * antes a su objeto de estudio.
 */
async function acquireSnapshot(
  database: LocalDatabase,
  trustAnchors: SqliteTrustAnchorStore,
  signed: SignedAuthorizationSnapshot,
) {
  const service = new SnapshotAcquisitionService(
    new FixtureSnapshotProvider(signed),
    new AuthorizationSnapshotVerifier(
      trustAnchors.keysFor("AUTHORIZATION_SNAPSHOT"),
      new TrustedClockGuard(database),
      () => NOW,
    ),
    new SqliteAuthorizationSnapshotStore(database, () => NOW),
  );
  return service.acquire(BINDING);
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

// ── Peticiones ───────────────────────────────────────────────────────────────

const BASE = { protocol_version: "1.0.0", payload_schema_version: "1.0.0" } as const;

function reading(messageType: string, payload: Record<string, unknown>) {
  return {
    ...BASE, message_type: messageType,
    request_id: randomUUID(), correlation_id: randomUUID(), payload,
  };
}

function mutating(messageType: string, payload: Record<string, unknown>, key: string) {
  return {
    ...BASE, message_type: messageType,
    request_id: randomUUID(), correlation_id: randomUUID(),
    operation_id: randomUUID(), idempotency_key: key, payload,
  };
}

function response(raw: unknown) {
  return raw as {
    status: string;
    result_code: string;
    error: { code: string; category: string } | null;
    result: Record<string, unknown>;
  };
}

// ── A · El estado de producción de hoy ───────────────────────────────────────

describe("ancla vacía — el equipo sin confianza provisionada falla cerrado", () => {
  it("sin anclas, session.activate rechaza una SSA por lo demás correcta", async () => {
    const { handler, commercial } = await buildEnv([]);
    const connection = randomUUID();
    const result = response(handler.handle(
      reading("session.activate", { session_assertion: signSession(sessionClaims()) }) as never,
      connection,
    ));

    // No es un defecto: es `DEC-011` operando. La firma es buena; lo que falta
    // es alguien que haya dicho que esa clave es de fiar.
    //
    // La frontera devuelve `REJECTED` sin nombrar la causa: distinguir «clave
    // desconocida» de «firma mala» diría qué `key_id` existen.
    expect(result.status).toBe("REJECTED");
    expect(result.error?.category).toBe("AUTHENTICATION");
    expect(commercial.bindings.resolve(connection)).toBeNull();
  });

  it("y la superficie comercial queda entera detrás del vínculo ausente", async () => {
    const { handler, database } = await buildEnv([]);
    seedRegister(database);

    const shift = response(handler.handle(
      mutating("cash.shift.open", {
        cash_register_id: REGISTER, opening_amount: "0.000000",
        business_date: BUSINESS_DATE, timezone_id: "America/Bogota", utc_offset_minutes: -300,
      }, "anchor:none:shift") as never,
      randomUUID(),
    ));
    expect(shift.status).toBe("REJECTED");
    expect(shift.result_code).toBe("SESSION_NOT_BOUND");
  });
});

// ── B · La cadena completa, con anclas provisionadas ─────────────────────────

describe("ancla provisionada — la cadena de confianza se abre de punta a punta", () => {
  it("anclaje → sesión → autorización → turno → venta → cobro, sobre SQLite real", async () => {
    const { handler, database, trustAnchors } = await buildEnv();
    const connection = randomUUID();
    seedRegister(database);

    // 1 · El snapshot llega por la ruta canónica y se verifica con la clave
    //     que está en la tabla, no con una pasada a mano.
    const acquisition = await acquireSnapshot(
      database, trustAnchors, signAuthorization(authorizationClaims()),
    );
    expect(acquisition.kind).toBe("ACQUIRED");

    // 2 · La sesión se activa contra el ancla `SESSION_ASSERTION`.
    const activated = response(handler.handle(
      reading("session.activate", { session_assertion: signSession(sessionClaims()) }) as never,
      connection,
    ));
    expect(activated.status).toBe("SUCCEEDED");

    // 3 · Turno abierto por el mismo camino que usaría el cajero.
    const shift = response(handler.handle(
      mutating("cash.shift.open", {
        cash_register_id: REGISTER, opening_amount: "0.000000",
        business_date: BUSINESS_DATE, timezone_id: "America/Bogota", utc_offset_minutes: -300,
      }, "anchor:chain:shift") as never,
      connection,
    ));
    expect(shift.status).toBe("SUCCEEDED");

    // 4 · Producto y existencia.
    const product = response(handler.handle(
      mutating("catalog.product.register", {
        code: "CAFE-ANCHOR", name: "Café Americano 500 g", stock_controlled: true,
        presentation_name: "Bolsa 500 g", unit_code: "UND", unit_precision: 0,
        barcode: BARCODE, price_amount: "18000.000000", currency_code: "COP",
      }, "anchor:chain:catalog") as never,
      connection,
    ));
    expect(product.status).toBe("SUCCEEDED");
    const presentationId = product.result["presentation_id"] as string;
    const productId = product.result["product_id"] as string;

    const received = response(handler.handle(
      mutating("inventory.stock.receive", {
        presentation_id: presentationId, movement_type: "PURCHASE_RECEIPT",
        quantity: "12.000000", reason_code: "SUPPLIER_DELIVERY", business_date: BUSINESS_DATE,
      }, "anchor:chain:inventory") as never,
      connection,
    ));
    expect(received.status).toBe("SUCCEEDED");

    // 5 · La venta.
    const sale = response(handler.handle(
      mutating("sale.create", {
        cash_register_id: REGISTER, channel: "POS", business_date: BUSINESS_DATE,
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
        document_series: "A", currency_code: "COP",
        lines: [{ product_id: productId, presentation_id: presentationId, quantity: "2.000000" }],
      }, "anchor:chain:sale") as never,
      connection,
    ));
    expect(sale.status).toBe("SUCCEEDED");
    const saleId = sale.result["sale_id"] as string;

    // 6 · El cobro. Es aquí donde la cadena deja de ser una promesa.
    const payment = response(handler.handle(
      mutating("payment.register.cash", {
        sale_id: saleId, amount: sale.result["payable_amount"] as string, tendered_amount: null,
      }, "anchor:chain:payment") as never,
      connection,
    ));
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.result["sale_completed"]).toBe(true);

    // 7 · Lo escrito en disco, que es lo único que cuenta como evidencia.
    const persisted = database.native.prepare(
      "SELECT status FROM sales_sales WHERE id=?",
    ).get(saleId) as { status: string };
    expect(persisted.status).toBe("COMPLETED");

    const stock = database.native.prepare(
      "SELECT quantity_on_hand FROM inventory_stock WHERE presentation_id=?",
    ).get(presentationId) as { quantity_on_hand: string };
    expect(stock.quantity_on_hand).toBe("10.000000");
  });
});

// ── C · Separación por propósito ─────────────────────────────────────────────

describe("propósito — un ancla no vale fuera del suyo", () => {
  it("la clave de sesión no verifica un snapshot de autorización", async () => {
    const { database, trustAnchors } = await buildEnv();

    // Firmado con la clave de SESIÓN, pero declarando la `key_id` de
    // autorización: el atacante no gana nada conociendo qué `key_id` existen.
    const forged = signAuthorization(authorizationClaims(), sessionKeyPair.privateKey);
    const outcome = await acquireSnapshot(database, trustAnchors, forged);

    expect(outcome.kind).toBe("VERIFICATION_FAILED");
    expect(
      (outcome as { decision: string }).decision,
    ).toBe("SIGNATURE_INVALID");
  });

  it("una clave anclada sólo para sesión no aparece en el propósito de licencia", async () => {
    const { trustAnchors } = await buildEnv();
    expect(trustAnchors.keysFor("SESSION_ASSERTION").size).toBe(1);
    expect(trustAnchors.keysFor("LICENSE").size).toBe(0);
  });
});

// ── D · Estados del ancla ────────────────────────────────────────────────────

describe("estados — REVOKED corta, VERIFY_ONLY sigue verificando", () => {
  it("revocar el ancla de sesión deja la SSA sin verificador", async () => {
    const { handler } = await buildEnv([
      {
        purpose: "SESSION_ASSERTION", keyId: SESSION_KEY_ID,
        publicKeySpki: spki(sessionKeyPair.privateKey), status: "REVOKED",
      },
    ]);

    // `keysFor` no carga las revocadas, de modo que el verificador ni siquiera
    // recibe la clave: para él la `key_id` es desconocida. La diferencia con
    // `SIGNING_KEY_REVOKED` es deliberada — el verificador sólo puede reportar
    // revocación de una clave que recibió, y este almacén decide no
    // entregarla. Una revocada no verifica nada, ni siquiera histórico.
    const result = response(handler.handle(
      reading("session.activate", { session_assertion: signSession(sessionClaims()) }) as never,
      randomUUID(),
    ));
    expect(result.status).toBe("REJECTED");
    expect(result.error?.category).toBe("AUTHENTICATION");
  });

  it("VERIFY_ONLY sigue abriendo sesión: es lo que permite rotar sin corte", async () => {
    const { handler } = await buildEnv([
      {
        purpose: "SESSION_ASSERTION", keyId: SESSION_KEY_ID,
        publicKeySpki: spki(sessionKeyPair.privateKey), status: "VERIFY_ONLY",
      },
    ]);
    const result = response(handler.handle(
      reading("session.activate", { session_assertion: signSession(sessionClaims()) }) as never,
      randomUUID(),
    ));
    expect(result.status).toBe("SUCCEEDED");
  });

  it("provisionar es idempotente por (purpose, key_id) y puede cambiar el estado", async () => {
    const { trustAnchors } = await buildEnv();
    trustAnchors.provision({
      purpose: "SESSION_ASSERTION", keyId: SESSION_KEY_ID,
      publicKeySpki: spki(sessionKeyPair.privateKey), status: "REVOKED",
    });
    expect(trustAnchors.usableCount("SESSION_ASSERTION")).toBe(0);
  });
});

// ── E · Fail-closed en la lectura ────────────────────────────────────────────

describe("lectura — un ancla ilegible es un ancla menos, no un arranque roto", () => {
  it("una fila corrupta se descarta y las demás siguen sirviendo", async () => {
    const { database, trustAnchors } = await buildEnv();

    // Pasa los CHECK de la tabla —alfabeto `base64url`, longitud válida— y no
    // es una SPKI. No entra por `provision`, que la rechazaría: se escribe
    // directo para simular corrupción en disco.
    database.native.prepare(
      `INSERT INTO local_trust_anchor(
        purpose, key_id, algorithm, public_key_spki, status,
        provisioned_at, updated_at, revoked_at
      ) VALUES ('SESSION_ASSERTION','CORRUPT_1','ED25519','not-a-real-spki','ACTIVE',?,?,NULL)`,
    ).run(NOW.toISOString(), NOW.toISOString());

    // La tabla tiene dos filas; utilizable hay una. `usableCount` reporta la
    // que sirve, no la que existe: es lo que el log de arranque debe decir.
    const rows = (database.native.prepare(
      "SELECT COUNT(*) AS n FROM local_trust_anchor WHERE purpose='SESSION_ASSERTION'",
    ).get() as { n: number }).n;
    expect(rows).toBe(2);
    expect(trustAnchors.usableCount("SESSION_ASSERTION")).toBe(1);

    // Y la buena sigue abriendo sesión: la corrupta no tumbó nada.
    const commercial = new CommercialComponent(
      config(), { database } as never, { store: new DurableSyncStore(database) } as never,
      () => trustAnchors.keysFor("SESSION_ASSERTION"), () => NOW,
    );
    await commercial.start();
    const handler = new CommercialRequestHandler(config(), commercial);
    const result = response(handler.handle(
      reading("session.activate", { session_assertion: signSession(sessionClaims()) }) as never,
      randomUUID(),
    ));
    expect(result.status).toBe("SUCCEEDED");
  });

  it("provisionar material ilegible se rechaza en el acto", async () => {
    const { trustAnchors } = await buildEnv([]);
    expect(() => trustAnchors.provision({
      purpose: "LICENSE", keyId: "BAD_1", publicKeySpki: "not-a-real-spki", status: "ACTIVE",
    })).toThrow(/not a readable Ed25519 public key/);
  });
});
