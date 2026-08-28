import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-local-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const item of directories.splice(0)) rmSync(item, { recursive: true, force: true });
});

const MIGRATION_001 = `
CREATE TABLE runtime_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_checksum TEXT NOT NULL CHECK(length(payload_checksum) = 64),
  status TEXT NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','REJECTED','UNKNOWN')),
  result_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX runtime_operations_status_idx ON runtime_operations(status, created_at);
`.trim();

function seedOperation(database: LocalDatabase, suffix: string): void {
  database.native.prepare("INSERT INTO runtime_operations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    `018f0000-0000-7000-8000-0000000000${suffix}`,
    `sale:${suffix}`,
    "a".repeat(64),
    "PENDING",
    "ACCEPTED",
    "2026-08-28T00:00:00Z",
    "2026-08-28T00:00:00Z",
  );
}

function waitForReady(child: ChildProcessWithoutNullStreams, timeoutMs = 8_000): Promise<void> {
  child.stdout.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("writer process did not become ready"));
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: string) => {
      buffer += chunk;
      if (buffer.includes("READY\n")) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`writer process exited before ready: code=${code} signal=${signal}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("writer process did not exit"));
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("LocalDatabase", () => {
  it("enforces one writer and permits a new writer after clean shutdown", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("writer already active");
    first.close();
    const next = LocalDatabase.open({ dataDirectory });
    next.close();
  });

  it("enforces one writer across OS processes and recovers after owner crash", async () => {
    const dataDirectory = await directory();
    const fixture = fileURLToPath(new URL("./fixtures/writer-process.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", fixture, dataDirectory], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await waitForReady(child);

    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("writer already active");

    expect(child.kill("SIGKILL")).toBe(true);
    await waitForExit(child);

    const recovered = LocalDatabase.open({ dataDirectory });
    recovered.assertIntegrity();
    recovered.close();

    expect(
      readdirSync(dataDirectory).some((name) => name.startsWith("local-writer.lock.stale.")),
    ).toBe(true);
  });

  it("persists operations across restart with WAL enabled", async () => {
    const dataDirectory = await directory();
    let db = LocalDatabase.open({ dataDirectory });
    seedOperation(db, "01");
    db.close();
    db = LocalDatabase.open({ dataDirectory });
    expect(db.native.prepare("SELECT count(*) AS count FROM runtime_operations").get()).toEqual({ count: 1 });
    db.close();
  });

  it("blocks a pending migration when verified-backup capacity is insufficient", async () => {
    const dataDirectory = await directory();
    const path = join(dataDirectory, "pos-local.db");
    const raw = new Database(path);
    raw.exec(MIGRATION_001);
    raw.exec(`CREATE TABLE local_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL CHECK(length(checksum) = 64),
      applied_at TEXT NOT NULL
    ) STRICT;`);
    raw.prepare("INSERT INTO local_schema_migrations VALUES (?, ?, ?)").run(
      1,
      createHash("sha256").update(MIGRATION_001).digest("hex"),
      "2026-08-28T00:00:00Z",
    );
    raw.close();

    expect(() => LocalDatabase.open({
      dataDirectory,
      storageProbe: { availableBytes: () => 0n },
    })).toThrow("insufficient free space for SQLite backup");

    const unchanged = new Database(path, { readonly: true });
    expect(unchanged.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='local_security_state'",
    ).get()).toBeUndefined();
    expect(unchanged.prepare(
      "SELECT max(version) AS version FROM local_schema_migrations",
    ).get()).toEqual({ version: 1 });
    unchanged.close();
    expect(existsSync(join(dataDirectory, "local-writer.lock"))).toBe(false);
  });

  it("backs up an existing v1 database before applying v2", async () => {
    const dataDirectory = await directory();
    const path = join(dataDirectory, "pos-local.db");
    const raw = new Database(path);
    raw.exec(MIGRATION_001);
    raw.exec(`CREATE TABLE local_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL CHECK(length(checksum) = 64),
      applied_at TEXT NOT NULL
    ) STRICT;`);
    raw.prepare("INSERT INTO local_schema_migrations VALUES (?, ?, ?)").run(
      1,
      createHash("sha256").update(MIGRATION_001).digest("hex"),
      "2026-08-28T00:00:00Z",
    );
    raw.close();

    const db = LocalDatabase.open({ dataDirectory });
    expect(db.native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='local_security_state'",
    ).get()).toEqual({ name: "local_security_state" });
    db.close();

    const backups = readdirSync(join(dataDirectory, "backups")).filter((name) => name.endsWith(".db"));
    expect(backups).toHaveLength(1);
    const backup = new Database(join(dataDirectory, "backups", backups[0]!), { readonly: true });
    expect(backup.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='local_security_state'",
    ).get()).toBeUndefined();
    backup.close();
  });

  it("restores a verified backup atomically", async () => {
    const dataDirectory = await directory();
    const db = LocalDatabase.open({ dataDirectory });
    seedOperation(db, "01");
    const backup = db.createVerifiedBackup();
    seedOperation(db, "02");
    db.close();

    LocalDatabase.restoreFromBackup({ dataDirectory }, backup);
    const restored = LocalDatabase.open({ dataDirectory });
    expect(restored.native.prepare("SELECT count(*) AS count FROM runtime_operations").get()).toEqual({ count: 1 });
    restored.close();
  });

  it("enforces migration ledger immutability and detects bypassed tampering", async () => {
    const dataDirectory = await directory();
    const db = LocalDatabase.open({ dataDirectory });
    db.close();

    const raw = new Database(join(dataDirectory, "pos-local.db"));
    expect(() => raw.prepare(
      "UPDATE local_schema_migrations SET checksum = ? WHERE version = 1",
    ).run("0".repeat(64))).toThrow("local migration ledger is immutable");
    raw.exec("DROP TRIGGER local_schema_migrations_no_update");
    raw.prepare("UPDATE local_schema_migrations SET checksum = ? WHERE version = 1").run("0".repeat(64));
    raw.close();

    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("ledger mismatch");
    expect(existsSync(join(dataDirectory, "local-writer.lock"))).toBe(false);
  });

  it("applies busy_timeout to real SQLite write contention", async () => {
    const dataDirectory = await directory();
    const db = LocalDatabase.open({ dataDirectory, busyTimeoutMs: 40 });
    const blocker = new Database(join(dataDirectory, "pos-local.db"));
    blocker.pragma("journal_mode = WAL");
    blocker.exec("BEGIN IMMEDIATE");

    const started = Date.now();
    expect(() => seedOperation(db, "01")).toThrow();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(25);

    blocker.exec("ROLLBACK");
    blocker.close();
    db.close();
  });

  it("does not steal an unreadable writer lock", async () => {
    const dataDirectory = await directory();
    writeFileSync(join(dataDirectory, "local-writer.lock"), "invalid", { mode: 0o600 });
    expect(() => LocalDatabase.open({ dataDirectory })).toThrow("manual recovery required");
  });
});
