import { createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  CashShiftOpenRequestSchema,
  CatalogItemFindRequestSchema,
  CatalogProductRegisterRequestSchema,
  CustomerFindRequestSchema,
  CustomerGetRequestSchema,
  CustomerRegisterRequestSchema,
  InventoryStockAdjustRequestSchema,
  InventoryStockGetRequestSchema,
  InventoryStockReceiveRequestSchema,
  PaymentRegisterQrRequestSchema,
  SaleCreateRequestSchema,
  SessionActivateRequestSchema,
  type AuthorizationSnapshotClaims,
  type SessionAssertionClaims,
} from "@pos-platform/contracts";
import {
  unsignedAuthorizationSnapshotBytes,
  unsignedSessionAssertionBytes,
  type TrustedSigningKey,
} from "../src/index.js";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { CommercialRequestHandler } from "../src/commercial/commercial-request-handler.js";
import type { ServiceConfig } from "../src/config.js";

/**
 * TODO EL MATERIAL CRIPTOGRÁFICO DE ESTE ARCHIVO ES EXCLUSIVO DE TEST.
 * Las claves se generan en memoria y no se persisten. No constituyen ni
 * sustituyen un trust anchor de producción.
 */
const testOnlyKeyPair = generateKeyPairSync("ed25519");

const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const ATTACKER = "018f0000-0000-7000-8000-0000000000e1";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
const SSA_SESSION = "018f0000-0000-7000-8000-0000000000b0";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const SESSION_KEY_ID = "SESSION_KEY_1";

const NOW = new Date("2026-09-03T12:00:00.000Z");

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-commercial-ipc-"));
  directories.push(value);
  return value;
}

/**
 * Bases abiertas por las pruebas. Se cierran antes de borrar el directorio
 * temporal: en Windows un handle abierto sobre `pos-local.db` —o sobre el
 * lock de escritor único— hace que `rmSync` falle con `EBUSY` y enmascare
 * la causa real, tal como ya documenta `session-assertion-verifier.test.ts`.
 */
const databases: LocalDatabase[] = [];
function track(database: LocalDatabase): LocalDatabase {
  databases.push(database);
  return database;
}
afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // Un cierre fallido no debe ocultar el fallo real de la prueba.
    }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

// ── Fixtures firmadas ────────────────────────────────────────────────────────

function sessionClaims(overrides: Partial<SessionAssertionClaims> = {}): SessionAssertionClaims {
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
    ...overrides,
  } as SessionAssertionClaims;
}

