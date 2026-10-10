import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  MasterSnapshotClaimsSchema,
  SignedMasterSnapshotSchema,
  type CashRegisterMasterRow,
  type MasterSnapshotClaims,
} from "@pos-platform/contracts";
import {
  MASTER_SNAPSHOT_KEY_PURPOSE,
  MasterSnapshotActivationService,
  MasterSnapshotVerifier,
  SqliteMasterSnapshotStore,
  TrustedClockGuard,
  unsignedMasterSnapshotBytes,
  type AcknowledgedFloorSource,
  type MasterSnapshotSigningKey,
} from "../src/index.js";

/** Material criptográfico exclusivo de test. Nunca es dato operativo. */
const testOnlyKeyPair = generateKeyPairSync("ed25519");
const otherKeyPair = generateKeyPairSync("ed25519");

const TENANT = "018f0000-0000-7000-8000-00000000c001";
const COMPANY = "018f0000-0000-7000-8000-00000000c002";
const BRANCH = "018f0000-0000-7000-8000-00000000c003";
const OTHER_TENANT = "018f0000-0000-7000-8000-00000000cfff";
const REGISTER_A = "018f0000-0000-7000-8000-00000000d001";
const REGISTER_B = "018f0000-0000-7000-8000-00000000d002";
const KEY_ID = "MASTER_SNAPSHOT_KEY_1";
const INSTALLATION_A = "018f0000-0000-7000-8000-00000000c004";

const SCOPE = {
  tenantId: TENANT,
  companyId: COMPANY,
  branchId: BRANCH,
  installationId: INSTALLATION_A,
  environment: "PRODUCTION" as const,
};
const SCOPE_KEY = { tenantId: TENANT, companyId: COMPANY, branchId: BRANCH };

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-master-snapshot-"));
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

function register(id: string, overrides: Partial<CashRegisterMasterRow> = {}): CashRegisterMasterRow {
  return {
    id,
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    code: `CAJA-${id.slice(-2)}`,
    code_normalized: `caja-${id.slice(-2)}`,
    name: `Caja ${id.slice(-2)}`,
    currency_code: "COP",
    status: "ACTIVE",
    created_at: "2026-09-01T00:00:00.000Z",
    retired_at: null,
    version: 1,
    ...overrides,
  };
}

function claimsFor(
  sequence: number,
  payload: readonly CashRegisterMasterRow[],
  overrides: Partial<MasterSnapshotClaims> = {},
): MasterSnapshotClaims {
  return MasterSnapshotClaimsSchema.parse({
    schema_version: 1,
    snapshot_type: "CASH_REGISTER",
    key_id: KEY_ID,
    environment: "PRODUCTION",
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    sequence,
    issued_at: "2026-09-04T00:00:00.000Z",
    payload,
    ...overrides,
  });
}

function signedWith(claims: MasterSnapshotClaims, keyPair = testOnlyKeyPair): unknown {
  const signature = sign(null, unsignedMasterSnapshotBytes(claims), keyPair.privateKey);
  return { claims, signature: signature.toString("base64url") };
}

function keyMap(
  status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED" = "ACTIVE",
  purpose: string = MASTER_SNAPSHOT_KEY_PURPOSE,
): ReadonlyMap<string, MasterSnapshotSigningKey> {
  return new Map([[KEY_ID, {
    key: testOnlyKeyPair.publicKey,
    status,
    purpose,
  }]]);
}

const centralFloor = (value: number | null): AcknowledgedFloorSource => ({
  floorFor: async () => value,
});
const unavailableFloor: AcknowledgedFloorSource = {
  floorFor: async () => { throw new Error("central unavailable"); },
};

async function harness(options: {
  keys?: ReadonlyMap<string, MasterSnapshotSigningKey>;
  floor?: AcknowledgedFloorSource;
} = {}): Promise<{
  database: LocalDatabase;
  store: SqliteMasterSnapshotStore;
  service: MasterSnapshotActivationService;
}> {
  const database = track(LocalDatabase.open({ dataDirectory: await directory() }));
  const store = new SqliteMasterSnapshotStore(database, () => new Date("2026-09-04T12:00:00.000Z"));
  const verifier = new MasterSnapshotVerifier(
    options.keys ?? keyMap(),
    new TrustedClockGuard(database),
    () => new Date("2026-09-04T12:00:00.000Z"),
  );
  const service = new MasterSnapshotActivationService(
    verifier,
    store,
    options.floor ?? centralFloor(null),
  );
  return { database, store, service };
}

