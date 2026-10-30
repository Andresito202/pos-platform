#!/usr/bin/env node
/**
 * Free, self-contained technical verification. NEVER signs, packages, installs,
 * modifies a service, connects to production, or claims third-party certification.
 *
 * Usage: node tools/ci/free-local-certification.mjs
 * Offline: all checks only execute against the existing checkout/dependencies.
 * Evidence is written ONLY to an isolated temporary directory outside the repo.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const MAX_OUTPUT = 2 * 1024 * 1024;
const ALLOWED_BRANCH = "feat/p0-windows-login-install-readiness";

function run(program, args, timeoutMs = 240_000) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT,
    windowsHide: true,
    shell: false,
    env: { ...process.env, CI: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    exitCode: result.status ?? -1,
    signal: result.signal ?? null,
    error: result.error?.code ?? null,
    output,
  };
}

function git(args) {
  const result = run("git", args, 30_000);
  if (result.exitCode !== 0) throw Error(`GIT_PREFLIGHT_FAILED:${args[0]}:${result.error ?? result.exitCode}`);
  return result.output.trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// No evidence is issued for a dirty or unexpected checkout.
const branch = git(["branch", "--show-current"]);
const commit = git(["rev-parse", "--verify", "HEAD"]);
const status = git(["status", "--porcelain", "--untracked-files=normal"]);
if (branch !== ALLOWED_BRANCH) throw Error("CERTIFICATION_BRANCH_MISMATCH");
if (status !== "") throw Error("CERTIFICATION_REQUIRES_CLEAN_WORKTREE");

const checks = [
  ["contracts-typecheck", ["--filter", "@pos-platform/contracts", "typecheck"]],
  ["device-trust-typecheck", ["--filter", "@pos-platform/device-trust", "typecheck"]],
  ["database-postgres-typecheck", ["--filter", "@pos-platform/database-postgres", "typecheck"]],
  ["local-service-typecheck", ["--filter", "@pos-platform/pos-local-service", "typecheck"]],
  ["desktop-typecheck", ["--filter", "@pos-platform/pos-desktop", "typecheck"]],
  ["migrations-typecheck", ["--filter", "@pos-platform/target-migrations", "typecheck"]],
  ["device-issuer-tests", ["--filter", "@pos-platform/device-trust", "exec", "vitest", "run", "tests/enrollment.test.ts", "tests/enrollment-http.test.ts"]],
  ["local-enrollment-tests", ["--filter", "@pos-platform/pos-local-service", "exec", "vitest", "run", "tests/device-enrollment-service.test.ts"]],
  ["local-sync-tests", ["--filter", "@pos-platform/pos-local-service", "exec", "vitest", "run", "tests/fetch-central-transport.test.ts", "tests/sync-dispatcher.test.ts", "tests/central-sync-component.test.ts"]],
];

const dir = mkdtempSync(join(tmpdir(), "camacho-pos-free-cert-"));
const results = [];
let allPassed = true;
for (const [name, args] of checks) {
  process.stdout.write(`RUN ${name}\n`);
  const started = Date.now();
  // Windows cannot reliably spawn a .cmd shim with shell:false on Node 22.
  // All arguments here are compile-time constants; no user input is passed to cmd.
  const runResult = process.platform === "win32"
    ? run(process.env.ComSpec || "C:\\\\Windows\\\\System32\\\\cmd.exe", ["/d", "/s", "/c", "pnpm", ...args])
    : run("pnpm", args);
  const logPath = join(dir, `${name}.log`);
  writeFileSync(logPath, runResult.output, { flag: "wx", mode: 0o600 });
  const pass = runResult.exitCode === 0 && runResult.error === null && runResult.signal === null;
  results.push({
    name,
    status: pass ? "PASS" : "FAIL",
    exit_code: runResult.exitCode,
    error: runResult.error,
    signal: runResult.signal,
    duration_ms: Date.now() - started,
    log_file: `${name}.log`,
    log_sha256: sha256(readFileSync(logPath)),
  });
  process.stdout.write(`${pass ? "PASS" : "FAIL"} ${name}\n`);
  if (!pass) { allPassed = false; break; }
}

const receipt = {
  schema: "camacho-pos-local-technical-verification/v1",
  status: allPassed ? "PASS" : "FAIL",
  scope: "static checks and named unit/component tests only",
  external_certificate: false,
  public_code_signing: false,
  installation_certified: false,
  device_hardware_certified: false,
  isolated_postgres_gate_included: false,
  git_commit: commit,
  git_branch: branch,
  lockfile_sha256: sha256(readFileSync(join(root, "pnpm-lock.yaml"))),
  node: process.version,
  checks: results,
};
const receiptPath = join(dir, "receipt.json");
const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
writeFileSync(receiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
writeFileSync(join(dir, "receipt.json.sha256"), `${sha256(receiptBytes)}  receipt.json\n`, { flag: "wx", mode: 0o600 });
console.log(`CERTIFICATION_RECEIPT=${receiptPath}`);
console.log(`LOCAL_TECHNICAL_VERIFICATION=${receipt.status}`);
if (!allPassed) process.exitCode = 1;