function signSession(claims: SessionAssertionClaims) {
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionBytes(claims), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

function authorizationClaims(
  userId = USER,
  permissions = ["CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE", "SALES_SALE_CREATE"],
): AuthorizationSnapshotClaims {
  return {
    snapshot_id: "018f0000-0000-7000-8000-0000000000c0",
    user_id: userId,
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
        permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
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

async function buildEnv(options: { trustKeys?: boolean } = {}) {
  const dir = await directory();
  const database = track(LocalDatabase.open({ dataDirectory: dir }));
  const durableSync = new DurableSyncStore(database);

  const keys = new Map<string, TrustedSigningKey>();
  if (options.trustKeys !== false) {
    keys.set(SESSION_KEY_ID, { key: createPublicKey(testOnlyKeyPair.privateKey), status: "ACTIVE" });
  }

  const commercial = new CommercialComponent(
    config(),
    { database } as never,
    { store: durableSync } as never,
    keys,
    () => NOW,
  );
  await commercial.start();

  const handler = new CommercialRequestHandler(config(), commercial);
  return { database, commercial, handler };
}

/** Deja un snapshot de autorización activo para `userId`. */
function seedAuthorization(database: LocalDatabase, userId = USER, permissions?: string[]): void {
  new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
    signAuthorization(authorizationClaims(userId, permissions)),
    { userId, installationId: INSTALLATION, deviceId: DEVICE },
  );
}

/** Caja activa en la proyección maestra, igual que en `cash.test.ts`. */
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

// ── Constructores de petición ────────────────────────────────────────────────

const BASE = {
  protocol_version: "1.0.0",
  payload_schema_version: "1.0.0",
} as const;

function activateRequest(signed: unknown) {
  return SessionActivateRequestSchema.parse({
    ...BASE,
    message_type: "session.activate",
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload: { session_assertion: signed },
  });
}

function openShiftRequest(overrides: Record<string, unknown> = {}) {
  return CashShiftOpenRequestSchema.parse({
    ...BASE,
    message_type: "cash.shift.open",
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: "shift:open:ipc:1",
    payload: {
      cash_register_id: REGISTER,
      opening_amount: "0.000000",
      business_date: "2026-09-03",
      timezone_id: "America/Bogota",
      utc_offset_minutes: -300,
    },
    ...overrides,
  });
}

function response(raw: unknown) {
  return raw as {
    status: string;
    result_code: string;
    error: { code: string; category: string } | null;
    result: Record<string, unknown>;
  };
}

// ── session.activate ─────────────────────────────────────────────────────────

describe("session.activate — establecimiento del vínculo", () => {
  it("una SSA válida activa la sesión y vincula la conexión", async () => {
    const { handler, commercial } = await buildEnv();
    const connection = randomUUID();

    const result = response(handler.handle(activateRequest(signSession(sessionClaims())), connection));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.result.outcome).toBe("ACTIVATED");
    expect(result.result.sequence).toBe(1);
    expect(commercial.bindings.resolve(connection)?.userId).toBe(USER);
  });

  it("una firma no confiable no vincula nada", async () => {
    const { handler, commercial } = await buildEnv({ trustKeys: false });
    const connection = randomUUID();

    const result = response(handler.handle(activateRequest(signSession(sessionClaims())), connection));

    expect(result.status).toBe("REJECTED");
    expect(result.result.outcome).toBe("REJECTED");
    expect(result.error?.category).toBe("AUTHENTICATION");
    expect(commercial.bindings.resolve(connection)).toBeNull();
  });

  it("una SSA emitida para otro dispositivo se rechaza", async () => {
    const { handler, commercial } = await buildEnv();
    const connection = randomUUID();
    const foreign = signSession(sessionClaims({ device_id: "018f0000-0000-7000-8000-0000000000ff" }));

    const result = response(handler.handle(activateRequest(foreign), connection));

    expect(result.status).toBe("REJECTED");
    expect(commercial.bindings.resolve(connection)).toBeNull();
  });

  it("reenviar la misma secuencia no desplaza la sesión activa ni vincula", async () => {
    const { handler, commercial } = await buildEnv();
    const signed = signSession(sessionClaims());

    handler.handle(activateRequest(signed), randomUUID());

    // El anti-replay del verificador actúa antes que el del store: una
    // secuencia igual es un reenvío y se detiene en la verificación, de modo
    // que el resultado es `REJECTED / SEQUENCE_REPLAY` y no `STALE_SEQUENCE`.
    const connection = randomUUID();
    const replay = response(handler.handle(activateRequest(signed), connection));

    expect(replay.status).toBe("REJECTED");
    expect(replay.result.outcome).toBe("REJECTED");
    expect(replay.result.decision).toBe("SEQUENCE_REPLAY");
    expect(commercial.bindings.resolve(connection)).toBeNull();
  });
});

// ── Identidad no proviene del llamador ───────────────────────────────────────

describe("frontera de confianza — el llamador no afirma identidad", () => {
  it("el contrato rechaza tenant_id, actor_id y device_id en el sobre", () => {
    for (const field of ["tenant_id", "company_id", "branch_id", "device_id", "actor_id"]) {
      const attempt = () => CashShiftOpenRequestSchema.parse({
        ...BASE,
        message_type: "cash.shift.open",
        request_id: randomUUID(),
        correlation_id: randomUUID(),
        operation_id: randomUUID(),
        idempotency_key: "k",
        [field]: randomUUID(),
        payload: {
          cash_register_id: REGISTER,
          opening_amount: "0.000000",
          business_date: "2026-09-03",
          timezone_id: "America/Bogota",
          utc_offset_minutes: -300,
        },
      });
      expect(attempt, `${field} must be rejected`).toThrow();
    }
  });

  it("el contrato rechaza user_id o actor_type dentro del payload", () => {
    // El payload base es **válido**: se parsea primero para que el rechazo de
    // abajo sólo pueda venir de `user_id`. Sin este control, añadir cualquier
    // campo obligatorio al contrato convertiría esta prueba en vacía — lanzaría
    // por el campo ausente y seguiría pasando sin comprobar nada.
    const payload = {
      cash_register_id: REGISTER,
      channel: "POS",
      business_date: "2026-09-03",
      timezone_id: "America/Bogota",
      utc_offset_minutes: -300,
      document_series: "A",
      currency_code: "COP",
      lines: [{ product_id: REGISTER, presentation_id: REGISTER, quantity: "1.000000" }],
    };
    const envelope = {
      ...BASE,
      message_type: "sale.create",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "k",
    };

    expect(() => SaleCreateRequestSchema.parse({ ...envelope, payload })).not.toThrow();
    expect(() => SaleCreateRequestSchema.parse({
      ...envelope, payload: { ...payload, user_id: USER },
    })).toThrow();
  });

  it("una operación mutante exige operation_id e idempotency_key", () => {
    const attempt = () => CashShiftOpenRequestSchema.parse({
      ...BASE,
      message_type: "cash.shift.open",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload: {
        cash_register_id: REGISTER,
        opening_amount: "0.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      },
    });
    expect(attempt).toThrow();
  });

  it("el contrato rechaza un importe de apertura negativo en la frontera", () => {
    expect(() => openShiftRequest({
      payload: {
        cash_register_id: REGISTER,
        opening_amount: "-100.000000",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
      },
    })).toThrow();
  });
});

// ── Conexión no vinculada ────────────────────────────────────────────────────

describe("operaciones comerciales — la conexión debe estar vinculada", () => {
  it("una conexión sin vínculo no obtiene identidad", async () => {
    const { handler, database } = await buildEnv();
    seedAuthorization(database);
    seedRegister(database);

    const result = response(handler.handle(openShiftRequest(), randomUUID()));

    expect(result.status).toBe("REJECTED");
    expect(result.result_code).toBe("SESSION_NOT_BOUND");
    expect(result.error?.category).toBe("AUTHENTICATION");
  });

  it("un connectionId inventado no hereda el vínculo de otra conexión", async () => {
    const { handler, database } = await buildEnv();
    seedAuthorization(database);
    seedRegister(database);

    const legitimate = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), legitimate);

    // La conexión legítima opera.
    expect(response(handler.handle(openShiftRequest(), legitimate)).status).toBe("SUCCEEDED");

    // Otro identificador cualquiera no.
    const forged = response(handler.handle(
      openShiftRequest({ idempotency_key: "shift:open:ipc:forged" }),
      randomUUID(),
    ));
    expect(forged.status).toBe("REJECTED");
    expect(forged.result_code).toBe("SESSION_NOT_BOUND");
  });

  it("sin snapshot de autorización activo no hay operación", async () => {
    const { handler, database } = await buildEnv();
    seedRegister(database); // sin seedAuthorization

    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const result = response(handler.handle(openShiftRequest(), connection));
    expect(result.status).toBe("REJECTED");
    expect(result.result_code).toBe("AUTHORIZATION_SNAPSHOT_UNAVAILABLE");
  });

  it("el permiso se evalúa contra el snapshot del usuario vinculado", async () => {
    const { handler, database } = await buildEnv();
    seedAuthorization(database, USER, []); // sin permisos
    seedRegister(database);

    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const result = response(handler.handle(openShiftRequest(), connection));
    expect(result.status).toBe("REJECTED");
    expect(result.result.outcome).toBe("UNAUTHORIZED");
    expect(result.error?.category).toBe("AUTHORIZATION");
  });
});

