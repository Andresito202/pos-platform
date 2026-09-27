import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_LOCAL_SCHEMA_VERSION, LocalDatabase } from "../src/local-database.js";

/**
 * `MIGRATION_034` — devolución comercial y reembolso (`B11`). Aquí sólo la
 * forma que el esquema impone; la devolución de extremo a extremo —venta
 * real, caja, inventario— se prueba por el canal en el servicio.
 *
 * Las filas se insertan con `foreign_keys` apagado salvo en la prueba que
 * comprueba precisamente las claves foráneas: cada CHECK se aísla sin tener
 * que fabricar una venta, un pago y un turno para cada uno.
 */

const directories: string[] = [];
async function open(): Promise<LocalDatabase> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "pos-return-"));
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
const USER = "018f0000-0000-7000-8000-000000000006";
const NOW = "2026-09-27T12:00:00.000Z";
const SUM = "a".repeat(64);

type Row = Record<string, string | number | null>;

function insertReturn(database: LocalDatabase, row: Row = {}): string {
  const v: Row = {
    id: randomUUID(), sale_id: randomUUID(), status: "RETURN_COMPLETED",
    approved_by_actor_id: USER, approved_at: NOW, approved_return_amount: "9600.000000",
    requested_return_amount: "9600.000000", completed_return_amount: "9600.000000",
    returned_rounding_adjustment: "0.000000", completed_at: NOW,
    idempotency_key: randomUUID(), operation_id: randomUUID(), ...row,
  };
  database.native.prepare(`
    INSERT INTO sales_sale_returns(id,tenant_id,company_id,branch_id,sale_id,origin_device_id,
      requested_by_actor_id,approved_by_actor_id,reason_code,reason_detail,status,effective_at,currency_code,
      original_sale_payable_amount,requested_return_amount,approved_return_amount,completed_return_amount,
      returned_tax_amount,returned_rounding_adjustment,pricing_pipeline_version,tax_policy_version,
      rounding_policy_version,operation_id,idempotency_key,request_checksum,expected_sale_version,
      correlation_id,causation_id,requested_at,approved_at,completed_at,created_at,updated_at,version)
    VALUES (?,?,?,?,?,?,?,?,'CUSTOMER_CHANGED_MIND',NULL,?,?,'COP','9600.000000',?,?,?,'0.000000',?,
      'PRICING_PIPELINE_V1','TAX_V1','NEAREST_50_HALF_AWAY_FROM_ZERO_V1',?,?,?,1,?,NULL,?,?,?,?,?,1)`,
  ).run(
    v.id, TENANT, COMPANY, BRANCH, v.sale_id, DEVICE, USER, v.approved_by_actor_id, v.status, NOW,
    v.requested_return_amount, v.approved_return_amount, v.completed_return_amount,
    v.returned_rounding_adjustment, v.operation_id, v.idempotency_key, SUM, randomUUID(),
    NOW, v.approved_at, v.completed_at, NOW, NOW,
  );
  return v.id as string;
}

function insertLine(database: LocalDatabase, row: Row = {}): string {
  const v: Row = {
    id: randomUUID(), sale_return_id: randomUUID(), sale_item_id: randomUUID(),
    physical_condition: "RESTOCKABLE", inventory_resolution: "RETURN_TO_AVAILABLE", ...row,
  };
  database.native.prepare(`
    INSERT INTO sales_sale_return_lines(id,tenant_id,sale_return_id,sale_item_id,presentation_id,lot_id,unit_id,
      sold_quantity_snapshot,previously_returned_quantity_snapshot,requested_quantity,approved_quantity,
      completed_quantity,physical_condition,inventory_resolution,original_unit_price,original_discount_amount,
      original_taxable_amount,original_tax_amount,original_line_total,requested_return_amount,
      approved_return_amount,completed_return_amount,returned_tax_amount,created_at)
    VALUES (?,?,?,?,?,NULL,?,'3.000000','0.000000','3.000000','3.000000','3.000000',?,?,
      '3200.000000','0.000000','9600.000000','0.000000','9600.000000','9600.000000','9600.000000',
      '9600.000000','0.000000',?)`,
  ).run(
    v.id, TENANT, v.sale_return_id, v.sale_item_id, randomUUID(), randomUUID(),
    v.physical_condition, v.inventory_resolution, NOW,
  );
  return v.id as string;
}

