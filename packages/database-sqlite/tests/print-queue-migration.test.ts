import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_LOCAL_SCHEMA_VERSION, LocalDatabase } from "../src/local-database.js";

/**
 * `MIGRATION_032` — cola de impresión (`DEC-010` §Impresión, `D-46`).
 *
 * Se prueban los rechazos, no la existencia de las tablas: cada invariante que
 * el comentario de la migración atribuye al esquema tiene aquí su caso
 * negativo contra la base real.
 */

const directories: string[] = [];
async function open(): Promise<LocalDatabase> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "pos-print-"));
  directories.push(dataDirectory);
  return LocalDatabase.open({ dataDirectory });
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALLATION = "018f0000-0000-7000-8000-000000000005";
const OPERATOR = "018f0000-0000-7000-8000-000000000006";
const NOW = "2026-09-26T12:00:00.000Z";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

let saleNumber = 0;
function seedSale(database: LocalDatabase): string {
  const saleId = randomUUID();
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
      'USER',?,'POS','COMPLETED','2026-09-26','America/Bogota',-300,
      'POS1',?,'COP','1000.000000','0.000000','0.000000',
      '1000.000000','0.000000','1000.000000','1.0.0',
      '1.0.0',NULL,'1.0.0','1.0.0',
      '{}','{}',?,?,?,?,
      ?,NULL,1,?,?,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH, DEVICE, INSTALLATION, OPERATOR, saleNumber,
    sha256(`calc:${saleId}`), operationId, `sale:${saleId}`, sha256(`req:${saleId}`), randomUUID(), NOW, NOW,
  );
  return saleId;
}

function insertJob(database: LocalDatabase, saleId: string, copyKind = "ORIGINAL", status = "PENDING"): string {
  const id = randomUUID();
  database.native.prepare(`
    INSERT INTO hardware_print_job(tenant_id,id,company_id,branch_id,sale_id,copy_kind,status,
      last_diagnostic_code,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
  ).run(TENANT, id, COMPANY, BRANCH, saleId, copyKind, status, OPERATOR, NOW, NOW);
  return id;
}

function insertAttempt(database: LocalDatabase, jobId: string, key: string = randomUUID()): string {
  const id = randomUUID();
  database.native.prepare(`
    INSERT INTO hardware_print_attempt(tenant_id,id,print_job_id,idempotency_key,requested_by_user_id,
      requested_at,outcome,retryable,diagnostic_code,finished_at)
    VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL)`,
  ).run(TENANT, id, jobId, key, OPERATOR, NOW);
  return id;
}

describe("MIGRATION_032 — cola de impresión", () => {
  it("es la última versión del libro", async () => {
    const database = await open();
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBe(32);
    expect((database.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get() as { v: number }).v).toBe(32);
    database.close();
  });

  it("un trabajo exige una venta que exista", async () => {
    const database = await open();
    expect(() => insertJob(database, randomUUID())).toThrow(/FOREIGN KEY/);
    database.close();
  });

  it("un solo ORIGINAL por venta; las copias no tienen tope", async () => {
    const database = await open();
    const sale = seedSale(database);
    insertJob(database, sale, "ORIGINAL", "PRINTED");
    expect(() => insertJob(database, sale, "ORIGINAL")).toThrow(/UNIQUE/);
    insertJob(database, sale, "REPRINT");
    insertJob(database, sale, "REPRINT");
    database.close();
  });

  it("un trabajo terminado no cambia de desenlace", async () => {
    const database = await open();
    const job = insertJob(database, seedSale(database), "ORIGINAL", "PRINTED");
    expect(() => database.native.prepare("UPDATE hardware_print_job SET status='PENDING' WHERE id=?").run(job))
      .toThrow("print job outcome is final");
    database.close();
  });

  it("la identidad del trabajo no cambia, ni siquiera mientras está pendiente", async () => {
    const database = await open();
    const job = insertJob(database, seedSale(database));
    expect(() => database.native.prepare("UPDATE hardware_print_job SET copy_kind='REPRINT' WHERE id=?").run(job))
      .toThrow("print job identity is immutable");
    database.native.prepare("UPDATE hardware_print_job SET status='PRINTED', updated_at=? WHERE id=?").run(NOW, job);
    database.close();
  });

  it("la misma clave de idempotencia no abre un segundo intento", async () => {
    const database = await open();
    const job = insertJob(database, seedSale(database));
    const attempt = insertAttempt(database, job, "print-key-1");
    database.native.prepare("UPDATE hardware_print_attempt SET outcome='FAILED', retryable=1, finished_at=? WHERE id=?").run(NOW, attempt);
    expect(() => insertAttempt(database, job, "print-key-1")).toThrow(/UNIQUE/);
    database.close();
  });

  it("un solo intento abierto por trabajo", async () => {
    const database = await open();
    const job = insertJob(database, seedSale(database));
    insertAttempt(database, job);
    expect(() => insertAttempt(database, job)).toThrow(/UNIQUE/);
    database.close();
  });

  it("un intento cerrado no se reabre ni se reescribe", async () => {
    const database = await open();
    const attempt = insertAttempt(database, insertJob(database, seedSale(database)));
    database.native.prepare("UPDATE hardware_print_attempt SET outcome='UNKNOWN', retryable=0, finished_at=? WHERE id=?").run(NOW, attempt);
    expect(() => database.native.prepare("UPDATE hardware_print_attempt SET outcome='SUCCEEDED' WHERE id=?").run(attempt))
      .toThrow("print attempt outcome is final");
    database.close();
  });

  it("desenlace, reintentabilidad y cierre van juntos o no van", async () => {
    const database = await open();
    const attempt = insertAttempt(database, insertJob(database, seedSale(database)));
    expect(() => database.native.prepare("UPDATE hardware_print_attempt SET outcome='FAILED' WHERE id=?").run(attempt))
      .toThrow(/CHECK/);
    database.close();
  });

  it("nada se borra: es el rastro de quién pidió cada papel", async () => {
    const database = await open();
    const job = insertJob(database, seedSale(database));
    insertAttempt(database, job);
    expect(() => database.native.prepare("DELETE FROM hardware_print_attempt").run()).toThrow("append-only");
    expect(() => database.native.prepare("DELETE FROM hardware_print_job").run()).toThrow("append-only");
    database.close();
  });
});