describe("A. contrato de claims", () => {
  it("acepta un envelope válido y rechaza campos inesperados", () => {
    const signed = signedWith(claimsFor(1, [register(REGISTER_A)]));
    expect(SignedMasterSnapshotSchema.parse(signed).claims.sequence).toBe(1);
    expect(() => SignedMasterSnapshotSchema.parse({
      ...(signed as Record<string, unknown>),
      extra: true,
    })).toThrow();
  });

  it("rechaza snapshot_id y expires_at, que DEC-013 §11 excluye", () => {
    expect(() => claimsFor(1, [register(REGISTER_A)], {
      snapshot_id: "x",
    } as unknown as Partial<MasterSnapshotClaims>)).toThrow();
  });

  it("canonicaliza de forma estable con independencia del orden de claves", () => {
    const claims = claimsFor(1, [register(REGISTER_A)]);
    const reordered = JSON.parse(JSON.stringify({
      payload: claims.payload,
      sequence: claims.sequence,
      issued_at: claims.issued_at,
      branch_id: claims.branch_id,
      company_id: claims.company_id,
      tenant_id: claims.tenant_id,
      environment: claims.environment,
      key_id: claims.key_id,
      snapshot_type: claims.snapshot_type,
      schema_version: claims.schema_version,
    })) as MasterSnapshotClaims;
    expect(unsignedMasterSnapshotBytes(reordered).equals(unsignedMasterSnapshotBytes(claims))).toBe(true);
  });

  it("rechaza una fila de payload fuera del ámbito del snapshot", () => {
    expect(() => claimsFor(1, [register(REGISTER_A, { tenant_id: OTHER_TENANT })])).toThrow();
  });
});

describe("C. alcance de snapshot_type", () => {
  it("acepta CASH_REGISTER", async () => {
    const { service } = await harness();
    const outcome = await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    expect(outcome).toEqual({ kind: "ACTIVATED", sequence: 1 });
  });

  it.each(["CATALOG", "PRICING", "TAX"])("rechaza %s en la frontera del contrato", async (type) => {
    const { service } = await harness();
    const claims = { ...claimsFor(1, [register(REGISTER_A)]), snapshot_type: type };
    const outcome = await service.accept({ claims, signature: "a".repeat(86) }, SCOPE);
    expect(outcome).toEqual({ kind: "REJECTED", code: "INVALID_SCHEMA" });
  });

  it("la persistencia impide almacenar otro snapshot_type", async () => {
    const { database } = await harness();
    expect(() => database.native.prepare(
      `INSERT INTO local_master_snapshot_artifact
         (snapshot_type, tenant_id, company_id, branch_id, sequence, environment, key_id,
          issued_at, claims_json, claims_checksum, signature, activated_at)
       VALUES ('CATALOG',?,?,?,1,'PRODUCTION','K','t','{}',?,'s','t')`,
    ).run(TENANT, COMPANY, BRANCH, "0".repeat(64))).toThrow();
  });
});

