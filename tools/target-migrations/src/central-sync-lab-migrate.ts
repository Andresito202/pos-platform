/**
 * Explicit isolated-lab migration entry. Never use with an existing POS DB.
 * The operator wrapper uses only loopback port 55436 and a disposable Docker
 * container, and checks those boundaries before invoking this command.
 */
import { applyPostgres001, applyPostgres002 } from "./postgres.js";
import { applyPostgres003 } from "./postgres-003-runner.js";
import { applyPostgres004 } from "./postgres-004-runner.js";
import { applyRoleReadiness, checkRoleReadiness } from "./postgres-003-role-readiness.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.env.POSTGRES_ADMIN_URL;
if (!url) throw new Error("LAB_POSTGRES_ADMIN_URL_MISSING");
const parsed = new URL(url);
if (
  parsed.protocol !== "postgres:" ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "55436" ||
  parsed.pathname !== "/postgres" ||
  parsed.username !== "postgres" ||
  process.env.CAMACHO_ISOLATED_SYNC_LAB !== "YES"
) {
  throw new Error("LAB_POSTGRES_TARGET_NOT_DISPOSABLE");
}
const commit = process.env.REPOSITORY_COMMIT;
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("LAB_REPOSITORY_COMMIT_REQUIRED");

const one = await applyPostgres001({ adminUrl: url });
console.log(JSON.stringify({ migration: "001_central_foundation", result: one }));

const two = await applyPostgres002({ adminUrl: url });
console.log(JSON.stringify({ migration: "002_external_integrations_foundation", result: two }));

const receiptDir = mkdtempSync(join(tmpdir(), "camacho-isolated-migration-"));
const roleUrl = new URL(url);
roleUrl.username = "pos_migrator";
roleUrl.password = "";
const verificationUrl = new URL(url);
verificationUrl.username = "pos_platform_admin";
verificationUrl.password = "";

const roleConfig = {
  provisioningUrl: roleUrl.toString(),
  verificationUrl: verificationUrl.toString(),
  environmentId: "windows-local-sync-isolated",
  expectedDatabase: "postgres",
  repositoryCommit: commit,
  operatorOrJobId: "windows-central-sync-isolated-gate",
  receiptOutputPath: join(receiptDir, "mat003-role-readiness-receipt.json"),
};
const readiness = await applyRoleReadiness(roleConfig);
if (readiness.result !== "READY_WITH_RECEIPT" && readiness.result !== "READY_NO_OP") {
  throw new Error(`LAB_MAT003_ROLE_READINESS_FAILED:${readiness.failure_code ?? readiness.result}`);
}
const verification = await checkRoleReadiness(roleConfig);
if (verification.result !== "PASS" || verification.state !== "READY") {
  throw new Error(`LAB_MAT003_ROLE_POSTCHECK_FAILED:${verification.failure_code ?? verification.state}`);
}
console.log(JSON.stringify({ provisioning: "MAT003_ROLE_READINESS", result: readiness.result, verified: verification.state }));

const three = await applyPostgres003({
  adminUrl: url,
  expectedDatabase: "postgres",
  environmentId: "windows-local-sync-isolated",
  repositoryCommit: commit,
  receiptOutputPath: join(receiptDir, "003-apply-receipt.json"),
});
if (three.result === "APPLIED_WITHOUT_DURABLE_RECEIPT") throw new Error("LAB_003_RECEIPT_NOT_DURABLE");
console.log(JSON.stringify({ migration: "003_fiscal_electronic_invoicing_foundation", result: three }));

const four = await applyPostgres004({ adminUrl: url, expectedDatabase: "postgres", repositoryCommit: commit });
console.log(JSON.stringify({ migration: "004_device_trust", result: four }));
