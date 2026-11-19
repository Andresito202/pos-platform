import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { FindCatalogItemUseCase } from "../src/catalog/find-catalog-item-use-case.js";
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
const NOW = new Date("2026-09-07T10:00:00.000Z");
const ALL = ["CATALOG_PRODUCT_REGISTER", "CATALOG_PRODUCT_READ"];

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = ALL): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-07T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
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
  const dir = await mkdtemp(join(tmpdir(), "pos-catalog-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const store = new SqliteCatalogStore(database, new DurableSyncStore(database), () => NOW);
  return {
    database, store,
    register: new RegisterProductUseCase(store),
    find: new FindCatalogItemUseCase(store),
  };
}

let seed = 0;
const key = (): string => { seed += 1; return `idem-catalog-${String(seed)}`; };

const producto = (overrides: Record<string, unknown> = {}) => ({
  code: "CAFE-001",
  name: "Café Americano 500 g",
  stockControlled: true,
  presentationName: "Bolsa 500 g",
  unitCode: "UND",
  unitPrecision: 0,
  barcode: "7701234567890",
  priceAmount: "18000.000000",
  currencyCode: "COP",
  idempotencyKey: key(),
  correlationId: CORRELATION,
  causationId: null,
  ...overrides,
});

describe("registrar un producto vendible", () => {
  it("crea producto, presentación y precio en una sola operación", async () => {
    const { register, database } = await buildEnv();
    const result = register.execute(SCOPE, SESSION, auth(), producto(), NOW);

    expect(result.kind).toBe("REGISTERED");
    const cuenta = (tabla: string): number =>
      (database.native.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n;
    expect(cuenta("catalog_product")).toBe(1);
    expect(cuenta("catalog_presentation")).toBe(1);
    expect(cuenta("catalog_price")).toBe(1);
  });

  it("sin permiso no crea nada", async () => {
    const { register, database } = await buildEnv();
    const result = register.execute(SCOPE, SESSION, auth([]), producto(), NOW);
    expect(result.kind).toBe("UNAUTHORIZED");
    expect((database.native.prepare("SELECT count(*) AS n FROM catalog_product")
      .get() as { n: number }).n).toBe(0);
  });

  it("repetir la misma clave con el mismo contenido no duplica", async () => {
    const { register, database } = await buildEnv();
    const p = producto();
    const first = register.execute(SCOPE, SESSION, auth(), p, NOW);
    const second = register.execute(SCOPE, SESSION, auth(), p, NOW);

    expect(first.kind).toBe("REGISTERED");
    expect(second.kind).toBe("IDEMPOTENT");
    expect((database.native.prepare("SELECT count(*) AS n FROM catalog_product")
      .get() as { n: number }).n).toBe(1);
  });

  it("la misma clave con otro precio es conflicto: cambia lo que se cobra", async () => {
    const { register } = await buildEnv();
    const idempotencyKey = key();
    register.execute(SCOPE, SESSION, auth(), producto({ idempotencyKey }), NOW);
    const second = register.execute(
      SCOPE, SESSION, auth(),
      producto({ idempotencyKey, priceAmount: "25000.000000" }), NOW,
    );
    expect(second.kind).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("una referencia repetida devuelve cuál es el producto que ya existe", async () => {
    const { register } = await buildEnv();
    const first = register.execute(SCOPE, SESSION, auth(), producto(), NOW);
    const second = register.execute(
      SCOPE, SESSION, auth(),
      producto({ barcode: "7709999999999", name: "Otro" }), NOW,
    );
    expect(second.kind).toBe("CODE_ALREADY_REGISTERED");
    if (first.kind !== "REGISTERED" || second.kind !== "CODE_ALREADY_REGISTERED") {
      throw new Error("estados");
    }
    expect(second.productId).toBe(first.productId);
  });

  /**
   * La restricción más importante del catálogo: si dos productos comparten
   * código de barras, **el lector no puede decidir cuál cobrar** y el cajero no
   * tiene forma de saber que eligió mal.
   */
  it("un código de barras repetido se rechaza y dice cuál lo tiene", async () => {
    const { register } = await buildEnv();
    const first = register.execute(SCOPE, SESSION, auth(), producto(), NOW);
    const second = register.execute(
      SCOPE, SESSION, auth(),
      producto({ code: "CAFE-002", name: "Otro café" }), NOW,
    );
    expect(second.kind).toBe("BARCODE_ALREADY_REGISTERED");
    if (first.kind !== "REGISTERED" || second.kind !== "BARCODE_ALREADY_REGISTERED") {
      throw new Error("estados");
    }
    expect(second.presentationId).toBe(first.presentationId);
  });

  it("dos productos sin código de barras conviven: NULL no colisiona con NULL", async () => {
    const { register } = await buildEnv();
    const a = register.execute(SCOPE, SESSION, auth(), producto({ barcode: null }), NOW);
    const b = register.execute(
      SCOPE, SESSION, auth(),
      producto({ barcode: null, code: "CAFE-002" }), NOW,
    );
    expect(a.kind).toBe("REGISTERED");
    expect(b.kind).toBe("REGISTERED");
  });
});

describe("buscar en el catálogo", () => {
  it("el lector de código de barras devuelve el artículo completo", async () => {
    const { register, find } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), producto(), NOW);

    const result = find.execute(SCOPE, auth(), { by: "BARCODE", barcode: "7701234567890" }, NOW);
    expect(result.kind).toBe("FOUND");
    if (result.kind !== "FOUND") throw new Error("esperaba FOUND");
    expect(result.item.product.code).toBe("CAFE-001");
    expect(result.item.presentation.unitPrecision).toBe(0);
    expect(result.item.price?.amount).toBe("18000.000000");
  });

  it("un código de barras desconocido no encuentra nada", async () => {
    const { find } = await buildEnv();
    expect(find.execute(SCOPE, auth(), { by: "BARCODE", barcode: "0000000000000" }, NOW).kind)
      .toBe("NOT_FOUND");
  });

  it("sin permiso de lectura no devuelve nada", async () => {
    const { register, find } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), producto(), NOW);
    expect(find.execute(
      SCOPE, auth(["CATALOG_PRODUCT_REGISTER"]),
      { by: "BARCODE", barcode: "7701234567890" }, NOW,
    ).kind).toBe("UNAUTHORIZED");
  });

  /**
   * Una presentación de un producto retirado no es vendible aunque su fila siga
   * ahí: el artículo se ensambla sobre el producto activo, no sobre la fila.
   */
  it("si el producto se desactiva, su presentación deja de encontrarse", async () => {
    const { register, find, database } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), producto(), NOW);
    database.native.prepare("UPDATE catalog_product SET status='INACTIVE'").run();

    expect(find.execute(SCOPE, auth(), { by: "BARCODE", barcode: "7701234567890" }, NOW).kind)
      .toBe("NOT_FOUND");
  });

  it("el catálogo de otra compañía no se ve", async () => {
    const { register, store } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), producto(), NOW);

    expect(store.findByBarcode(
      { tenantId: TENANT, companyId: "018f0000-0000-7000-8000-0000000000e2" }, "7701234567890",
    )).toBeNull();
    expect(store.findByBarcode({ tenantId: TENANT, companyId: COMPANY }, "7701234567890"))
      .not.toBeNull();
  });
});

