import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_LOCAL_SCHEMA_VERSION, LocalDatabase } from "../src/local-database.js";

/**
 * `MIGRATION_016` — `DEC-021` F1.
 *
 * Lo que se prueba aquí no es que las tablas existan: es que **la base rechaza
 * los estados que producirían una factura duplicada ante la DIAN**. Cada
 * invariante de `outcome.ts` que aquí se repite como `CHECK` tiene su prueba
 * negativa; escribir el `CHECK` sin ejecutarlo no acredita nada.
 */

const directories: string[] = [];
const openDatabases: LocalDatabase[] = [];
async function open(): Promise<LocalDatabase> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "pos-fiscal-"));
  directories.push(dataDirectory);
  const database = LocalDatabase.open({ dataDirectory });
  openDatabases.push(database);
  return database;
}
afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    if (database.native.open) database.close();
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALLATION = "018f0000-0000-7000-8000-000000000005";
const OPERATOR = "018f0000-0000-7000-8000-000000000006";
const RANGE_ID = "FACTUS-RANGE-1";
const NOW = "2026-09-14T12:00:00.000Z";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Rango sincronizado del proveedor. Sin él no se puede insertar un documento. */
function seedRange(database: LocalDatabase, overrides: Record<string, unknown> = {}): void {
  const row = {
    tenant_id: TENANT,
    company_id: COMPANY,
    provider: "FACTUS",
    environment: "SANDBOX",
    range_id: RANGE_ID,
    document_type: "SALES_INVOICE",
    prefix: "SETP",
    authority: "PROVIDER",
    resolution_number: "18760000001",
    range_from: 1,
    range_to: 5000,
    current_number: 12,
    valid_from: "2026-01-01",
    valid_until: "2027-01-01",
    provider_active: 1,
    provider_expired: 0,
    provider_document_code: "01",
    synchronized_at: NOW,
    ...overrides,
  };
  database.native.prepare(`
    INSERT INTO fiscal_numbering_range(
      tenant_id,company_id,provider,environment,range_id,document_type,prefix,authority,
      resolution_number,range_from,range_to,current_number,valid_from,valid_until,
      provider_active,provider_expired,provider_document_code,synchronized_at
    ) VALUES (
      @tenant_id,@company_id,@provider,@environment,@range_id,@document_type,@prefix,@authority,
      @resolution_number,@range_from,@range_to,@current_number,@valid_from,@valid_until,
      @provider_active,@provider_expired,@provider_document_code,@synchronized_at
    )`).run(row);
}

/**
 * Venta cobrada mínima, con su operación de runtime, para satisfacer la FK.
 *
 * El consecutivo comercial avanza en cada llamada porque `sales_sales` es único
 * por `(tenant, sucursal, serie, número)`: dos ventas de prueba con el mismo
 * número no son dos ventas.
 */
