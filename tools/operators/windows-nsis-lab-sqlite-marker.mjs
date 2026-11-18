#!/usr/bin/env node
/**
 * Create or verify a real SQLite file used as the NSIS upgrade data-preservation
 * marker. Uses better-sqlite3 from @pos-platform/pos-local-service — not a text stub.
 */
import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const requireService = createRequire(join(root, "apps/pos-local-service/package.json"));
const Database = requireService("better-sqlite3");

const [, , mode, dbPathArg, tokenArg] = process.argv;
if (!mode || !dbPathArg || !tokenArg) {
  process.stderr.write("USAGE: windows-nsis-lab-sqlite-marker.mjs <create|verify> <dbPath> <token>\n");
  process.exit(2);
}
const dbPath = resolve(dbPathArg);
const token = String(tokenArg);

if (mode === "create") {
  mkdirSync(dirname(dbPath), { recursive: true });
  if (existsSync(dbPath)) {
    process.stderr.write("SQLITE_MARKER_EXISTS\n");
    process.exit(3);
  }
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE lab_preservation_marker (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO lab_preservation_marker(id, token, created_at) VALUES (1, ?, ?)",
    ).run(token, new Date().toISOString());
  } finally {
    db.close();
  }
  const hash = createHash("sha256").update(token).digest("hex");
  process.stdout.write(JSON.stringify({ ok: true, mode: "create", dbPath, tokenHash: hash }) + "\n");
  process.exit(0);
}

if (mode === "verify") {
  if (!existsSync(dbPath)) {
    process.stdout.write(JSON.stringify({ ok: false, reason: "SQLITE_MARKER_MISSING", dbPath }) + "\n");
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT token FROM lab_preservation_marker WHERE id = 1").get();
    const ok = row && row.token === token;
    process.stdout.write(JSON.stringify({
      ok: Boolean(ok),
      reason: ok ? "SQLITE_MARKER_MATCH" : "SQLITE_MARKER_MISMATCH",
      dbPath,
    }) + "\n");
    process.exit(ok ? 0 : 1);
  } finally {
    db.close();
  }
}

process.stderr.write(`UNKNOWN_MODE:${mode}\n`);
process.exit(2);
