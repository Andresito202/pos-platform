#!/usr/bin/env node
/**
 * Restores a verified SQLite backup into an empty directory and opens it.
 * Usage:
 *   node infra/ops/restore-sqlite-verify.mjs \
 *     --backup /abs/backup.db --target-dir /abs/drills
 */
import { mkdtempSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { isAbsolute, join } from "node:path";
import { LocalDatabase } from "../../packages/database-sqlite/src/index.ts";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`);
  return process.argv[i + 1];
}

const backup = arg("--backup");
const targetParent = arg("--target-dir");
if (!isAbsolute(backup) || !isAbsolute(targetParent)) {
  throw new Error("paths must be absolute");
}

const start = performance.now();
const backupAgeMs = Math.max(0, Date.now() - statSync(backup).mtimeMs);
const targetDir = mkdtempSync(join(targetParent, "sqlite-dr-"));
LocalDatabase.restoreFromBackup({ dataDirectory: targetDir }, backup);
const db = LocalDatabase.open({ dataDirectory: targetDir });
try {
  const row = db.native.prepare("PRAGMA integrity_check").get();
  if (!row || Object.values(row)[0] !== "ok") {
    throw new Error("integrity_check failed after restore");
  }
  process.stdout.write(JSON.stringify({ status: "RESTORE_VERIFY_OK", targetDir, backupAgeMs, restoreVerificationMs: Math.round(performance.now() - start) }) + "\n");
} finally {
  db.close();
}