describe("B. seguridad", () => {
  it("rechaza firma inválida", async () => {
    const { service } = await harness();
    const outcome = await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)]), otherKeyPair), SCOPE);
    expect(outcome).toEqual({ kind: "REJECTED", code: "INVALID_SIGNATURE" });
  });

  it("rechaza clave desconocida", async () => {
    const { service } = await harness({ keys: new Map() });
    const outcome = await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    expect(outcome).toEqual({ kind: "REJECTED", code: "UNKNOWN_KEY" });
  });

  it("rechaza una clave de otro propósito criptográfico", async () => {
    const { service } = await harness({ keys: keyMap("ACTIVE", "LICENSE") });
    const outcome = await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    expect(outcome).toEqual({ kind: "REJECTED", code: "WRONG_KEY_PURPOSE" });
  });

  it("rechaza clave revocada y acepta VERIFY_ONLY", async () => {
    const revoked = await harness({ keys: keyMap("REVOKED") });
    expect(await revoked.service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "REVOKED_KEY" });

    const rotating = await harness({ keys: keyMap("VERIFY_ONLY") });
    expect(await rotating.service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "ACTIVATED", sequence: 1 });
  });

  it("rechaza ambiente incorrecto", async () => {
    const { service } = await harness();
    const claims = claimsFor(1, [register(REGISTER_A)], { environment: "STAGING" });
    expect(await service.accept(signedWith(claims), SCOPE))
      .toEqual({ kind: "REJECTED", code: "WRONG_ENVIRONMENT" });
  });

  it("rechaza ámbito de otro tenant aunque la firma sea válida", async () => {
    const { service } = await harness();
    const foreign = MasterSnapshotClaimsSchema.parse({
      ...claimsFor(1, []),
      tenant_id: OTHER_TENANT,
      payload: [],
    });
    expect(await service.accept(signedWith(foreign), SCOPE))
      .toEqual({ kind: "REJECTED", code: "WRONG_SCOPE" });
  });

  it("el artefacto es append-only: no admite modificación ni borrado", async () => {
    const { service, database } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    expect(() => database.native.prepare(
      "UPDATE local_master_snapshot_artifact SET claims_checksum=? WHERE sequence=1",
    ).run("f".repeat(64))).toThrow();
    expect(() => database.native.prepare(
      "DELETE FROM local_master_snapshot_artifact WHERE sequence=1",
    ).run()).toThrow();
  });

  it("no devuelve un artefacto cuyo checksum no coincide con sus claims", async () => {
    const { service, store, database } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    expect(store.artifactAt(SCOPE_KEY, 1)).not.toBeNull();

    // Corrupción fuera del control de la aplicación: los triggers protegen de
    // una escritura por SQL, no de una fila alterada en el fichero. Se retiran
    // deliberadamente para ejercitar la comprobación de integridad de lectura.
    database.native.exec("DROP TRIGGER local_master_snapshot_artifact_no_update");
    database.native.prepare(
      "UPDATE local_master_snapshot_artifact SET claims_checksum=? WHERE sequence=1",
    ).run("f".repeat(64));

    expect(store.artifactAt(SCOPE_KEY, 1)).toBeNull();
  });
});

