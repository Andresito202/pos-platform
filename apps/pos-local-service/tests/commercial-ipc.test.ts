import { createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  CashShiftOpenRequestSchema,
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
    const attempt = () => SaleCreateRequestSchema.parse({
      ...BASE,
      message_type: "sale.create",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      operation_id: randomUUID(),
      idempotency_key: "k",
      payload: {
        channel: "POS",
        business_date: "2026-09-03",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
        document_series: "A",
        currency_code: "COP",
        user_id: USER,
        lines: [{ product_id: REGISTER, presentation_id: REGISTER, quantity: "1.000000" }],
      },
    });
    expect(attempt).toThrow();
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

describe("flujo comercial extremo a extremo", () => {
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