// ── Ciclo de vida del vínculo ────────────────────────────────────────────────

describe("ciclo de vida del vínculo", () => {
  it("la desconexión invalida el vínculo", async () => {
    const { handler, commercial } = await buildEnv();
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);
    expect(commercial.bindings.resolve(connection)).not.toBeNull();

    commercial.bindings.release(connection);

    expect(commercial.bindings.resolve(connection)).toBeNull();
  });

  it("dos conexiones mantienen vínculos independientes", async () => {
    const { handler, commercial } = await buildEnv();
    const first = randomUUID();
    const second = randomUUID();

    handler.handle(activateRequest(signSession(sessionClaims())), first);
    // La segunda conexión no hereda nada por existir.
    expect(commercial.bindings.resolve(first)).not.toBeNull();
    expect(commercial.bindings.resolve(second)).toBeNull();

    commercial.bindings.release(first);
    expect(commercial.bindings.resolve(first)).toBeNull();
  });

  it("una sesión expirada deja de resolver aunque la conexión siga viva", async () => {
    const { handler, commercial } = await buildEnv();
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);
    expect(commercial.bindings.resolve(connection)).not.toBeNull();

    // Un registro cuyo reloj ya pasó la vigencia de la SSA.
    const expired = new (commercial.bindings.constructor as new (now: () => Date) => typeof commercial.bindings)(
      () => new Date("2026-09-05T00:00:00.000Z"),
    );
    expired.bind(connection, {
      userId: USER,
      ssaSessionId: SSA_SESSION,
      tenantMembershipId: MEMBERSHIP,
      offlineValidUntil: "2026-09-04T00:00:00.000Z",
    });
    expect(expired.resolve(connection)).toBeNull();
  });

  it("detener el componente invalida todos los vínculos", async () => {
    const { handler, commercial } = await buildEnv();
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    await commercial.stop();

    expect(commercial.bindings.size).toBe(0);
  });
});