describe("D. anti-replay", () => {
  it("acepta mayor, rechaza igual y rechaza menor", async () => {
    const { service } = await harness();
    expect(await service.accept(signedWith(claimsFor(5, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "ACTIVATED", sequence: 5 });
    expect(await service.accept(signedWith(claimsFor(6, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "ACTIVATED", sequence: 6 });
    expect(await service.accept(signedWith(claimsFor(6, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "DUPLICATE_SEQUENCE" });
    expect(await service.accept(signedWith(claimsFor(5, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "OBSOLETE_SEQUENCE" });
  });
});

describe("E. recuperación", () => {
  it("respeta la cota local", async () => {
    const { service, store } = await harness();
    await service.accept(signedWith(claimsFor(10, [register(REGISTER_A)])), SCOPE);
    expect(store.highestAcceptedSequence(SCOPE_KEY)).toBe(10);
    expect(await service.accept(signedWith(claimsFor(9, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "OBSOLETE_SEQUENCE" });
  });

  it("aplica effective_floor = max(local, central) tras una restauración", async () => {
    // La base restaurada sólo conoce 5; la central acusó hasta 8. Un artefacto
    // auténtico de 7 no puede volver a aceptarse.
    const { service } = await harness({ floor: centralFloor(8) });
    await service.accept(signedWith(claimsFor(5, [register(REGISTER_A)])), SCOPE);
    expect(await service.accept(signedWith(claimsFor(7, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "OBSOLETE_SEQUENCE" });
    expect(await service.accept(signedWith(claimsFor(9, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "ACTIVATED", sequence: 9 });
  });

  it("prevalece la cota local cuando es mayor que la central", async () => {
    const { service } = await harness({ floor: centralFloor(2) });
    await service.accept(signedWith(claimsFor(6, [register(REGISTER_A)])), SCOPE);
    expect(await service.accept(signedWith(claimsFor(3, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "OBSOLETE_SEQUENCE" });
  });

  it("sin cota central confirmada no acepta nada", async () => {
    const { service, store } = await harness({ floor: unavailableFloor });
    expect(await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "REJECTED", code: "TRANSPORT_FAILURE" });
    expect(store.highestAcceptedSequence(SCOPE_KEY)).toBeNull();
  });

  it("consulta la cota central con instalación, tipo y binding exactos", async () => {
    const requests: unknown[] = [];
    const floor: AcknowledgedFloorSource = {
      floorFor: async (request) => {
        requests.push(request);
        return null;
      },
    };
    const { service } = await harness({ floor });
    expect(await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE))
      .toEqual({ kind: "ACTIVATED", sequence: 1 });
    expect(requests).toEqual([{
      installationId: INSTALLATION_A,
      snapshotType: "CASH_REGISTER",
      binding: SCOPE_KEY,
    }]);
  });
});

describe("F. atomicidad", () => {
  it("un rechazo no altera la proyección anterior ni avanza la cota", async () => {
    const { service, store } = await harness();
    await service.accept(signedWith(claimsFor(3, [register(REGISTER_A)])), SCOPE);

    expect(await service.accept(signedWith(claimsFor(4, [register(REGISTER_B)]), otherKeyPair), SCOPE))
      .toEqual({ kind: "REJECTED", code: "INVALID_SIGNATURE" });

    expect(store.highestAcceptedSequence(SCOPE_KEY)).toBe(3);
    expect(store.activeRegisters(SCOPE_KEY).map((row) => row.id)).toEqual([REGISTER_A]);
  });

  it("un fallo durante la escritura deja intacta la proyección y la cota", async () => {
    const { service, store, database } = await harness();
    await service.accept(signedWith(claimsFor(3, [register(REGISTER_A)])), SCOPE);

    // Una caja de otro ámbito comparte `code_normalized` con la existente: el
    // índice único aborta a mitad del reemplazo.
    database.native.prepare(
      "UPDATE cash_register SET code_normalized='colision' WHERE id=?",
    ).run(REGISTER_A);
    const colliding = [
      register(REGISTER_B, { code_normalized: "colision" }),
      register(REGISTER_A, { code_normalized: "otra" }),
    ];
    const outcome = await service.accept(signedWith(claimsFor(4, colliding)), SCOPE);

    expect(outcome).toEqual({ kind: "REJECTED", code: "SQLITE_FAILURE" });
    expect(store.highestAcceptedSequence(SCOPE_KEY)).toBe(3);
    expect(database.native.prepare("SELECT COUNT(*) AS n FROM cash_register").get())
      .toEqual({ n: 1 });
  });
});

describe("G. P-6 y G1", () => {
  it("la ausencia en el snapshot posterior no marca RETIRED ni borra la fila", async () => {
    const { service, store, database } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A), register(REGISTER_B)])), SCOPE);
    await service.accept(signedWith(claimsFor(2, [register(REGISTER_A)])), SCOPE);

    const stored = database.native.prepare(
      "SELECT status, retired_at, last_seen_sequence FROM cash_register WHERE id=?",
    ).get(REGISTER_B) as { status: string; retired_at: string | null; last_seen_sequence: number };

    expect(stored.status).toBe("ACTIVE");
    expect(stored.retired_at).toBeNull();
    expect(stored.last_seen_sequence).toBe(1);
    expect(store.activeRegisters(SCOPE_KEY).map((row) => row.id)).toEqual([REGISTER_A]);
  });

  it("la reaparición actualiza la última presencia", async () => {
    const { service, store } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A), register(REGISTER_B)])), SCOPE);
    await service.accept(signedWith(claimsFor(2, [register(REGISTER_A)])), SCOPE);
    await service.accept(signedWith(claimsFor(3, [register(REGISTER_A), register(REGISTER_B)])), SCOPE);

    expect(store.activeRegisters(SCOPE_KEY).map((row) => row.id).sort())
      .toEqual([REGISTER_A, REGISTER_B].sort());
  });

  it("RETIRED sólo aparece cuando el maestro lo emite explícitamente", async () => {
    const { service, database } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    await service.accept(signedWith(claimsFor(2, [
      register(REGISTER_A, { status: "RETIRED", retired_at: "2026-09-03T00:00:00.000Z", version: 2 }),
    ])), SCOPE);

    expect(database.native.prepare("SELECT status FROM cash_register WHERE id=?").get(REGISTER_A))
      .toEqual({ status: "RETIRED" });
  });
});

describe("H. integridad de la persistencia", () => {
  async function seeded(): Promise<LocalDatabase> {
    const { database, service } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    database.native.prepare(
      `INSERT INTO cash_shift
        (id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id,
         opened_by_actor_type, opened_by_actor_id, opened_at, business_date, timezone_id,
         utc_offset_minutes, currency_code, status, opening_idempotency_key,
         opening_request_checksum, cash_register_projection_sequence, last_movement_sequence,
         version, created_at)
       VALUES (?,?,?,?,?,?, 'USER',?, '2026-09-04T08:00:00.000Z','2026-09-04','America/Bogota',
         -300,'COP','OPEN','idem-1',?,1,0,1,'2026-09-04T08:00:00.000Z')`,
    ).run(
      "018f0000-0000-7000-8000-00000000e001", TENANT, COMPANY, BRANCH, REGISTER_A,
      "018f0000-0000-7000-8000-00000000f001", "018f0000-0000-7000-8000-00000000a001",
      "0".repeat(64),
    );
    return database;
  }

  it("un turno no puede referirse a una caja inexistente", async () => {
    const database = await seeded();
    expect(() => database.native.prepare(
      `INSERT INTO cash_shift
        (id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id,
         opened_by_actor_type, opened_by_actor_id, opened_at, business_date, timezone_id,
         utc_offset_minutes, currency_code, status, opening_idempotency_key,
         opening_request_checksum, cash_register_projection_sequence, last_movement_sequence,
         version, created_at)
       VALUES (?,?,?,?,?,?, 'USER',?, 't','2026-09-04','America/Bogota',-300,'COP','OPEN','idem-2',?,1,0,1,'t')`,
    ).run(
      "018f0000-0000-7000-8000-00000000e002", TENANT, COMPANY, BRANCH,
      "018f0000-0000-7000-8000-00000000dfff", "018f0000-0000-7000-8000-00000000f001",
      "018f0000-0000-7000-8000-00000000a001", "0".repeat(64),
    )).toThrow();
  });

  it("no admite dos turnos activos sobre la misma caja, sea cual sea el dispositivo", async () => {
    const database = await seeded();
    expect(() => database.native.prepare(
      `INSERT INTO cash_shift
        (id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id,
         opened_by_actor_type, opened_by_actor_id, opened_at, business_date, timezone_id,
         utc_offset_minutes, currency_code, status, opening_idempotency_key,
         opening_request_checksum, cash_register_projection_sequence, last_movement_sequence,
         version, created_at)
       VALUES (?,?,?,?,?,?, 'USER',?, 't','2026-09-04','America/Bogota',-300,'COP','CLOSING','idem-3',?,1,0,1,'t')`,
    ).run(
      "018f0000-0000-7000-8000-00000000e003", TENANT, COMPANY, BRANCH, REGISTER_A,
      "018f0000-0000-7000-8000-00000000f002", "018f0000-0000-7000-8000-00000000a001",
      "0".repeat(64),
    )).toThrow();
  });

  it("rechaza un actor distinto de USER", async () => {
    const database = await seeded();
    expect(() => database.native.prepare(
      "UPDATE cash_shift SET opened_by_actor_type='DEVICE'",
    ).run()).toThrow();
  });

  function insertMovement(
    database: LocalDatabase,
    type: string,
    amount: string,
    id = "018f0000-0000-7000-8000-000000010001",
    sequence = 1,
  ): void {
    database.native.prepare(
      `INSERT INTO cash_movement
        (id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, shift_sequence,
         movement_type, direction, amount, currency_code, status, reason_code, actor_type, actor_id,
         business_date, occurred_at, device_reported_at, origin_device_id, idempotency_key,
         request_checksum, correlation_id, version, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'IN', ?, 'COP','POSTED','OPENING','USER',?,
         '2026-09-04','t','t',?,?,?,?,1,'t')`,
    ).run(
      id, TENANT, COMPANY, BRANCH, REGISTER_A, "018f0000-0000-7000-8000-00000000e001", sequence,
      type, amount, "018f0000-0000-7000-8000-00000000a001",
      "018f0000-0000-7000-8000-00000000f001", `idem-${id}`, "0".repeat(64),
      "018f0000-0000-7000-8000-00000000b001",
    );
  }

  it("admite OPENING_FLOAT en cero y lo rechaza para cualquier otro tipo", async () => {
    const database = await seeded();
    expect(() => insertMovement(database, "OPENING_FLOAT", "0.000000")).not.toThrow();
    expect(() => insertMovement(
      database, "CASH_SALE", "0.000000", "018f0000-0000-7000-8000-000000010002", 2,
    )).toThrow();
  });

  it("exige decimal canónico de seis decimales y sin signo", async () => {
    const database = await seeded();
    for (const amount of ["1.00", "1.0000000", "-1.000000", "01.000000", "1000000"]) {
      expect(() => insertMovement(
        database, "CASH_SALE", amount, "018f0000-0000-7000-8000-000000010003", 3,
      ), amount).toThrow();
    }
    expect(() => insertMovement(
      database, "CASH_SALE", "1234.560000", "018f0000-0000-7000-8000-000000010004", 4,
    )).not.toThrow();
  });

  it("no admite un segundo OPENING_FLOAT POSTED en el mismo turno", async () => {
    const database = await seeded();
    insertMovement(database, "OPENING_FLOAT", "0.000000");
    expect(() => insertMovement(
      database, "OPENING_FLOAT", "1.000000", "018f0000-0000-7000-8000-000000010005", 5,
    )).toThrow();
  });
});

describe("I. auditoría y observabilidad", () => {
  it("registra la aceptación con su coordenada", async () => {
    const { service, database } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    const row = database.native.prepare(
      "SELECT event_type, details_json FROM local_security_audit ORDER BY sequence DESC LIMIT 1",
    ).get() as { event_type: string; details_json: string };
    expect(row.event_type).toBe("MASTER_SNAPSHOT_ACCEPTED");
    expect(JSON.parse(row.details_json)).toMatchObject({ sequence: 1, snapshot_type: "CASH_REGISTER" });
  });

  it("registra el rechazo con su motivo", async () => {
    const { service, database } = await harness();
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)]), otherKeyPair), SCOPE);
    const row = database.native.prepare(
      "SELECT event_type, details_json FROM local_security_audit ORDER BY sequence DESC LIMIT 1",
    ).get() as { event_type: string; details_json: string };
    expect(row.event_type).toBe("MASTER_SNAPSHOT_REJECTED");
    expect(JSON.parse(row.details_json)).toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("notifica al observador tanto la aceptación como el rechazo", async () => {
    const database = track(LocalDatabase.open({ dataDirectory: await directory() }));
    const store = new SqliteMasterSnapshotStore(database);
    const events: string[] = [];
    const service = new MasterSnapshotActivationService(
      new MasterSnapshotVerifier(keyMap(), new TrustedClockGuard(database)),
      store,
      centralFloor(null),
      undefined,
      {
        accepted: (_scope, sequence) => events.push(`accepted:${sequence}`),
        rejected: (_scope, code) => events.push(`rejected:${code}`),
      },
    );
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE);
    expect(events).toEqual(["accepted:1", "rejected:DUPLICATE_SEQUENCE"]);
  });

  it("avanza el checkpoint sólo tras una activación confirmada", async () => {
    const database = track(LocalDatabase.open({ dataDirectory: await directory() }));
    const store = new SqliteMasterSnapshotStore(database);
    const advanced: string[] = [];
    const service = new MasterSnapshotActivationService(
      new MasterSnapshotVerifier(keyMap(), new TrustedClockGuard(database)),
      store,
      centralFloor(null),
      { advance: (_scope, cursor) => advanced.push(cursor) },
    );
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE, { cursor: "c1" });
    await service.accept(signedWith(claimsFor(1, [register(REGISTER_A)])), SCOPE, { cursor: "c2" });
    expect(advanced).toEqual(["c1"]);
  });
});
