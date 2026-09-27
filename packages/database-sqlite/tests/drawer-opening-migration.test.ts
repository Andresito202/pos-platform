import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_LOCAL_SCHEMA_VERSION, LocalDatabase } from "../src/local-database.js";

/**
 * `MIGRATION_033` — aperturas del cajón (`D-46`). La regla «un pulso por
 * cobro» necesita un cobro real y se prueba por el canal en el servicio; aquí,
 * la forma que el esquema impone a cada fila.
 */

const directories: string[] = [];
async function open(): Promise<LocalDatabase> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "pos-drawer-"));
  directories.push(dataDirectory);
  return LocalDatabase.open({ dataDirectory });
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const USER = "018f0000-0000-7000-8000-000000000006";
const NOW = "2026-09-26T12:00:00.000Z";

function insert(database: LocalDatabase, row: Partial<{
  trigger: string; payment: string | null; reason: string | null; text: string | null; key: string;
}> = {}): string {
  const id = randomUUID();
  const v = { trigger: "MANUAL", payment: null, reason: "DAR_CAMBIO", text: null, key: randomUUID(), ...row };
  database.native.prepare(`
    INSERT INTO hardware_drawer_opening(tenant_id,id,company_id,branch_id,trigger_kind,payment_id,reason_code,
      reason_text,idempotency_key,requested_by_user_id,requested_at,outcome,retryable,diagnostic_code,finished_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)`,
  ).run(TENANT, id, COMPANY, BRANCH, v.trigger, v.payment, v.reason, v.text, v.key, USER, NOW);
  return id;
}

describe("MIGRATION_033 — aperturas del cajón", () => {
  it("está aplicada en el libro", async () => {
    const database = await open();
    expect(LATEST_LOCAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(33);
    expect(database.native.prepare("SELECT version FROM local_schema_migrations WHERE version = 33").get()).toBeDefined();
    database.close();
  });

  it("una apertura manual exige motivo del catálogo", async () => {
    const database = await open();
    for (const reason of ["DAR_CAMBIO", "ARQUEO", "CORRECCION_ENTREGA"]) insert(database, { reason });
    expect(() => insert(database, { reason: null })).toThrow(/CHECK/);
    expect(() => insert(database, { reason: "PORQUE_SI" })).toThrow(/CHECK/);
    database.close();
  });

  it("OTRO exige texto y ningún otro motivo lo admite", async () => {
    const database = await open();
    insert(database, { reason: "OTRO", text: "cliente pidió revisar un billete" });
    expect(() => insert(database, { reason: "OTRO", text: null })).toThrow(/CHECK/);
    expect(() => insert(database, { reason: "OTRO", text: "   " })).toThrow(/CHECK/);
    expect(() => insert(database, { reason: "ARQUEO", text: "texto sobrante" })).toThrow(/CHECK/);
    database.close();
  });

  it("una apertura automática exige un cobro que exista, y no lleva motivo", async () => {
    const database = await open();
    expect(() => insert(database, { trigger: "AUTO_CASH_PAYMENT", payment: null, reason: null })).toThrow(/CHECK/);
    expect(() => insert(database, { trigger: "AUTO_CASH_PAYMENT", payment: randomUUID(), reason: null })).toThrow(/FOREIGN KEY/);
    expect(() => insert(database, { trigger: "MANUAL", payment: randomUUID(), reason: "ARQUEO" })).toThrow(/CHECK/);
    database.close();
  });

  it("la misma petición no abre dos veces", async () => {
    const database = await open();
    insert(database, { key: "drawer-1" });
    expect(() => insert(database, { key: "drawer-1" })).toThrow(/UNIQUE/);
    database.close();
  });

  it("desenlace final, identidad inmutable, nada se borra", async () => {
    const database = await open();
    const id = insert(database);
    expect(() => database.native.prepare("UPDATE hardware_drawer_opening SET reason_code='ARQUEO' WHERE id=?").run(id))
      .toThrow("drawer opening identity is immutable");
    database.native.prepare("UPDATE hardware_drawer_opening SET outcome='SUCCEEDED', retryable=0, finished_at=? WHERE id=?").run(NOW, id);
    expect(() => database.native.prepare("UPDATE hardware_drawer_opening SET outcome='FAILED' WHERE id=?").run(id))
      .toThrow("drawer opening outcome is final");
    expect(() => database.native.prepare("DELETE FROM hardware_drawer_opening").run()).toThrow("append-only");
    database.close();
  });
});
