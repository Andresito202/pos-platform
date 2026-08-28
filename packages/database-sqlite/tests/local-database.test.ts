import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "pos-local-")); directories.push(value); return value; }
afterEach(() => { for (const item of directories.splice(0)) rmSync(item, { recursive: true, force: true }); });

describe("LocalDatabase", () => {
  it("enforces one writer and permits a new writer after clean shutdown", async () => {
    const dataDirectory = await directory(); const first = LocalDatabase.open({ dataDirectory });
    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("writer already active");
    first.close(); const next = LocalDatabase.open({ dataDirectory }); next.close();
  });
  it("persists operations across restart with WAL enabled", async () => {
    const dataDirectory = await directory(); let db = LocalDatabase.open({ dataDirectory });
    db.native.prepare("INSERT INTO runtime_operations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "018f0000-0000-7000-8000-000000000001", "sale:1", "a".repeat(64), "PENDING", "ACCEPTED",
      "2026-08-28T00:00:00Z", "2026-08-28T00:00:00Z");
    db.close(); db = LocalDatabase.open({ dataDirectory });
    expect(db.native.prepare("SELECT count(*) AS count FROM runtime_operations").get()).toEqual({ count: 1 });
    db.close();
  });
  it("fails closed on a tampered migration ledger", async () => {
    const dataDirectory = await directory(); const db = LocalDatabase.open({ dataDirectory }); db.close();
    const raw = new Database(join(dataDirectory, "pos-local.db"));
    raw.prepare("UPDATE local_schema_migrations SET checksum = ? WHERE version = 1").run("0".repeat(64)); raw.close();
    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("ledger mismatch");
    expect(existsSync(join(dataDirectory, "local-writer.lock"))).toBe(false);
  });
  it("does not steal an unreadable writer lock", async () => {
    const dataDirectory = await directory(); writeFileSync(join(dataDirectory, "local-writer.lock"), "invalid", { mode: 0o600 });
    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("manual recovery required");
  });
});