// ── session.recover ──────────────────────────────────────────────────────────

describe("session.recover — rehidratación desde la SSA durable", () => {
  function recoverRequest() {
    return {
      ...BASE,
      message_type: "session.recover" as const,
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload: {},
    };
  }

  it("sin sesión persistida devuelve NONE", async () => {
    const { handler } = await buildEnv();
    const result = response(handler.handle(recoverRequest() as never, randomUUID()));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.result.outcome).toBe("NONE");
  });

  it("restablece el vínculo en una conexión nueva sin recibir user_id", async () => {
    const { handler, commercial } = await buildEnv();

    // Sesión establecida en una conexión previa que ya no existe.
    const previous = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), previous);
    commercial.bindings.release(previous);

    const reconnected = randomUUID();
    const result = response(handler.handle(recoverRequest() as never, reconnected));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.result.outcome).toBe("ACTIVE");
    expect(result.result.session_id).toBe(SSA_SESSION);
    expect(commercial.bindings.resolve(reconnected)?.userId).toBe(USER);
  });

  it("con dos sesiones vigentes en el dispositivo no elige ninguna", async () => {
    const { handler, commercial } = await buildEnv();

    handler.handle(activateRequest(signSession(sessionClaims())), randomUUID());
    handler.handle(
      activateRequest(signSession(sessionClaims({
        user_id: ATTACKER,
        session_id: "018f0000-0000-7000-8000-0000000000b9",
      }))),
      randomUUID(),
    );

    const connection = randomUUID();
    const result = response(handler.handle(recoverRequest() as never, connection));

    expect(result.status).toBe("REJECTED");
    expect(result.result.decision).toBe("AMBIGUOUS_DEVICE_SESSION");
    expect(commercial.bindings.resolve(connection)).toBeNull();
  });
});

// ── Flujo completo ───────────────────────────────────────────────────────────