function insertRefund(database: LocalDatabase, row: Row = {}): string {
  const v: Row = {
    id: randomUUID(), status: "COMPLETED", requested_amount: "9600.000000", completed_amount: "9600.000000",
    refund_rounding_adjustment: "0.000000", refund_method: "CASH", cash_movement_id: randomUUID(),
    completed_at: NOW, ...row,
  };
  database.native.prepare(`
    INSERT INTO payments_refunds(id,tenant_id,company_id,branch_id,payment_id,sale_return_id,
      commercial_refund_amount,refund_rounding_adjustment,requested_amount,completed_amount,currency_code,
      refund_method,status,cash_movement_id,reason_code,requested_by_actor_id,approved_by_actor_id,
      idempotency_key,request_checksum,correlation_id,causation_id,version,requested_at,approved_at,
      completed_at,server_recorded_at)
    VALUES (?,?,?,?,?,NULL,'9600.000000',?,?,?,'COP',?,?,?,'CUSTOMER_CHANGED_MIND',?,?,?,?,?,NULL,1,?,?,?,NULL)`,
  ).run(
    v.id, TENANT, COMPANY, BRANCH, randomUUID(), v.refund_rounding_adjustment, v.requested_amount,
    v.completed_amount, v.refund_method, v.status, v.cash_movement_id, USER, USER, randomUUID(), SUM,
    randomUUID(), NOW, NOW, v.completed_at,
  );
  return v.id as string;
}

async function openWithoutForeignKeys(): Promise<LocalDatabase> {
  const database = await open();
  database.native.pragma("foreign_keys = OFF");
  return database;
}

