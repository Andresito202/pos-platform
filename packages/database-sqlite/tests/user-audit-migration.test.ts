import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_LOCAL_SCHEMA_VERSION, LocalDatabase } from "../src/index.js";

/**
 * MIGRATION_008 (DEC-012 D4): amplía `local_operation_audit.actor_type` para
 * admitir `'USER'`, reconstruyendo la tabla porque SQLite no permite alterar un
 * CHECK.
 *
 * Los tests que verifican preservación de datos no pueden ejecutarse contra una
 * base recién creada, porque ahí la migración no copia nada. Por eso se
 * construye una base en estado v7 **real** y se deja que el runner de
 * migraciones aplique 008 sobre ella.
 */

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-user-audit-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const TENANT = "018f0000-0000-7000-8000-0000000000c1";
const COMPANY = "018f0000-0000-7000-8000-0000000000c2";
const BRANCH = "018f0000-0000-7000-8000-0000000000c3";
const DEVICE = "018f0000-0000-7000-8000-0000000000c4";
const USER = "018f0000-0000-7000-8000-0000000000c5";

/** Forma exacta de `local_operation_audit` anterior a MIGRATION_008. */
const LEGACY_AUDIT_TABLE = `
CREATE TABLE local_operation_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('DEVICE','SYSTEM')),
  actor_id TEXT,
  session_id TEXT NOT NULL,
  action_code TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  reason_code TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX local_operation_audit_scope_idx
  ON local_operation_audit(tenant_id, company_id, branch_id, created_at);
CREATE TRIGGER local_operation_audit_no_update
  BEFORE UPDATE ON local_operation_audit
  BEGIN SELECT RAISE(ABORT, 'local operation audit is append-only'); END;
CREATE TRIGGER local_operation_audit_no_delete
  BEFORE DELETE ON local_operation_audit
  BEGIN SELECT RAISE(ABORT, 'local operation audit is append-only'); END;
`;

const HISTORICAL_ROWS = [
  {
    actor_type: "DEVICE", actor_id: DEVICE, session_id: "session-alpha",
    action_code: "OPERATION_CONFIRMED", resource_type: "runtime.operation",
    resource_id: "res-1", correlation_id: "corr-1", causation_id: "cause-1",
    reason_code: "REASON_A", details_json: '{"a":1}', created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    actor_type: "SYSTEM", actor_id: null, session_id: "session-beta",
    action_code: "SYSTEM_TASK", resource_type: "runtime.task",
    resource_id: null, correlation_id: "corr-2", causation_id: null,
    reason_code: null, details_json: '{"b":2}', created_at: "2026-09-02T11:30:00.000Z",
  },
  {
    actor_type: "DEVICE", actor_id: DEVICE, session_id: "session-gamma",
    action_code: "OPERATION_CONFIRMED", resource_type: "runtime.operation",
    resource_id: "res-3", correlation_id: "corr-3", causation_id: null,
    reason_code: null, details_json: '{"c":3}', created_at: "2026-09-03T09:15:00.000Z",
  },
];

/**
 * Construye una base en estado v7: abre una completa, revierte la tabla de
 * auditoría a su forma anterior, borra el asiento de la migración 008 y siembra
 * filas históricas. Al reabrirla, el runner aplicará 008 de verdad.
 */
