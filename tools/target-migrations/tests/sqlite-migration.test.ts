import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as sqliteRunner from "../src/sqlite.js";
import { applySqlite001, inspectSqlite001 } from "../src/sqlite.js";

describe("001_local_migration_control", () => {
  let directory = "";
  let databasePath = "";
  let first: Awaited<ReturnType<typeof applySqlite001>>;
  let repeated: Awaited<ReturnType<typeof applySqlite001>>;
  let inspection: Awaited<ReturnType<typeof inspectSqlite001>>;
  let reopenInspection: Awaited<ReturnType<typeof inspectSqlite001>>;
  let recovered = false;
  let checksumRejected = false;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "pos-target-sqlite-"));
    databasePath = join(directory, "local.db");
    first = await applySqlite001({ path: databasePath });
    repeated = await applySqlite001({ path: databasePath });
    inspection = await inspectSqlite001(databasePath);
    reopenInspection = await inspectSqlite001(databasePath);

    const crashPath = join(directory, "crash.db");
    await expect(applySqlite001({ path: crashPath, simulateCrashAfterStarted: true })).rejects.toThrow("simulated SQLite crash");
    const recovery = await applySqlite001({ path: crashPath });
    recovered = recovery.reconciled;

    const corruptPath = join(directory, "checksum.db");
    await applySqlite001({ path: corruptPath });
    const native = new Database(corruptPath);
    try {
      native.prepare(`INSERT INTO target_migration_executions (
        execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,finished_at,runner_version,error_code
      ) VALUES (?,?,?,?,zeroblob(32),'FAILED',?,?,?,?)`).run(
        "018f0000-0000-7000-8000-0000000000ff",
        "001_local_migration_control",
        "SQLITE",
        1,
        new Date().toISOString(),
        new Date().toISOString(),
        "test",
        "CONTROLLED_MISMATCH",
      );
    } finally {
      native.close();
    }
    try {
      await applySqlite001({ path: corruptPath });
    } catch (error) {
      checksumRejected = error instanceof Error && error.message.includes("checksum mismatch");
    }
  });

  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("creates a fresh database", () => expect(first.noOp).toBe(false));
  it("creates the sole ledger table", () => expect(inspection.tableCount).toBe(1));
  it("enables WAL", () => expect(inspection.journalMode.toLowerCase()).toBe("wal"));
  it("enables foreign keys", () => expect(inspection.foreignKeys).toBe(1));
  it("retains WAL after reopen", () => expect(reopenInspection.journalMode.toLowerCase()).toBe("wal"));
  it("re-enables connection-scoped foreign keys after reopen", () => expect(reopenInspection.foreignKeys).toBe(1));
  it("rejects a checksum mismatch", () => expect(checksumRejected).toBe(true));
  it("makes repeated migration a no-op", () => expect(repeated.noOp).toBe(true));
  it("recovers an abandoned STARTED execution", () => expect(recovered).toBe(true));
  it("does not create Inbox", () => expect(inspection.tableCount).toBe(1));
  it("does not create Foundation or commercial tables", () => expect(inspection.tableCount).toBe(1));
  it("does not expose down", () => expect("downSqlite001" in sqliteRunner).toBe(false));
});