describe("rastro y sincronización del catálogo", () => {
  /** El importe es el dato que un rastro no necesita y cuya filtración sí duele. */
  it("la auditoría registra la referencia y la unidad, no el precio", async () => {
    const { register, database } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), producto(), NOW);

    const rows = database.native
      .prepare("SELECT details_json FROM local_operation_audit WHERE action_code='CATALOG_PRODUCT_REGISTER'")
      .all() as Array<{ details_json: string }>;
    expect(rows).toHaveLength(1);
    const serializado = JSON.stringify(rows);
    expect(serializado).toContain("CAFE-001");
    expect(serializado).not.toContain("18000.000000");
  });

  it("el outbox lleva el artículo completo, porque el central lo necesita", async () => {
    const { register, database } = await buildEnv();
    register.execute(SCOPE, SESSION, auth(), producto(), NOW);

    const row = database.native
      .prepare("SELECT operation_type, operation_json FROM local_sync_outbox")
      .get() as { operation_type: string; operation_json: string };
    expect(row.operation_type).toBe("CATALOG_PRODUCT_REGISTER");
    const operation = JSON.parse(row.operation_json) as { payload: Record<string, unknown> };
    expect(operation.payload["code"]).toBe("CAFE-001");
    expect(operation.payload["barcode"]).toBe("7701234567890");
    expect(operation.payload["price_amount"]).toBe("18000.000000");
  });
});

describe("MIGRATION_014 — restricciones en disco", () => {
  const insertPresentation = (database: LocalDatabase, precision: number, barcode: string | null): void => {
    const at = NOW.toISOString();
    database.native.prepare(
      `INSERT INTO catalog_product(
        id, tenant_id, company_id, code, name, status, stock_controlled,
        registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
      ) VALUES ('018f0000-0000-7000-8000-0000000000a1',?,?,'X','X','ACTIVE',0,?,'raw',?,1,?,?)`,
    ).run(TENANT, COMPANY, USER, CORRELATION, at, at);
    database.native.prepare(
      `INSERT INTO catalog_presentation(
        id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
        status, created_at, updated_at
      ) VALUES ('018f0000-0000-7000-8000-0000000000b1',?,'018f0000-0000-7000-8000-0000000000a1','X','UND',?,?,'ACTIVE',?,?)`,
    ).run(TENANT, precision, barcode, at, at);
  };

  it("acepta una precisión de 0 a 6", async () => {
    const { database } = await buildEnv();
    expect(() => { insertPresentation(database, 3, null); }).not.toThrow();
  });

  /** 6 es el máximo de la escala del dinero; por encima no hay representación. */
  it("rechaza una precisión mayor que 6", async () => {
    const { database } = await buildEnv();
    expect(() => { insertPresentation(database, 7, null); }).toThrow();
  });

  it("rechaza un código de barras con caracteres que un lector no produce", async () => {
    const { database } = await buildEnv();
    expect(() => { insertPresentation(database, 0, "770 123/456"); }).toThrow();
  });
});