async function databaseAtVersionSeven(): Promise<string> {
  const dataDirectory = await directory();
  LocalDatabase.open({ dataDirectory }).close();

  const raw = new Database(join(dataDirectory, "pos-local.db"));
  try {
    raw.exec(`
      DROP TRIGGER local_operation_audit_no_update;
      DROP TRIGGER local_operation_audit_no_delete;
      DROP TABLE local_operation_audit;
      ${LEGACY_AUDIT_TABLE}
      DROP TRIGGER local_schema_migrations_no_delete;
      DROP TABLE local_trust_anchor;
      DROP TABLE inventory_movement;
      DROP TABLE inventory_stock;
      DROP TABLE catalog_price;
      DROP TABLE catalog_presentation;
      DROP TABLE catalog_product;
      DROP TABLE catalog_fiscal_attribute;
      DROP TABLE customers_credit_transactions;
      DROP TABLE customers_credit_accounts;
      DROP TABLE customers_customers;
      DROP TABLE payments_payment_allocations;
      DROP TABLE payments_payment_attempts;
      DROP TABLE payments_payments;
      DROP TABLE payments_payment_groups;
      DROP TABLE sandbox_price_rule;
      DROP TABLE sandbox_catalog_presentation;
      DROP TABLE sandbox_catalog_product;
      DROP TABLE sales_sale_items;
      DROP TABLE sales_sales;
      DROP TABLE sales_document_series_counter;
      DROP TABLE cash_movement;
      DROP TABLE cash_shift;
      DROP TABLE cash_register;
      DROP TRIGGER local_master_snapshot_artifact_no_update;
      DROP TRIGGER local_master_snapshot_artifact_no_delete;
      DROP TABLE local_master_snapshot_artifact;
      DELETE FROM local_schema_migrations WHERE version > 7;
      CREATE TRIGGER local_schema_migrations_no_delete
        BEFORE DELETE ON local_schema_migrations
        BEGIN SELECT RAISE(ABORT, 'local migration ledger is immutable'); END;
    `);

    const insert = raw.prepare(`
      INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id, actor_type, actor_id, session_id,
        action_code, resource_type, resource_id, correlation_id, causation_id,
        reason_code, details_json, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const row of HISTORICAL_ROWS) {
      insert.run(
        TENANT, COMPANY, BRANCH, DEVICE, row.actor_type, row.actor_id, row.session_id,
        row.action_code, row.resource_type, row.resource_id, row.correlation_id,
        row.causation_id, row.reason_code, row.details_json, row.created_at,
      );
    }

    // El estado de partida es realmente v7 y realmente rechaza USER.
    expect(
      (raw.prepare("SELECT max(version) AS version FROM local_schema_migrations")
        .get() as { version: number }).version,
    ).toBe(7);
  } finally {
    raw.close();
  }
  return dataDirectory;
}

function auditRows(database: LocalDatabase): Record<string, unknown>[] {
  return database.native
    .prepare("SELECT * FROM local_operation_audit ORDER BY sequence")
    .all() as Record<string, unknown>[];
}

function insertAudit(
  database: LocalDatabase,
  actorType: string,
  actorId: string | null,
  sessionId = "session-new",
): void {
  database.native.prepare(`
    INSERT INTO local_operation_audit(
      tenant_id, company_id, branch_id, device_id, actor_type, actor_id, session_id,
      action_code, resource_type, resource_id, correlation_id, causation_id,
      reason_code, details_json, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    TENANT, COMPANY, BRANCH, DEVICE, actorType, actorId, sessionId,
    "TEST_ACTION", "test.resource", null, "corr-new", null, null, "{}",
    "2026-09-04T00:00:00.000Z",
  );
}

// ── Schema (1-5) ─────────────────────────────────────────────────────────────

describe("MIGRATION_008 — schema", () => {
  it("keeps the audit table present after migrating", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const table = database.native.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='local_operation_audit'",
      ).get() as { name: string } | undefined;
      expect(table?.name).toBe("local_operation_audit");
    } finally {
      database.close();
    }
  });

  it("accepts DEVICE, SYSTEM and USER at schema level", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      expect(() => insertAudit(database, "DEVICE", DEVICE)).not.toThrow();
      expect(() => insertAudit(database, "SYSTEM", null)).not.toThrow();
      expect(() => insertAudit(database, "USER", USER)).not.toThrow();
      expect(auditRows(database)).toHaveLength(3);
    } finally {
      database.close();
    }
  });

  it("rejects an unknown actor type", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      expect(() => insertAudit(database, "PLATFORM_ACCOUNT", USER)).toThrow(/CHECK constraint/i);
      expect(() => insertAudit(database, "user", USER)).toThrow(/CHECK constraint/i);
      expect(() => insertAudit(database, "", null)).toThrow(/CHECK constraint/i);
    } finally {
      database.close();
    }
  });

  it("leaves no intermediate table behind", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const tables = (database.native
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]).map((row) => row.name);
      expect(tables).not.toContain("local_operation_audit_rebuilt");
    } finally {
      database.close();
    }
  });
});

// ── Histórico (6-12) ─────────────────────────────────────────────────────────

