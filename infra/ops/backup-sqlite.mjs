#!/usr/bin/env node
/**
 * Verified SQLite backup via LocalDatabase.createVerifiedBackup.
 * Usage: node infra/ops/backup-sqlite.mjs --data-dir /absolute/path
 */
import { isAbsolute, resolve } from "node:path";
import { LocalDatabase } from "@pos-platform/database-sqlite";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`);
  return process.argv[i + 1];
}

const dataDir = resolve(arg("--data-dir"));
if (!isAbsolute(dataDir)) throw new Error("--data-dir must be absolute");

const label = process.argv.includes("--label")
  ? arg("--label")
  : "scheduled";

const db = LocalDatabase.open({ dataDirectory: dataDir });
try {
  const path = db.createVerifiedBackup(label);
  process.stdout.write(JSON.stringify({ status: "BACKUP_OK", path }) + "\n");
} finally {
  db.close();
}
