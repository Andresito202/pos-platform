import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import type { FiscalCustomer } from "@pos-platform/fiscal-adapters";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCustomerStore } from "../src/customers/sqlite-customer-store.js";
import { RegisterCustomerUseCase } from "../src/customers/register-customer-use-case.js";
import { GetCustomerUseCase } from "../src/customers/get-customer-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc01";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");
const ALL_PERMISSIONS = ["CUSTOMERS_CUSTOMER_REGISTER", "CUSTOMERS_CUSTOMER_READ"];

const NATURAL: FiscalCustomer = {
  identificationDocumentCode: "13",
  identification: "1020304050",
  verificationDigit: null,
  legalOrganizationCode: "2",
  company: null,
  names: "Ana Restrepo",
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: "ana@example.co",
  phone: "3001234567",
  address: "Calle 1 # 2-3",
  countryCode: "CO",
  municipalityCode: "05001",
};

const JURIDICA: FiscalCustomer = {
  identificationDocumentCode: "31",
  identification: "900123456",
  verificationDigit: "7",
  legalOrganizationCode: "1",
  company: "Comercializadora del Valle S.A.S.",
  names: null,
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: "facturacion@example.co",
  phone: "6041234567",
  address: "Carrera 4 # 5-6",
  countryCode: "CO",
  municipalityCode: "05001",
};

const directories: string[] = [];
const databases: LocalDatabase[] = [];

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

function auth(permissions: string[] = ALL_PERMISSIONS): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
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
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-customer-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const store = new SqliteCustomerStore(database, sync, () => NOW);
  return {
    database,
    store,
    register: new RegisterCustomerUseCase(store),
    get: new GetCustomerUseCase(store),
  };
}

let keySeed = 0;
function key(): string {
  keySeed += 1;
  return `idem-customer-${String(keySeed)}`;
}

describe("MIGRATION_012 — la tabla existe con sus restricciones", () => {
  it("la base migra a la versión 12", async () => {
    const { database } = await buildEnv();
    const row = database.native
      .prepare("SELECT max(version) AS version FROM local_schema_migrations")
      .get() as { version: number };
    expect(row.version).toBe(12);
  });

  /**
   * La documentación de emisión es taxativa: la identificación viaja **sin
   * DV**. Que lo imponga el validador no basta —el validador informa a un
   * operador—; esta restricción impide que la fila exista venga de donde venga.
   */
  it("rechaza una identificación con dígito de verificación pegado", async () => {
    const { database } = await buildEnv();
    expect(() => insertRaw(database, { identification: "900123456-7" })).toThrow();
  });

  it("rechaza un DV que no es un solo dígito", async () => {
    const { database } = await buildEnv();
    expect(() => insertRaw(database, { verification_digit: "77" })).toThrow();
  });

  it("rechaza una persona jurídica sin razón social", async () => {
    const { database } = await buildEnv();
    expect(() => insertRaw(database, { legal_organization_code: "1", company: null })).toThrow();
  });

  it("rechaza una persona natural sin nombres", async () => {
    const { database } = await buildEnv();
    expect(() =>
      insertRaw(database, { legal_organization_code: "2", names: null, company: "X" }),
    ).toThrow();
  });

  /**
   * SQLite no tiene tipo array. Guardar una cadena suelta que después se lea
   * como lista es el fallo silencioso que `json_type(...) = 'array'` evita.
   */
  it("rechaza responsabilidades fiscales que no sean un array JSON", async () => {
    const { database } = await buildEnv();
    expect(() => insertRaw(database, { fiscal_responsibility_codes: "R-99-PN" })).toThrow();
  });
});