describe("flujo comercial sobre el handler real — sin transporte", () => {
  it("activate → cash.shift.open → sale.create sobre la misma conexión", async () => {
    const { handler, database } = await buildEnv();
    seedAuthorization(database);
    seedRegister(database);

    const connection = randomUUID();
    expect(response(handler.handle(activateRequest(signSession(sessionClaims())), connection)).status)
      .toBe("SUCCEEDED");

    const opened = response(handler.handle(openShiftRequest(), connection));
    expect(opened.status).toBe("SUCCEEDED");
    expect(opened.result.outcome).toBe("OPENED");

    // El turno quedó atribuido al usuario de la SSA, no al dispositivo.
    const audit = database.native.prepare(
      `SELECT actor_type, actor_id, session_id FROM local_operation_audit
        WHERE action_code='CASH_SHIFT_OPENED'`,
    ).get() as { actor_type: string; actor_id: string; session_id: string };
    expect(audit.actor_type).toBe("USER");
    expect(audit.actor_id).toBe(USER);
    expect(audit.session_id).toBe(SSA_SESSION);
  });

  it("el cierre idempotente no reconstruye importes (M3 de 4D)", async () => {
    const { handler, database } = await buildEnv();
    seedAuthorization(database);
    seedRegister(database);

    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);
    const opened = response(handler.handle(openShiftRequest(), connection));
    const shiftId = opened.result.shift_id as string;

    const closeRequest = (key: string) => ({
      ...BASE,
      message_type: "cash.shift.close" as const,
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: key,
      payload: { shift_id: shiftId, counted_amount: "0.000000", expected_version: 1 },
    });

    const closed = response(handler.handle(closeRequest("shift:close:ipc:1") as never, connection));
    expect(closed.result.outcome).toBe("CLOSED");
    expect(closed.result.expected_cash).toBe("0.000000");

    const retry = response(handler.handle(closeRequest("shift:close:ipc:1") as never, connection));
    expect(retry.result.outcome).toBe("IDEMPOTENT");
    expect(retry.result.expected_cash).toBeNull();
  });
});


// ── customer.register · customer.get · customer.find ─────────────────────────

/**
 * Estas pruebas no repiten las reglas del adquiriente —eso ya está cubierto en
 * `customer.test.ts` y en `fiscal-customer.test.ts`—. Lo que fijan es otra
 * cosa: que la capacidad **es alcanzable de extremo a extremo** por el canal
 * de producción.
 *
 * Es la lección que dejó Payment V1: estaba implementado y probado, y ningún
 * cliente podía usarlo porque faltaban los `case` del enrutamiento. Un módulo
 * sin esta prueba vale `TESTED`, no `CANONICALLY_APPLIED`.
 */

const CUSTOMER_PERMISSIONS = ["CUSTOMERS_CUSTOMER_REGISTER", "CUSTOMERS_CUSTOMER_READ"];

function registerCustomerRequest(overrides: Record<string, unknown> = {}) {
  return CustomerRegisterRequestSchema.parse({
    ...BASE,
    message_type: "customer.register",
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: "customer:register:ipc:1",
    payload: {
      identification_document_code: "31",
      identification: "900123456",
      verification_digit: "7",
      legal_organization_code: "1",
      company: "Comercializadora del Valle S.A.S.",
      names: null,
      tribute_code: "ZZ",
      fiscal_responsibility_codes: ["R-99-PN"],
      email: "facturacion@example.co",
      phone: "6041234567",
      address: "Carrera 4 # 5-6",
      country_code: "CO",
      municipality_code: "05001",
    },
    ...overrides,
  });
}