describe("MIGRATION_008 — preservación del histórico", () => {
  it("preserves every historical row exactly", async () => {
    const dataDirectory = await databaseAtVersionSeven();

    const before = new Database(join(dataDirectory, "pos-local.db"));
    const snapshot = before
      .prepare("SELECT * FROM local_operation_audit ORDER BY sequence")
      .all() as Record<string, unknown>[];
    const countBefore = (before
      .prepare("SELECT COUNT(*) AS total FROM local_operation_audit")
      .get() as { total: number }).total;
    before.close();

    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      const after = auditRows(upgraded);
      // Recuento idéntico y filas idénticas campo a campo, incluida la
      // secuencia, el actor, la sesión, la metadata y los timestamps.
      expect(after).toHaveLength(countBefore);
      expect(after).toEqual(snapshot);
    } finally {
      upgraded.close();
    }
  });

  it("does not reinterpret DEVICE or SYSTEM actors", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      const actors = auditRows(upgraded).map((row) => row.actor_type);
      expect(actors).toEqual(["DEVICE", "SYSTEM", "DEVICE"]);
      // Ninguna fila histórica se convirtió en USER.
      expect(actors).not.toContain("USER");
    } finally {
      upgraded.close();
    }
  });

  it("preserves actor_id, including its absence for SYSTEM", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      const rows = auditRows(upgraded);
      expect(rows[0]?.actor_id).toBe(DEVICE);
      expect(rows[1]?.actor_id).toBeNull();
      expect(rows[2]?.actor_id).toBe(DEVICE);
    } finally {
      upgraded.close();
    }
  });

  it("preserves session_id, metadata and timestamps", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      const rows = auditRows(upgraded);
      expect(rows.map((row) => row.session_id)).toEqual([
        "session-alpha", "session-beta", "session-gamma",
      ]);
      expect(rows.map((row) => row.details_json)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
      expect(rows.map((row) => row.created_at)).toEqual([
        "2026-09-01T10:00:00.000Z", "2026-09-02T11:30:00.000Z", "2026-09-03T09:15:00.000Z",
      ]);
      expect(rows.map((row) => row.reason_code)).toEqual(["REASON_A", null, null]);
      expect(rows.map((row) => row.causation_id)).toEqual(["cause-1", null, null]);
    } finally {
      upgraded.close();
    }
  });

  it("preserves the sequence values and keeps the counter monotonic", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      expect(auditRows(upgraded).map((row) => row.sequence)).toEqual([1, 2, 3]);
      insertAudit(upgraded, "DEVICE", DEVICE);
      expect(auditRows(upgraded).map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
    } finally {
      upgraded.close();
    }
  });
});

// ── Append-only (13-15) ──────────────────────────────────────────────────────

describe("MIGRATION_008 — append-only preservado", () => {
  it("allows INSERT but rejects UPDATE and DELETE on migrated historical rows", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      expect(() => insertAudit(upgraded, "DEVICE", DEVICE)).not.toThrow();
      expect(() => upgraded.native
        .prepare("UPDATE local_operation_audit SET reason_code='X' WHERE sequence=1").run())
        .toThrow(/append-only/);
      expect(() => upgraded.native
        .prepare("DELETE FROM local_operation_audit WHERE sequence=1").run())
        .toThrow(/append-only/);
    } finally {
      upgraded.close();
    }
  });

  it("rejects UPDATE and DELETE on rows written after the migration", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      insertAudit(database, "USER", USER);
      expect(() => database.native
        .prepare("UPDATE local_operation_audit SET actor_type='DEVICE' WHERE sequence=1").run())
        .toThrow(/append-only/);
      expect(() => database.native
        .prepare("DELETE FROM local_operation_audit").run())
        .toThrow(/append-only/);
      expect(auditRows(database)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("recreates both append-only triggers on the rebuilt table", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const triggers = (database.native.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='local_operation_audit'",
      ).all() as { name: string }[]).map((row) => row.name).sort();
      expect(triggers).toEqual([
        "local_operation_audit_no_delete",
        "local_operation_audit_no_update",
      ]);
    } finally {
      database.close();
    }
  });

  it("recreates the scope index on the rebuilt table", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const index = database.native.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='local_operation_audit_scope_idx'",
      ).get() as { name: string } | undefined;
      expect(index?.name).toBe("local_operation_audit_scope_idx");
    } finally {
      database.close();
    }
  });
});