describe("MIGRATION_034 — devolución y reembolso", () => {
  it("es la última versión del libro y crea las cuatro tablas", async () => {
    const database = await open();
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBe(34);
    expect((database.native.prepare("SELECT max(version) AS v FROM local_schema_migrations").get() as { v: number }).v).toBe(34);
    const tables = (database.native.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
        AND name IN ('sales_sale_returns','sales_sale_return_lines','payments_refunds','payments_refund_items')
        ORDER BY name`,
    ).all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["payments_refund_items", "payments_refunds", "sales_sale_return_lines", "sales_sale_returns"]);
    database.close();
  });

  it("una devolución no puede apuntar a una venta que no existe", async () => {
    const database = await open();
    expect(() => insertReturn(database)).toThrow(/FOREIGN KEY/);
    database.close();
  });

  it("sólo admite los nueve estados del contrato, sin las proyecciones de Sale", async () => {
    const database = await openWithoutForeignKeys();
    expect(() => insertReturn(database)).not.toThrow();
    expect(() => insertReturn(database, { status: "FULLY_RETURNED" })).toThrow(/CHECK/);
    expect(() => insertReturn(database, { status: "PARTIALLY_RETURNED" })).toThrow(/CHECK/);
    database.close();
  });

  it("completada exige fecha de finalización y aprobación", async () => {
    const database = await openWithoutForeignKeys();
    expect(() => insertReturn(database, { completed_at: null })).toThrow(/CHECK/);
    expect(() => insertReturn(database, {
      approved_by_actor_id: null, approved_at: null, approved_return_amount: null,
    })).toThrow(/CHECK/);
    expect(() => insertReturn(database, { approved_return_amount: null })).toThrow(/CHECK/);
    database.close();
  });

  it("el ajuste de redondeo admite signo; los importes comerciales no", async () => {
    const database = await openWithoutForeignKeys();
    expect(() => insertReturn(database, { returned_rounding_adjustment: "-25.000000" })).not.toThrow();
    expect(() => insertReturn(database, { returned_rounding_adjustment: "25.000000" })).not.toThrow();
    expect(() => insertReturn(database, { completed_return_amount: "-9600.000000" })).toThrow(/CHECK/);
    expect(() => insertReturn(database, { requested_return_amount: "9600.5" })).toThrow(/CHECK/);
    database.close();
  });

  it("la misma clave de idempotencia no crea dos devoluciones", async () => {
    const database = await openWithoutForeignKeys();
    insertReturn(database, { idempotency_key: "k-1" });
    expect(() => insertReturn(database, { idempotency_key: "k-1" })).toThrow(/UNIQUE/);
    database.close();
  });

  it("una devolución terminal no se reescribe ni se borra", async () => {
    const database = await openWithoutForeignKeys();
    const id = insertReturn(database);
    expect(() => database.native.prepare(
      "UPDATE sales_sale_returns SET completed_return_amount='1.000000' WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/final/);
    expect(() => database.native.prepare(
      "DELETE FROM sales_sale_returns WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/append-only/);
    database.close();
  });

  it("sólo lo reponible vuelve al disponible", async () => {
    const database = await openWithoutForeignKeys();
    expect(() => insertLine(database)).not.toThrow();
    expect(() => insertLine(database, { physical_condition: "DAMAGED", inventory_resolution: "NO_RESTOCK" })).not.toThrow();
    expect(() => insertLine(database, { physical_condition: "DAMAGED" })).toThrow(/CHECK/);
    expect(() => insertLine(database, { physical_condition: "EXPIRED" })).toThrow(/CHECK/);
    expect(() => insertLine(database, { physical_condition: "ROTO" })).toThrow(/CHECK/);
    database.close();
  });

  it("una línea no se repite dentro de la devolución y no cambia", async () => {
    const database = await openWithoutForeignKeys();
    const parent = randomUUID();
    const item = randomUUID();
    const id = insertLine(database, { sale_return_id: parent, sale_item_id: item });
    expect(() => insertLine(database, { sale_return_id: parent, sale_item_id: item })).toThrow(/UNIQUE/);
    expect(() => database.native.prepare(
      "UPDATE sales_sale_return_lines SET completed_quantity='1.000000' WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/append-only/);
    expect(() => database.native.prepare(
      "DELETE FROM sales_sale_return_lines WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/append-only/);
    database.close();
  });

  it("un reembolso completado entregó todo lo pedido y dejó su salida de caja", async () => {
    const database = await openWithoutForeignKeys();
    expect(() => insertRefund(database)).not.toThrow();
    expect(() => insertRefund(database, { completed_amount: "9000.000000" })).toThrow(/CHECK/);
    expect(() => insertRefund(database, { cash_movement_id: null })).toThrow(/CHECK/);
    expect(() => insertRefund(database, { completed_at: null })).toThrow(/CHECK/);
    expect(() => insertRefund(database, { refund_method: "TRANSFER" })).toThrow(/CHECK/);
    expect(() => insertRefund(database, { requested_amount: "0.000000", completed_amount: "0.000000" })).toThrow(/CHECK/);
    database.close();
  });

  it("un reembolso terminal no se reescribe ni se borra", async () => {
    const database = await openWithoutForeignKeys();
    const id = insertRefund(database);
    expect(() => database.native.prepare(
      "UPDATE payments_refunds SET status='CANCELLED' WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/final/);
    expect(() => database.native.prepare(
      "DELETE FROM payments_refunds WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/append-only/);
    database.close();
  });

  it("los ítems del reembolso no valen cero y no cambian", async () => {
    const database = await openWithoutForeignKeys();
    const insertItem = (amount: string, sequence: number): string => {
      const id = randomUUID();
      database.native.prepare(`
        INSERT INTO payments_refund_items(id,tenant_id,refund_id,payment_allocation_id,sale_return_line_id,
          amount,currency_code,item_sequence,created_at)
        VALUES (?,?,?,?,NULL,?,'COP',?,?)`,
      ).run(id, TENANT, "018f0000-0000-7000-8000-0000000000aa", randomUUID(), amount, sequence, NOW);
      return id;
    };
    const id = insertItem("9600.000000", 1);
    expect(() => insertItem("0.000000", 2)).toThrow(/CHECK/);
    expect(() => insertItem("100.000000", 1)).toThrow(/UNIQUE/);
    expect(() => database.native.prepare(
      "UPDATE payments_refund_items SET amount='1.000000' WHERE tenant_id=? AND id=?",
    ).run(TENANT, id)).toThrow(/append-only/);
    database.close();
  });
});