describe("customer.* — el adquiriente es alcanzable por el canal", () => {
  it("registra un adquiriente y lo devuelve por identidad fiscal", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CUSTOMER_PERMISSIONS);
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const registered = response(handler.handle(registerCustomerRequest(), connection));
    expect(registered.status).toBe("SUCCEEDED");
    expect(registered.result["outcome"]).toBe("REGISTERED");
    const customerId = registered.result["customer_id"];
    expect(typeof customerId).toBe("string");

    const found = response(handler.handle(CustomerFindRequestSchema.parse({
      ...BASE,
      message_type: "customer.find",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload: { identification_document_code: "31", identification: "900123456" },
    }), connection));

    expect(found.status).toBe("SUCCEEDED");
    expect(found.result["customer_id"]).toBe(customerId);
    // La identificación vuelve **sin** el dígito de verificación, que viaja aparte.
    expect(found.result["identification"]).toBe("900123456");
    expect(found.result["verification_digit"]).toBe("7");
  });

  it("y también por identificador interno", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CUSTOMER_PERMISSIONS);
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const registered = response(handler.handle(registerCustomerRequest(), connection));
    const found = response(handler.handle(CustomerGetRequestSchema.parse({
      ...BASE,
      message_type: "customer.get",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload: { customer_id: registered.result["customer_id"] },
    }), connection));

    expect(found.status).toBe("SUCCEEDED");
    expect(found.result["company"]).toBe("Comercializadora del Valle S.A.S.");
  });

  /**
   * Los hallazgos llegan al renderer con **código y ruta, nunca el valor del
   * campo**. Un adquiriente contiene datos personales; devolverlos en el error
   * los llevaría a los registros del renderer, que es justo la frontera que el
   * handler existe para no cruzar.
   */
  it("un adquiriente inválido devuelve hallazgos sin filtrar datos personales", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CUSTOMER_PERMISSIONS);
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const rejectedResponse = response(handler.handle(registerCustomerRequest({
      payload: {
        identification_document_code: "31",
        identification: "900123456",
        verification_digit: "7",
        legal_organization_code: "1",
        company: null,
        names: null,
        tribute_code: "99",
        fiscal_responsibility_codes: ["R-99-PN"],
        email: "facturacion@example.co",
        phone: "6041234567",
        address: "Carrera 4 # 5-6",
        country_code: "CO",
        municipality_code: "05001",
      },
    }), connection));

    expect(rejectedResponse.status).toBe("REJECTED");
    expect(rejectedResponse.result["outcome"]).toBe("INVALID");
    const findings = rejectedResponse.result["findings"] as Array<Record<string, string>>;
    expect(findings.map((f) => f.code).sort()).toEqual([
      "COMPANY_REQUIRED_FOR_LEGAL_ENTITY",
      "TRIBUTE_CODE_NOT_VERIFIED",
    ]);
    const serialized = JSON.stringify(findings);
    for (const value of ["900123456", "facturacion@example.co", "6041234567", "Carrera 4 # 5-6"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("sin vínculo de sesión no se registra nada", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CUSTOMER_PERMISSIONS);
    const result = response(handler.handle(registerCustomerRequest(), randomUUID()));
    expect(result.status).toBe("REJECTED");
    expect(result.result["outcome"]).toBe("UNAUTHORIZED");
    expect((database.native.prepare("SELECT count(*) AS n FROM customers_customers")
      .get() as { n: number }).n).toBe(0);
  });
});

// ── catalog.product.register · catalog.item.find ─────────────────────────────

/**
 * Igual que con el adquiriente: esto no repite las reglas del catálogo —ya
 * están en `catalog.test.ts`— sino que fija que **la capacidad es alcanzable de
 * extremo a extremo** por el canal de producción.
 */

const CATALOG_PERMISSIONS = ["CATALOG_PRODUCT_REGISTER", "CATALOG_PRODUCT_READ"];

function registerProductRequest(overrides: Record<string, unknown> = {}) {
  return CatalogProductRegisterRequestSchema.parse({
    ...BASE,
    message_type: "catalog.product.register",
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: "catalog:register:ipc:1",
    payload: {
      code: "CAFE-001",
      name: "Café Americano 500 g",
      stock_controlled: true,
      presentation_name: "Bolsa 500 g",
      unit_code: "UND",
      unit_precision: 0,
      barcode: "7701234567890",
      price_amount: "18000.000000",
      currency_code: "COP",
    },
    ...overrides,
  });
}