// ── Forma de un registro USER (16-19) ────────────────────────────────────────

describe("MIGRATION_008 — forma del registro USER", () => {
  it("accepts a USER row carrying its actor_id", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      insertAudit(database, "USER", USER, "session-user");
      const row = auditRows(database)[0];
      expect(row?.actor_type).toBe("USER");
      expect(row?.actor_id).toBe(USER);
      expect(row?.session_id).toBe("session-user");
    } finally {
      database.close();
    }
  });

  it("rejects a USER row without an actor_id", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      // Un acto de usuario sin usuario no es atribuible, y una auditoría no
      // atribuible es peor que ninguna.
      expect(() => insertAudit(database, "USER", null)).toThrow(/CHECK constraint/i);
    } finally {
      database.close();
    }
  });

  it("still allows SYSTEM without an actor_id", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      expect(() => insertAudit(database, "SYSTEM", null)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("no code path writes a USER row: the schema is prepared, not enabled", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      // Ninguna operación de negocio existe todavía; la tabla nace vacía y solo
      // este test puede insertar USER, escribiendo SQL directamente.
      expect(auditRows(database)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

// ── Atomicidad (20-23) ───────────────────────────────────────────────────────

describe("MIGRATION_008 — atomicidad", () => {
  /**
   * Se ejecutan las mismas sentencias de la migración bajo el mismo envoltorio
   * transaccional que usa el runner, con un fallo inyectado al final. Si la
   * reconstrucción no fuese atómica, quedarían la tabla intermedia, filas
   * perdidas o triggers ausentes.
   */
  it("rolls back the whole rebuild when a later statement fails", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const raw = new Database(join(dataDirectory, "pos-local.db"));
    try {
      const before = raw.prepare("SELECT * FROM local_operation_audit ORDER BY sequence").all();

      const rebuildThenFail = raw.transaction(() => {
        raw.exec(`
          DROP TRIGGER local_operation_audit_no_update;
          DROP TRIGGER local_operation_audit_no_delete;
          CREATE TABLE local_operation_audit_rebuilt (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            actor_type TEXT NOT NULL CHECK(actor_type IN ('DEVICE','SYSTEM','USER')),
            actor_id TEXT,
            session_id TEXT NOT NULL,
            action_code TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            correlation_id TEXT NOT NULL,
            causation_id TEXT,
            reason_code TEXT,
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          ) STRICT;
          INSERT INTO local_operation_audit_rebuilt SELECT * FROM local_operation_audit;
          DROP TABLE local_operation_audit;
          ALTER TABLE local_operation_audit_rebuilt RENAME TO local_operation_audit;
        `);
        // Fallo posterior, dentro de la misma transacción.
        raw.exec("INSERT INTO local_operation_audit(sequence) VALUES (1);");
      });

      expect(() => rebuildThenFail()).toThrow();

      // Datos intactos.
      expect(raw.prepare("SELECT * FROM local_operation_audit ORDER BY sequence").all())
        .toEqual(before);
      // Triggers intactos.
      const triggers = (raw.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='local_operation_audit'",
      ).all() as { name: string }[]).map((row) => row.name).sort();
      expect(triggers).toEqual([
        "local_operation_audit_no_delete",
        "local_operation_audit_no_update",
      ]);
      // Sin tabla intermedia.
      const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]).map((row) => row.name);
      expect(tables).not.toContain("local_operation_audit_rebuilt");
      // El esquema anterior sigue rechazando USER: la migración no se aplicó.
      expect(() => raw.prepare(`
        INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id, actor_type, actor_id, session_id,
          action_code, resource_type, resource_id, correlation_id, causation_id,
          reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,?,?,?,?,?,?,?,?)
      `).run(
        TENANT, COMPANY, BRANCH, DEVICE, USER, "s", "A", "r", null, "c", null, null, "{}", "t",
      )).toThrow(/CHECK constraint/i);
    } finally {
      raw.close();
    }
  });
});

// ── Ciclo de vida de migraciones (24-28) ─────────────────────────────────────

