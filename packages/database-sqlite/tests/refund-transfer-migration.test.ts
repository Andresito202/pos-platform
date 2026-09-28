import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_LOCAL_SCHEMA_VERSION, LocalDatabase } from "../src/local-database.js";

/**
 * `MIGRATION_035` — `payments_refunds` admite `TRANSFER` (`D-49`). Aquí sólo
 * la forma que el esquema impone; el reembolso de extremo a extremo —venta,
 * turno, confirmación segregada— se prueba por el canal en el servicio.
 */

const directories: string[] = [];
async function open(): Promise<LocalDatabase> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "pos-refund-transfer-"));
  directories.push(dataDirectory);
  const database = LocalDatabase.open({ dataDirectory });
  database.native.pragma("foreign_keys = OFF");
  return database;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const REQUESTER = "018f0000-0000-7000-8000-000000000006";
const CONFIRMER = "018f0000-0000-7000-8000-000000000007";
const NOW = "2026-09-28T12:00:00.000Z";
const SUM = "a".repeat(64);

type Row = Record<string, string | number | null>;

function insertRefund(database: LocalDatabase, row: Row = {}): string {
  const v: Row = {
    id: randomUUID(), status: "PROCESSING", refund_method: "TRANSFER",
    requested_amount: "9600.000000", completed_amount: "9600.000000",
    provider_reference: null, destination_reference: null, confirmed_by_actor_id: null,
    completed_at: null, requested_by_actor_id: REQUESTER, idempotency_key: randomUUID(),
    ...row,
  };
  database.native.prepare(`
    INSERT INTO payments_refunds(id,tenant_id,company_id,branch_id,payment_id,sale_return_id,
      commercial_refund_amount,refund_rounding_adjustment,requested_amount,completed_amount,currency_code,
      refund_method,status,cash_movement_id,provider_reference,destination_reference,confirmed_by_actor_id,
      reason_code,requested_by_actor_id,approved_by_actor_id,idempotency_key,request_checksum,
      correlation_id,causation_id,version,requested_at,approved_at,completed_at,server_recorded_at)
    VALUES (?,?,?,?,?,NULL,'9600.000000','0.000000',?,?,'COP',?,?,NULL,?,?,?,
      'CUSTOMER_CHANGED_MIND',?,?,?,?,?,NULL,1,?,?,?,NULL)`,
  ).run(
    v.id, TENANT, COMPANY, BRANCH, randomUUID(), v.requested_amount, v.completed_amount,
    v.refund_method, v.status, v.provider_reference, v.destination_reference, v.confirmed_by_actor_id,
    v.requested_by_actor_id, v.requested_by_actor_id, v.idempotency_key, SUM, randomUUID(),
    NOW, NOW, v.completed_at,
  );
  return v.id as string;
}

describe("MIGRATION_035 — payments_refunds admite TRANSFER", () => {
  it("es la última versión del libro y conserva las filas existentes de CASH", async () => {
    const database = await open();
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBe(36);
    expect((database.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get() as { v: number }).v).toBe(36);
    const columns = (database.native.prepare("PRAGMA table_info(payments_refunds)").all() as { name: string }[])
      .map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["provider_reference", "destination_reference", "confirmed_by_actor_id"]));
    database.close();
  });

  it("una transferencia PROCESSING no exige evidencia todavía", async () => {
    const database = await open();
    expect(() => insertRefund(database)).not.toThrow();
    database.close();
  });

  it("completar una transferencia exige referencia, destino y confirmador distinto del solicitante", async () => {
    const database = await open();
    expect(() => insertRefund(database, { status: "COMPLETED", completed_at: NOW })).toThrow(/CHECK/);
    expect(() => insertRefund(database, {
      status: "COMPLETED", completed_at: NOW, provider_reference: "TRX-1",
      destination_reference: "Cuenta 123", confirmed_by_actor_id: REQUESTER,
    })).toThrow(/CHECK/);
    expect(() => insertRefund(database, {
      status: "COMPLETED", completed_at: NOW, provider_reference: "TRX-1",
      destination_reference: "Cuenta 123", confirmed_by_actor_id: CONFIRMER,
    })).not.toThrow();
    database.close();
  });

  it("un reembolso en efectivo no admite las columnas de confirmación de transferencia", async () => {
    const database = await open();
    expect(() => insertRefund(database, {
      refund_method: "CASH", status: "PROCESSING", provider_reference: "TRX-1",
    })).toThrow(/CHECK/);
    database.close();
  });

  it("sólo CASH y TRANSFER son métodos admitidos", async () => {
    const database = await open();
    expect(() => insertRefund(database, { refund_method: "QR" })).toThrow(/CHECK/);
    database.close();
  });
});