/** Inserta saltándose el caso de uso, para probar la restricción de disco. */
function insertRaw(database: LocalDatabase, overrides: Record<string, unknown>): void {
  const base: Record<string, unknown> = {
    id: "018f0000-0000-7000-8000-0000000000c1",
    tenant_id: TENANT,
    company_id: COMPANY,
    identification_document_code: "31",
    identification: "900123456",
    verification_digit: "7",
    legal_organization_code: "1",
    company: "Comercializadora S.A.S.",
    names: null,
    tribute_code: "ZZ",
    fiscal_responsibility_codes: '["R-99-PN"]',
    email: null,
    phone: null,
    address: null,
    country_code: null,
    municipality_code: null,
    origin_device_id: DEVICE,
    installation_id: INSTALL,
    registered_by_actor_type: "USER",
    registered_by_actor_id: USER,
    idempotency_key: "raw-1",
    request_checksum: "a".repeat(64),
    correlation_id: CORRELATION,
    causation_id: null,
    version: 1,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
  const columns = Object.keys(base);
  database.native
    .prepare(
      `INSERT INTO customers_customers(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    )
    .run(...columns.map((column) => base[column]));
}

describe("registrar un adquiriente", () => {
  it("registra y devuelve versión 1", async () => {
    const { register } = await buildEnv();
    const result = register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("esperaba REGISTERED");
    expect(result.version).toBe(1);
  });

  /**
   * Las reglas fiscales se comprueban **antes** de tocar la base. Descubrir un
   * código no verificado al emitir sería tarde: la venta ya está cobrada.
   */
  it("un adquiriente inválido no llega a la base, y devuelve los hallazgos", async () => {
    const { register, database } = await buildEnv();
    const result = register.execute(SCOPE, SESSION, auth(), {
      customer: { ...JURIDICA, company: null, tributeCode: "99" },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    expect(result.kind).toBe("INVALID");
    if (result.kind !== "INVALID") throw new Error("esperaba INVALID");
    expect(result.findings.map((f) => f.code).sort()).toEqual([
      "COMPANY_REQUIRED_FOR_LEGAL_ENTITY",
      "TRIBUTE_CODE_NOT_VERIFIED",
    ]);

    const count = database.native
      .prepare("SELECT count(*) AS n FROM customers_customers")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("sin permiso no registra nada", async () => {
    const { register, database } = await buildEnv();
    const result = register.execute(SCOPE, SESSION, auth([]), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    expect(result.kind).toBe("UNAUTHORIZED");
    expect((database.native.prepare("SELECT count(*) AS n FROM customers_customers")
      .get() as { n: number }).n).toBe(0);
  });

  it("repetir la misma clave con el mismo contenido devuelve el mismo adquiriente", async () => {
    const { register, database } = await buildEnv();
    const idempotencyKey = key();
    const first = register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey, correlationId: CORRELATION, causationId: null,
    }, NOW);
    const second = register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey, correlationId: CORRELATION, causationId: null,
    }, NOW);

    expect(first.kind).toBe("REGISTERED");
    expect(second.kind).toBe("IDEMPOTENT");
    if (first.kind !== "REGISTERED" || second.kind !== "IDEMPOTENT") throw new Error("estados");
    expect(second.customerId).toBe(first.customerId);
    expect((database.native.prepare("SELECT count(*) AS n FROM customers_customers")
      .get() as { n: number }).n).toBe(1);
  });

  it("la misma clave con otra identidad fiscal es conflicto, no un segundo registro", async () => {
    const { register, database } = await buildEnv();
    const idempotencyKey = key();
    register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey, correlationId: CORRELATION, causationId: null,
    }, NOW);
    const second = register.execute(SCOPE, SESSION, auth(), {
      customer: NATURAL, idempotencyKey, correlationId: CORRELATION, causationId: null,
    }, NOW);

    expect(second.kind).toBe("IDEMPOTENCY_CONFLICT");
    expect((database.native.prepare("SELECT count(*) AS n FROM customers_customers")
      .get() as { n: number }).n).toBe(1);
  });

  /**
   * La misma cédula dos veces con dos `id` distintos permitiría emitir contra
   * la copia desactualizada. Se rechaza devolviendo **cuál** es el registro que
   * ya existe: quien captura necesita poder ir a él.
   */
  it("la misma identidad con otra clave devuelve el adquiriente que ya existe", async () => {
    const { register } = await buildEnv();
    const first = register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    const second = register.execute(SCOPE, SESSION, auth(), {
      customer: { ...JURIDICA, phone: "6049999999" },
      idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    expect(second.kind).toBe("IDENTITY_ALREADY_REGISTERED");
    if (first.kind !== "REGISTERED" || second.kind !== "IDENTITY_ALREADY_REGISTERED") {
      throw new Error("estados");
    }
    expect(second.customerId).toBe(first.customerId);
  });
});

describe("consultar un adquiriente", () => {
  it("se recupera por identificador y vuelve exactamente la forma canónica", async () => {
    const { register, get } = await buildEnv();
    const registered = register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    if (registered.kind !== "REGISTERED") throw new Error("esperaba REGISTERED");

    const found = get.execute(SCOPE, auth(), { by: "ID", customerId: registered.customerId }, NOW);
    expect(found.kind).toBe("FOUND");
    if (found.kind !== "FOUND") throw new Error("esperaba FOUND");
    expect(found.customer).toEqual(JURIDICA);
  });

  it("se recupera por identidad fiscal, que es como lo busca una caja", async () => {
    const { register, get } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), {
      customer: NATURAL, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    const found = get.execute(SCOPE, auth(), {
      by: "IDENTITY", identificationDocumentCode: "13", identification: "1020304050",
    }, NOW);
    expect(found.kind).toBe("FOUND");
    if (found.kind !== "FOUND") throw new Error("esperaba FOUND");
    expect(found.customer.names).toBe("Ana Restrepo");
  });

  /**
   * El aislamiento por compañía tiene **dos guardianes**, y conviene ver los
   * dos por separado: la autorización corta antes de llegar al almacén —el
   * snapshot no tiene asignación para esa compañía—, y el almacén filtra por
   * `company_id` por su cuenta. Probar sólo el primero dejaría el segundo sin
   * cobertura, y es el segundo el que protege si mañana entra otra vía.
   */
  it("otra compañía no pasa la autorización", async () => {
    const { register, get } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), {
      customer: NATURAL, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    const otherCompany: SyncScope = { ...SCOPE, companyId: "018f0000-0000-7000-8000-0000000000e2" };
    const found = get.execute(otherCompany, auth(), {
      by: "IDENTITY", identificationDocumentCode: "13", identification: "1020304050",
    }, NOW);
    expect(found.kind).toBe("UNAUTHORIZED");
  });

  it("y el almacén tampoco lo devuelve, aunque se le pregunte directamente", async () => {
    const { register, store } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), {
      customer: NATURAL, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    expect(store.findByIdentity(
      { tenantId: TENANT, companyId: "018f0000-0000-7000-8000-0000000000e2" },
      "13", "1020304050",
    )).toBeNull();
    expect(store.findByIdentity(
      { tenantId: TENANT, companyId: COMPANY }, "13", "1020304050",
    )).not.toBeNull();
  });

  it("sin permiso de lectura no devuelve nada", async () => {
    const { register, get } = await buildEnv();
    const registered = register.execute(SCOPE, SESSION, auth(), {
      customer: NATURAL, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);
    if (registered.kind !== "REGISTERED") throw new Error("esperaba REGISTERED");

    const found = get.execute(SCOPE, auth(["CUSTOMERS_CUSTOMER_REGISTER"]), {
      by: "ID", customerId: registered.customerId,
    }, NOW);
    expect(found.kind).toBe("UNAUTHORIZED");
  });
});

describe("rastro y sincronización", () => {
  /**
   * La auditoría registra **qué se hizo, no con qué datos**. La identificación,
   * el correo, el teléfono y la dirección de un tercero no entran en el rastro:
   * es la misma regla que impide que un hallazgo lleve el valor del campo.
   */
  it("la auditoría no contiene datos personales del adquiriente", async () => {
    const { register, database } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    const audit = database.native
      .prepare("SELECT action_code, details_json FROM local_operation_audit WHERE action_code='CUSTOMER_REGISTER'")
      .all() as Array<{ action_code: string; details_json: string }>;

    expect(audit).toHaveLength(1);
    const serialized = JSON.stringify(audit);
    for (const value of [
      JURIDICA.identification,
      JURIDICA.company,
      JURIDICA.email,
      JURIDICA.phone,
      JURIDICA.address,
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  /**
   * El outbox sí lleva la identidad completa, y es deliberado: el central
   * necesita el tercero para poder emitir. Auditoría y outbox son dos destinos
   * con dos necesidades distintas, y por eso no comparten contenido.
   */
  it("el outbox lleva la identidad fiscal completa", async () => {
    const { register, database } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    const row = database.native
      .prepare("SELECT operation_type, operation_json FROM local_sync_outbox")
      .get() as { operation_type: string; operation_json: string };

    expect(row.operation_type).toBe("CUSTOMER_REGISTER");
    const operation = JSON.parse(row.operation_json) as {
      aggregate_type: string;
      payload: Record<string, unknown>;
    };
    expect(operation.aggregate_type).toBe("CUSTOMER");
    expect(operation.payload["identification"]).toBe(JURIDICA.identification);
    expect(operation.payload["verification_digit"]).toBe(JURIDICA.verificationDigit);
    expect(operation.payload["fiscal_responsibility_codes"]).toEqual(["R-99-PN"]);
  });

  it("un registro rechazado por permiso no deja rastro ni encola nada", async () => {
    const { register, database } = await buildEnv();
    register.execute(SCOPE, SESSION, auth([]), {
      customer: JURIDICA, idempotencyKey: key(), correlationId: CORRELATION, causationId: null,
    }, NOW);

    expect((database.native.prepare("SELECT count(*) AS n FROM local_sync_outbox")
      .get() as { n: number }).n).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM runtime_operations")
      .get() as { n: number }).n).toBe(0);
  });
});