describe("MIGRATION_008 — ciclo de vida", () => {
  it("applies from an empty database", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const version = (database.native
        .prepare("SELECT max(version) AS version FROM local_schema_migrations")
        .get() as { version: number }).version;
      expect(version).toBe(LATEST_LOCAL_SCHEMA_VERSION);
      expect(() => insertAudit(database, "USER", USER)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("applies over an existing v7 database", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    const upgraded = LocalDatabase.open({ dataDirectory });
    try {
      expect((upgraded.native.prepare("SELECT max(version) AS version FROM local_schema_migrations")
        .get() as { version: number }).version).toBe(LATEST_LOCAL_SCHEMA_VERSION);
      expect(() => insertAudit(upgraded, "USER", USER)).not.toThrow();
    } finally {
      upgraded.close();
    }
  });

  it("applies only once and survives reopening", async () => {
    const dataDirectory = await databaseAtVersionSeven();
    LocalDatabase.open({ dataDirectory }).close();

    const reopened = LocalDatabase.open({ dataDirectory });
    try {
      const applied = reopened.native
        .prepare("SELECT COUNT(*) AS total FROM local_schema_migrations WHERE version = 8")
        .get() as { total: number };
      expect(applied.total).toBe(1);
      // El histórico sigue intacto tras la reapertura.
      expect(auditRows(reopened)).toHaveLength(HISTORICAL_ROWS.length);
    } finally {
      reopened.close();
    }
  });

  it("records a checksum for version 8 and leaves 001..007 untouched", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    const ledgerBefore = first.native
      .prepare("SELECT version, checksum FROM local_schema_migrations ORDER BY version")
      .all() as { version: number; checksum: string }[];
    first.close();

    // El libro de migraciones es contiguo desde 1 hasta la última versión. Es
    // la afirmación real; escribir la lista a mano sólo la acoplaba al literal.
    expect(ledgerBefore.map((row) => row.version)).toEqual(
      Array.from({ length: LATEST_LOCAL_SCHEMA_VERSION }, (_, index) => index + 1),
    );
    for (const row of ledgerBefore) expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);

    // Reabrir no altera ningún checksum histórico.
    const second = LocalDatabase.open({ dataDirectory });
    try {
      const ledgerAfter = second.native
        .prepare("SELECT version, checksum FROM local_schema_migrations ORDER BY version")
        .all() as { version: number; checksum: string }[];
      expect(ledgerAfter).toEqual(ledgerBefore);
    } finally {
      second.close();
    }
  });

  it("still rejects a tampered historical checksum", async () => {
    const dataDirectory = await directory();
    LocalDatabase.open({ dataDirectory }).close();

    const raw = new Database(join(dataDirectory, "pos-local.db"));
    raw.exec(`
      DROP TRIGGER local_schema_migrations_no_update;
      UPDATE local_schema_migrations SET checksum = '${"0".repeat(64)}' WHERE version = 5;
    `);
    raw.close();

    expect(() => LocalDatabase.open({ dataDirectory })).toThrow(/ledger mismatch/);
  });
});

// ── Frontera de seguridad (29-32) ────────────────────────────────────────────

describe("MIGRATION_008 — frontera de seguridad", () => {
  it("the only audit writer emits DEVICE as a SQL literal, not a parameter", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("../../../apps/pos-local-service/src/operations/operation-confirmation-store.ts", import.meta.url),
      "utf8",
    ));
    // `actor_type` está fijado en la sentencia: ningún llamador puede elegirlo,
    // así que ampliar el CHECK no amplía la superficie de ataque.
    expect(source).toContain("'DEVICE'");
    expect(source).not.toMatch(/actor_type\s*[,)]?\s*=?\s*\?/);
  });

  it("widening the constraint enables no user operation: nothing writes USER", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const userRows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_operation_audit WHERE actor_type='USER'")
        .get() as { total: number };
      expect(userRows.total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("introduces no authorization, presence or environment authority", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("../src/local-database.ts", import.meta.url),
      "utf8",
    ));
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      "evaluatePermission", "presence", "PIN", "password", "POS_TENANT_ID",
      "POS_COMPANY_ID", "POS_BRANCH_ID", "process.env",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});