describe("catalog.* — el catálogo es alcanzable por el canal", () => {
  it("registra un producto y lo devuelve al escanear su código de barras", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CATALOG_PERMISSIONS);
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const registered = response(handler.handle(registerProductRequest(), connection));
    expect(registered.status).toBe("SUCCEEDED");
    expect(registered.result["outcome"]).toBe("REGISTERED");

    const found = response(handler.handle(CatalogItemFindRequestSchema.parse({
      ...BASE,
      message_type: "catalog.item.find",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload: { barcode: "7701234567890" },
    }), connection));

    expect(found.status).toBe("SUCCEEDED");
    expect(found.result["presentation_id"]).toBe(registered.result["presentation_id"]);
    expect(found.result["code"]).toBe("CAFE-001");
    expect(found.result["unit_precision"]).toBe(0);
    expect(found.result["price_amount"]).toBe("18000.000000");
  });

  it("un código de barras repetido se rechaza por el canal y dice cuál lo tiene", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CATALOG_PERMISSIONS);
    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const first = response(handler.handle(registerProductRequest(), connection));
    const second = response(handler.handle(registerProductRequest({
      idempotency_key: "catalog:register:ipc:2",
      operation_id: randomUUID(),
      payload: {
        code: "CAFE-002", name: "Otro café", stock_controlled: true,
        presentation_name: "Bolsa", unit_code: "UND", unit_precision: 0,
        barcode: "7701234567890", price_amount: "20000.000000", currency_code: "COP",
      },
    }), connection));

    expect(second.status).toBe("REJECTED");
    expect(second.result["outcome"]).toBe("BARCODE_ALREADY_REGISTERED");
    expect(second.result["presentation_id"]).toBe(first.result["presentation_id"]);
  });

  it("sin vínculo de sesión no se registra nada", async () => {
    const { database, handler } = await buildEnv();
    seedAuthorization(database, USER, CATALOG_PERMISSIONS);
    const result = response(handler.handle(registerProductRequest(), randomUUID()));
    expect(result.status).toBe("REJECTED");
    expect((database.native.prepare("SELECT count(*) AS n FROM catalog_product")
      .get() as { n: number }).n).toBe(0);
  });
});

// ── inventory.stock.receive · adjust · get ───────────────────────────────────

/**
 * Igual que en catálogo y adquiriente: esto no repite las reglas del inventario
 * —están en `inventory.test.ts`— sino que fija que **la capacidad es alcanzable
 * de extremo a extremo** por el canal de producción, con su permiso.
 */

const INVENTORY_PERMISSIONS = [
  "CATALOG_PRODUCT_REGISTER",
  "INVENTORY_STOCK_RECEIVE",
  "INVENTORY_STOCK_ADJUST",
  "INVENTORY_STOCK_READ",
];