let saleNumber = 0;
function seedSale(database: LocalDatabase, saleId: string): string {
  const operationId = randomUUID();
  saleNumber += 1;
  database.native.prepare(`
    INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
    VALUES (?,?,?,'SUCCEEDED','COMMITTED',?,?)`,
  ).run(operationId, `sale:${saleId}`, sha256(saleId), NOW, NOW);

  database.native.prepare(`
    INSERT INTO sales_sales(
      id,tenant_id,company_id,branch_id,cash_register_id,cash_shift_id,origin_device_id,installation_id,
      operator_actor_type,operator_actor_id,channel,status,business_date,timezone_id,utc_offset_minutes,
      document_series,sale_number,currency_code,subtotal_amount,discount_amount,tax_amount,
      fiscal_total_amount,commercial_rounding_adjustment,payable_amount,pricing_pipeline_version,
      pricing_policy_version,promotion_policy_version,tax_policy_version,rounding_policy_version,
      pricing_snapshot,tax_snapshot,calculation_checksum,operation_id,idempotency_key,request_checksum,
      correlation_id,causation_id,version,created_at,completed_at,cancelled_at,expired_at,server_recorded_at
    ) VALUES (
      ?,?,?,?,NULL,NULL,?,?,
      'USER',?,'POS','COMPLETED','2026-09-14','America/Bogota',-300,
      'POS1',?,'COP','42648.000000','0.000000','4742.000000',
      '47390.000000','10.000000','47400.000000','1.0.0',
      '1.0.0',NULL,'1.0.0','1.0.0',
      '{}','{}',?,?,?,?,
      ?,NULL,1,?,?,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH, DEVICE, INSTALLATION, OPERATOR, saleNumber,
    sha256(`calc:${saleId}`), operationId, `sale:${saleId}`, sha256(`req:${saleId}`),
    randomUUID(), NOW, NOW,
  );
  return saleId;
}

interface DocumentOverrides { readonly [key: string]: unknown }

function insertDocument(database: LocalDatabase, saleId: string, overrides: DocumentOverrides = {}): string {
  const id = randomUUID();
  const payload = JSON.stringify({ sale_id: saleId });
  const row = {
    id,
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    sale_id: saleId,
    provider: "FACTUS",
    environment: "SANDBOX",
    document_type: "SALES_INVOICE",
    numbering_range_id: RANGE_ID,
    idempotency_key: `doc:${id}`,
    payload_json: payload,
    payload_checksum: sha256(payload),
    transport_status: "CREATED",
    normalized_result: null,
    attempt_count: 0,
    provider_operation_id: null,
    provider_document_id: null,
    issued_prefix: null,
    issued_number: null,
    cufe: null,
    provider_status_code: null,
    provider_status: null,
    provider_http_status: null,
    last_diagnostic_code: null,
    last_diagnostic_reference: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    first_submitted_at: null,
    resolved_at: null,
    ...overrides,
  };
  database.native.prepare(`
    INSERT INTO fiscal_electronic_document(
      id,tenant_id,company_id,branch_id,sale_id,provider,environment,document_type,numbering_range_id,
      idempotency_key,payload_json,payload_checksum,transport_status,normalized_result,attempt_count,
      provider_operation_id,provider_document_id,issued_prefix,issued_number,cufe,
      provider_status_code,provider_status,provider_http_status,last_diagnostic_code,last_diagnostic_reference,
      version,created_at,updated_at,first_submitted_at,resolved_at
    ) VALUES (
      @id,@tenant_id,@company_id,@branch_id,@sale_id,@provider,@environment,@document_type,@numbering_range_id,
      @idempotency_key,@payload_json,@payload_checksum,@transport_status,@normalized_result,@attempt_count,
      @provider_operation_id,@provider_document_id,@issued_prefix,@issued_number,@cufe,
      @provider_status_code,@provider_status,@provider_http_status,@last_diagnostic_code,@last_diagnostic_reference,
      @version,@created_at,@updated_at,@first_submitted_at,@resolved_at
    )`).run(row);
  return id;
}

/** Documento evidenciado y aceptado, con toda la identidad que el proveedor asigna. */
const ACCEPTED = {
  transport_status: "COMPLETED",
  normalized_result: "ACCEPTED",
  attempt_count: 1,
  first_submitted_at: NOW,
  resolved_at: NOW,
  provider_operation_id: "op-1",
  provider_document_id: "doc-1",
  issued_prefix: "SETP",
  issued_number: "990000001",
  cufe: "a".repeat(96),
} as const;

describe("MIGRATION_016 — esquema", () => {
  it("llega a la última versión y crea las dos tablas de DEC-021 F1", async () => {
    const database = await open();
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
    expect((database.native
      .prepare("SELECT max(version) AS version FROM local_schema_migrations")
      .get() as { version: number }).version).toBe(LATEST_LOCAL_SCHEMA_VERSION);
    expect((database.native
      .prepare("SELECT COUNT(*) AS count FROM local_schema_migrations WHERE version = 16")
      .get() as { count: number }).count).toBe(1);

    const tables = (database.native
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fiscal_%' ORDER BY name")
      .all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(["fiscal_electronic_document", "fiscal_numbering_range"]);
    database.close();
  });

  it("sobrevive al cierre y reapertura sin volver a aplicarse", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "pos-fiscal-"));
    directories.push(dataDirectory);
    const first = LocalDatabase.open({ dataDirectory });
    seedRange(first);
    const saleId = seedSale(first, randomUUID());
    const documentId = insertDocument(first, saleId);
    first.close();

    const second = LocalDatabase.open({ dataDirectory });
    expect((second.native.prepare("SELECT count(*) AS count FROM local_schema_migrations WHERE version=16").get()))
      .toEqual({ count: 1 });
    expect(second.native.prepare("SELECT id FROM fiscal_electronic_document WHERE id=?").get(documentId))
      .toEqual({ id: documentId });
    second.close();
  });
});

describe("MIGRATION_016 — el desenlace incierto no puede afirmar un resultado fiscal", () => {
  it("rechaza un resultado normalizado sin transporte COMPLETED", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());

    // Ésta es la fila que produce la factura duplicada: un envío cuya respuesta
    // se perdió, guardado como si se conociera el desenlace.
    expect(() => insertDocument(database, saleId, {
      transport_status: "UNKNOWN_OUTCOME",
      normalized_result: "ACCEPTED",
      attempt_count: 1,
      first_submitted_at: NOW,
    })).toThrow(/CHECK constraint failed/);
    database.close();
  });

  it("rechaza un transporte COMPLETED sin resultado normalizado", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    expect(() => insertDocument(database, saleId, {
      transport_status: "COMPLETED",
      normalized_result: null,
      attempt_count: 1,
      first_submitted_at: NOW,
      resolved_at: NOW,
    })).toThrow(/CHECK constraint failed/);
    database.close();
  });

  it("admite UNKNOWN_OUTCOME sin resultado: es el estado que obliga a conciliar", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    const id = insertDocument(database, saleId, {
      transport_status: "UNKNOWN_OUTCOME",
      attempt_count: 1,
      first_submitted_at: NOW,
      last_diagnostic_code: "READ_TIMEOUT",
      last_diagnostic_reference: "diag-1",
    });
    expect(database.native.prepare("SELECT transport_status,normalized_result,resolved_at FROM fiscal_electronic_document WHERE id=?").get(id))
      .toEqual({ transport_status: "UNKNOWN_OUTCOME", normalized_result: null, resolved_at: null });
    database.close();
  });
});

describe("MIGRATION_016 — identidad del proveedor sólo con evidencia", () => {
  it("rechaza un CUFE sin aceptación", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    expect(() => insertDocument(database, saleId, {
      ...ACCEPTED,
      normalized_result: "REJECTED",
      cufe: "a".repeat(96),
      issued_number: null,
      issued_prefix: null,
    })).toThrow(/CHECK constraint failed/);
    database.close();
  });

  it("rechaza un consecutivo emitido sin aceptación", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    expect(() => insertDocument(database, saleId, {
      transport_status: "FAILED",
      attempt_count: 1,
      first_submitted_at: NOW,
      issued_number: "990000001",
    })).toThrow(/CHECK constraint failed/);
    database.close();
  });

  it("acepta la identidad completa cuando el desenlace está evidenciado", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    const id = insertDocument(database, saleId, ACCEPTED);
    expect(database.native.prepare("SELECT cufe,issued_number,normalized_result FROM fiscal_electronic_document WHERE id=?").get(id))
      .toEqual({ cufe: "a".repeat(96), issued_number: "990000001", normalized_result: "ACCEPTED" });
    database.close();
  });
});

describe("MIGRATION_016 — intentos y resolución", () => {
  it("liga CREATED a cero intentos y a no haber salido nunca", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());

    expect(() => insertDocument(database, saleId, { transport_status: "CREATED", attempt_count: 1 }))
      .toThrow(/CHECK constraint failed/);
    expect(() => insertDocument(database, saleId, {
      transport_status: "IN_PROGRESS", attempt_count: 0, first_submitted_at: null,
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertDocument(database, saleId, {
      transport_status: "CREATED", attempt_count: 0, first_submitted_at: NOW,
    })).toThrow(/CHECK constraint failed/);
    database.close();
  });

  it("exige resolved_at exactamente en los estados terminales", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());

    // FAILED no es terminal: se puede reintentar.
    expect(() => insertDocument(database, saleId, {
      transport_status: "FAILED", attempt_count: 1, first_submitted_at: NOW, resolved_at: NOW,
    })).toThrow(/CHECK constraint failed/);
    // CANCELLED sí lo es.
    expect(() => insertDocument(database, saleId, {
      transport_status: "CANCELLED", attempt_count: 1, first_submitted_at: NOW, resolved_at: null,
    })).toThrow(/CHECK constraint failed/);
    database.close();
  });

  it("no deja retroceder los intentos ni la versión", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    const id = insertDocument(database, saleId, {
      transport_status: "IN_PROGRESS", attempt_count: 2, first_submitted_at: NOW,
    });

    expect(() => database.native
      .prepare("UPDATE fiscal_electronic_document SET attempt_count=1,version=2 WHERE id=?").run(id))
      .toThrow(/only move forward/);
    expect(() => database.native
      .prepare("UPDATE fiscal_electronic_document SET attempt_count=3,version=1 WHERE id=?").run(id))
      .toThrow(/only move forward/);
    expect(database.native.prepare("UPDATE fiscal_electronic_document SET attempt_count=3,version=2 WHERE id=?").run(id).changes)
      .toBe(1);
    database.close();
  });

  it("un documento resuelto ya no cambia", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    const id = insertDocument(database, saleId, ACCEPTED);
    expect(() => database.native
      .prepare("UPDATE fiscal_electronic_document SET version=2,updated_at=? WHERE id=?").run(NOW, id))
      .toThrow(/resolved electronic document cannot change/);
    database.close();
  });
});

describe("MIGRATION_016 — el payload queda congelado", () => {
  it("rechaza cambiar payload, checksum, idempotencia, venta o rango", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    const id = insertDocument(database, saleId, {
      transport_status: "FAILED", attempt_count: 1, first_submitted_at: NOW,
    });

    for (const [column, value] of [
      ["payload_json", "{\"tampered\":true}"],
      ["payload_checksum", sha256("otro")],
      ["idempotency_key", "otra-clave"],
      ["document_type", "CREDIT_NOTE"],
      ["created_at", "2026-09-15T00:00:00.000Z"],
    ] as const) {
      expect(() => database.native
        .prepare(`UPDATE fiscal_electronic_document SET ${column}=?,version=version+1 WHERE id=?`)
        .run(value, id), column)
        .toThrow(/immutable/);
    }

    // El estado técnico sí avanza: lo congelado es la identidad, no el progreso.
    expect(database.native.prepare(
      "UPDATE fiscal_electronic_document SET transport_status='UNKNOWN_OUTCOME',attempt_count=2,version=2 WHERE id=?",
    ).run(id).changes).toBe(1);
    database.close();
  });
});

describe("MIGRATION_016 — una sola emisión viva por venta", () => {
  it("impide abrir un segundo documento mientras el primero no está resuelto", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    insertDocument(database, saleId, {
      transport_status: "UNKNOWN_OUTCOME", attempt_count: 1, first_submitted_at: NOW,
    });

    // Es la prueba que justifica toda la migración: el desenlace es incierto y
    // la base impide emitir otra vez «por si acaso».
    expect(() => insertDocument(database, saleId))
      .toThrow(/UNIQUE constraint failed/);
    database.close();
  });

  it("tampoco deja duplicar una venta ya facturada", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    insertDocument(database, saleId, ACCEPTED);
    expect(() => insertDocument(database, saleId)).toThrow(/UNIQUE constraint failed/);
    database.close();
  });

  it("un rechazo sí permite volver a emitir, y una cancelación también", async () => {
    const database = await open();
    seedRange(database);

    const rejectedSale = seedSale(database, randomUUID());
    insertDocument(database, rejectedSale, {
      ...ACCEPTED, normalized_result: "REJECTED", cufe: null, issued_number: null, issued_prefix: null,
    });
    expect(() => insertDocument(database, rejectedSale)).not.toThrow();

    const cancelledSale = seedSale(database, randomUUID());
    insertDocument(database, cancelledSale, {
      transport_status: "CANCELLED", attempt_count: 1, first_submitted_at: NOW, resolved_at: NOW,
    });
    expect(() => insertDocument(database, cancelledSale)).not.toThrow();
    database.close();
  });

  it("la clave de idempotencia es única por proveedor y ambiente", async () => {
    const database = await open();
    seedRange(database);
    const first = seedSale(database, randomUUID());
    const second = seedSale(database, randomUUID());
    insertDocument(database, first, { idempotency_key: "compartida" });
    expect(() => insertDocument(database, second, { idempotency_key: "compartida" }))
      .toThrow(/UNIQUE constraint failed/);
    database.close();
  });
});

describe("MIGRATION_016 — el rango debe existir antes que el documento", () => {
  it("rechaza un documento sin rango de numeración persistido", async () => {
    const database = await open();
    const saleId = seedSale(database, randomUUID());
    // `DEC-021` §2.2: el payload no se puede ensamblar sin el rango. Aquí no es
    // una convención: es una clave foránea.
    expect(() => insertDocument(database, saleId)).toThrow(/FOREIGN KEY constraint failed/);
    database.close();
  });

  it("no cruza ambientes: el rango de sandbox no sirve en producción", async () => {
    const database = await open();
    seedRange(database);
    const saleId = seedSale(database, randomUUID());
    expect(() => insertDocument(database, saleId, { environment: "PRODUCTION" }))
      .toThrow(/FOREIGN KEY constraint failed/);
    database.close();
  });

  it("el mismo identificador de rango convive en ambos ambientes sin mezclarse", async () => {
    const database = await open();
    seedRange(database);
    seedRange(database, { environment: "PRODUCTION", current_number: 0 });
    expect(database.native
      .prepare("SELECT environment,current_number FROM fiscal_numbering_range WHERE range_id=? ORDER BY environment")
      .all(RANGE_ID))
      .toEqual([
        { environment: "PRODUCTION", current_number: 0 },
        { environment: "SANDBOX", current_number: 12 },
      ]);
    database.close();
  });

  it("rechaza un rango invertido", async () => {
    const database = await open();
    expect(() => seedRange(database, { range_from: 100, range_to: 99 }))
      .toThrow(/CHECK constraint failed/);
    database.close();
  });
});


it("upgrades v19 sales without assigning or changing historical customer identities",async()=>{
  const database=await open();const saleId=randomUUID();seedSale(database,saleId);
  const dataDirectory=dirname(database.native.name);
  // Reconstruct the prior version in a disposable fixture, never an operational downgrade.
  database.native.exec(`DROP TRIGGER sales_customer_scope_insert;
    DROP TRIGGER sales_customer_identity_immutable;
    DROP TRIGGER customers_linked_sale_no_delete;
    DROP TRIGGER customers_linked_sale_no_rebind;
    DROP INDEX sales_sales_customer_idx;
    ALTER TABLE sales_sales DROP COLUMN customer_id;
    DROP TRIGGER local_schema_migrations_no_delete;
    DELETE FROM local_schema_migrations WHERE version=20;`);
  const before=database.native.prepare("SELECT * FROM sales_sales WHERE id=?").get(saleId) as Record<string,unknown>;
  database.close();
  const upgraded=LocalDatabase.open({dataDirectory});openDatabases.push(upgraded);
  expect(upgraded.native.prepare("SELECT * FROM sales_sales WHERE id=?").get(saleId)).toEqual({...before,customer_id:null});
  expect(upgraded.native.prepare("SELECT max(version) AS version FROM local_schema_migrations").get()).toEqual({version:LATEST_LOCAL_SCHEMA_VERSION});
  upgraded.assertIntegrity();
});
