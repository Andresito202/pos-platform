import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applySqlite001 } from "../src/sqlite.js";

describe("SQLite migration concurrency regression", () => {
  it("serializes concurrent first apply into one apply and safe no-ops", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pos-target-sqlite-concurrency-"));
    const databasePath = join(directory, "local.db");
    try {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => applySqlite001({ path: databasePath })),
      );

      expect(results.filter((result) => !result.noOp).length).toBe(1);
      expect(results.filter((result) => result.noOp).length).toBe(3);
      expect(new Set(results.map((result) => result.executionId)).size).toBe(1);

      const native = new Database(databasePath);
      try {
        const rows = native.prepare(`
          SELECT execution_id, status
          FROM target_migration_executions
          WHERE migration_id = '001_local_migration_control'
          ORDER BY started_at
        `).all() as Array<{ execution_id: string; status: string }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("APPLIED");
        expect(rows[0]!.execution_id).toBe(results[0]!.executionId);
      } finally {
        native.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