describe("inventory.* — el inventario es alcanzable por el canal", () => {
  async function withProduct() {
    const env = await buildEnv();
    seedAuthorization(env.database, USER, INVENTORY_PERMISSIONS);
    const connection = randomUUID();
    env.handler.handle(activateRequest(signSession(sessionClaims())), connection);
    const registered = response(env.handler.handle(registerProductRequest(), connection));
    return { ...env, connection, presentationId: registered.result["presentation_id"] as string };
  }

  it("recibe, ajusta y consulta la existencia por el canal", async () => {
    const { handler, connection, presentationId } = await withProduct();

    const received = response(handler.handle(InventoryStockReceiveRequestSchema.parse({
      ...BASE,
      message_type: "inventory.stock.receive",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "inventory:receive:ipc:1",
      payload: {
        presentation_id: presentationId,
        movement_type: "PURCHASE_RECEIPT",
        quantity: "12.000000",
        reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-07",
      },
    }), connection));

    expect(received.status).toBe("SUCCEEDED");
    expect(received.result["outcome"]).toBe("POSTED");
    expect(received.result["quantity_after"]).toBe("12.000000");

    const adjusted = response(handler.handle(InventoryStockAdjustRequestSchema.parse({
      ...BASE,
      message_type: "inventory.stock.adjust",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "inventory:adjust:ipc:1",
      payload: {
        presentation_id: presentationId,
        movement_type: "SHRINKAGE",
        quantity: "2.000000",
        reason_code: "DAMAGED_GOODS",
        business_date: "2026-09-07",
      },
    }), connection));

    expect(adjusted.status).toBe("SUCCEEDED");
    expect(adjusted.result["quantity_after"]).toBe("10.000000");

    const stock = response(handler.handle(InventoryStockGetRequestSchema.parse({
      ...BASE,
      message_type: "inventory.stock.get",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload: { presentation_id: presentationId },
    }), connection));

    expect(stock.status).toBe("SUCCEEDED");
    expect(stock.result["quantity_on_hand"]).toBe("10.000000");
    expect(stock.result["last_movement_sequence"]).toBe(2);
  });

  it("el canal rechaza el ajuste que dejaría la existencia negativa y dice cuánto hay", async () => {
    const { handler, connection, presentationId } = await withProduct();

    handler.handle(InventoryStockReceiveRequestSchema.parse({
      ...BASE,
      message_type: "inventory.stock.receive",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "inventory:receive:ipc:2",
      payload: {
        presentation_id: presentationId,
        movement_type: "PURCHASE_RECEIPT",
        quantity: "1.000000",
        reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-07",
      },
    }), connection);

    const rejected = response(handler.handle(InventoryStockAdjustRequestSchema.parse({
      ...BASE,
      message_type: "inventory.stock.adjust",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "inventory:adjust:ipc:2",
      payload: {
        presentation_id: presentationId,
        movement_type: "ADJUSTMENT_NEGATIVE",
        quantity: "5.000000",
        reason_code: "COUNT_CORRECTION",
        business_date: "2026-09-07",
      },
    }), connection));

    expect(rejected.status).toBe("REJECTED");
    expect(rejected.result["outcome"]).toBe("INSUFFICIENT_STOCK");
    expect(rejected.result["available"]).toBe("1.000000");
  });

  it("sin vínculo de sesión no se mueve existencia", async () => {
    const { database, handler, presentationId } = await withProduct();

    const result = response(handler.handle(InventoryStockReceiveRequestSchema.parse({
      ...BASE,
      message_type: "inventory.stock.receive",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "inventory:receive:ipc:3",
      payload: {
        presentation_id: presentationId,
        movement_type: "PURCHASE_RECEIPT",
        quantity: "1.000000",
        reason_code: "SUPPLIER_DELIVERY",
        business_date: "2026-09-07",
      },
    }), randomUUID()));

    expect(result.status).toBe("REJECTED");
    expect(result.result["outcome"]).toBe("UNAUTHORIZED");
    expect((database.native.prepare("SELECT count(*) AS n FROM inventory_movement")
      .get() as { n: number }).n).toBe(0);
  });
});


// ── payment.register.qr — alcance por el handler comercial ───────────────────

function registerQrPaymentRequest() {
  return PaymentRegisterQrRequestSchema.parse({
    ...BASE,
    message_type: "payment.register.qr",
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: "payment:register:qr:ipc:1",
    payload: {
      sale_id: REGISTER,
      amount: "50000.000000",
    },
  });
}

describe("payment.register.qr — alcance por el handler real", () => {
  it("un QR sin proveedor configurado se rechaza antes de crear cualquier pago", async () => {
    const { handler, database } = await buildEnv();
    seedAuthorization(database, USER, ["PAYMENTS_TRANSFER_REPORT"]);

    const connection = randomUUID();
    handler.handle(activateRequest(signSession(sessionClaims())), connection);

    const result = response(handler.handle(registerQrPaymentRequest(), connection));

    expect(result.status).toBe("REJECTED");
    expect(result.result_code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(result.result.outcome).toBe("PROVIDER_NOT_CONFIGURED");
    expect((database.native.prepare("SELECT count(*) AS n FROM payments_payments")
      .get() as { n: number }).n).toBe(0);
  });
});
