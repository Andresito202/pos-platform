#!/usr/bin/env node
/**
 * Restores a verified SQLite backup into an empty directory and opens it.
 * Usage:
 *   node infra/ops/restore-sqlite-verify.mjs \
 *     --backup /abs/backup.db --target-dir /abs/empty-dir
 */
import { isAbsolute, resolve } from "node:path";
import { LocalDatabase } from "@pos-platform/database-sqlite";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`);
  return process.argv[i + 1];
}

const backup = resolve(arg("--backup"));
const targetDir = resolve(arg("--target-dir"));
if (!isAbsolute(backup) || !isAbsolute(targetDir)) {
  throw new Error("paths must be absolute");
}

LocalDatabase.restoreFromBackup({ dataDirectory: targetDir }, backup);
const db = LocalDatabase.open({ dataDirectory: targetDir });
try {
  const row = db.native.prepare("PRAGMA integrity_check").get();
  if (!row || Object.values(row)[0] !== "ok") {
    throw new Error("integrity_check failed after restore");
  }
  process.stdout.write(JSON.stringify({ status: "RESTORE_VERIFY_OK", targetDir }) + "\n");
} finally {
  db.close();
}
