#!/usr/bin/env node
/**
 * Real Windows native-addon smoke, without SCM installation or pipe creation.
 * Tests the same .node module under Node.js and Electron-as-Node.
 *
 * Does not call any valid listen/connect operations: these require a separately
 * provisioned Windows service and receiver identity. Fail closed if a runtime
 * fails to load the binary or exposes an incomplete API.
 *
 * Usage: node tools/operators/windows-native-addon-runtime-smoke.mjs
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const addonFile = join(root, "packages/local-channel/native/build/Release/camacho_windows_pipe.node");
const required = ["listen", "accept", "connect", "adopt", "release", "recheck", "stop"];
const digest = value => createHash("sha256").update(value).digest("hex");

/**
 * Query actual Windows identities, not example SIDs. A fabricated service SID
 * makes the native rejection test pass trivially and cannot certify identity
 * separation. Both commands are read-only and require no installed service.
 */
function readSid(command, args, pattern, failureCode) {
  const result = spawnSync(command, args, {
    encoding: "utf8", timeout: 10_000, windowsHide: true,
    shell: false, maxBuffer: 16 * 1024,
  });
  if (result.status !== 0 || result.error) throw Error(failureCode);
  const found = [...(result.stdout ?? "").matchAll(pattern)];
  if (found.length !== 1) throw Error(failureCode);
  return found[0][0];
}

function actualServiceSid() {
  return readSid("sc.exe", ["showsid", "CamachoPOSLocalService"],
    /\bS-1-5-80-(?:[0-9]+-){4}[0-9]+\b/g,
    "NATIVE_SERVICE_SID_UNAVAILABLE");
}

function currentTokenSid() {
  return readSid("whoami.exe", ["/user"],
    /\bS-1-(?:[0-9]+-){2,}[0-9]+\b/g,
    "NATIVE_CURRENT_TOKEN_SID_UNAVAILABLE");
}

function childMode() {
  const require = createRequire(import.meta.url);
  const binding = require(addonFile);
  const missing = required.filter(name => typeof binding[name] !== "function");
  if (missing.length) throw Error("NATIVE_API_MISSING:" + missing.join(","));
  // Deliberately invalid zero-argument operations: the addon must reject
  // before any OS operation, not create, listen or connect to a named pipe.
  for (const name of ["listen", "connect", "adopt", "release", "recheck", "stop"]) {
    let rejected = false;
    try { binding[name](); } catch { rejected = true; }
    if (!rejected) throw Error("NATIVE_INVALID_ARGUMENT_ACCEPTED:" + name);
  }
  // A real native call with syntactically valid policy: an interactive
  // process must be rejected BEFORE CreateNamedPipeW. This is not a simulated
  // security decision and must pass under both Node and Electron runtimes.
  const serviceSid = actualServiceSid();
  const tokenSid = currentTokenSid();
  if (tokenSid === serviceSid) throw Error("NATIVE_INTERACTIVE_TEST_REQUIRES_NON_SERVICE_TOKEN");
  const identityArguments = [
    "\\\\\\\\.\\\\pipe\\\\camacho-pos-018f0000-0000-7000-8000-000000000001-scm",
    serviceSid,
    "S-1-5-21-1-2-3-1001",
    "S-1-5-5-1-2",
    1,
  ];
  let unauthorizedListenRejected = false;
  try { binding.listen(...identityArguments); }
  catch (error) {
    unauthorizedListenRejected = error instanceof Error
      && error.message.includes("WINDOWS_NATIVE_PIPE_REJECTED");
  }
  if (!unauthorizedListenRejected) {
    throw Error("NATIVE_INTERACTIVE_SERVICE_IMPERSONATION_NOT_REJECTED");
  }
  process.stdout.write(JSON.stringify({
    status: "PASS",
    runtime: process.versions.electron ? "ELECTRON" : "NODE",
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    api_count: required.length,
    invalid_arguments_rejected: 6,
    interactive_service_impersonation_rejected: true,
    actual_windows_service_sid_used: true,
  }) + "\n");
}

if (process.argv.includes("--child")) {
  try { childMode(); } catch (error) {
    console.error("NATIVE_SMOKE_REJECTED", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  }
} else {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw Error("WINDOWS_X64_REQUIRED");
  }
  if (!existsSync(addonFile)) throw Error("NATIVE_ADDON_BUILD_REQUIRED");
  const checksum = digest(readFileSync(addonFile));
  const electronRequire = createRequire(join(root, "apps/pos-desktop/package.json"));
  const electronBinary = electronRequire("electron");
  if (typeof electronBinary !== "string" || !existsSync(electronBinary)) {
    throw Error("ELECTRON_BINARY_NOT_INSTALLED");
  }

  const evidenceDirectory = mkdtempSync(join(tmpdir(), "camacho-native-smoke-"));
  const results = [];
  const configurations = [
    { name: "NODE", binary: process.execPath, env: { ...process.env } },
    { name: "ELECTRON", binary: electronBinary, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  ];
  for (const config of configurations) {
    const result = spawnSync(config.binary, [fileURLToPath(import.meta.url), "--child"], {
      cwd: root, env: config.env, shell: false, encoding: "utf8",
      timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true,
    });
    const stdout = (result.stdout ?? "").trim();
    let check = null;
    try { check = JSON.parse(stdout); } catch { /* reject malformed output */ }
    const pass = result.status === 0
      && result.error === undefined
      && check?.status === "PASS"
      && check?.runtime === config.name
      && check.api_count === 7
      && check.invalid_arguments_rejected === 6
      && check.interactive_service_impersonation_rejected === true
      && check.actual_windows_service_sid_used === true;
    results.push({
      runtime: config.name,
      status: pass ? "PASS" : "FAIL",
      node: check?.node ?? null,
      electron: check?.electron ?? null,
      exit_code: result.status,
      error_code: result.error?.code ?? null,
    });
    console.log(config.name + "_NATIVE_RUNTIME=" + (pass ? "PASS" : "FAIL"));
  }

  const pass = results.every(row => row.status === "PASS");
  const receipt = {
    schema: "camacho-windows-native-runtime-smoke/v1",
    status: pass ? "PASS" : "FAIL",
    addon_sha256: checksum,
    addon_size_bytes: readFileSync(addonFile).length,
    no_service_mutation: true,
    no_pipe_creation: true,
    interactive_service_impersonation_rejected: results.every(row => row.status === "PASS"),
    real_service_sid_queried_from_windows: results.every(row => row.status === "PASS"),
    scm_interoperability_verified: false,
    interactive_login_verified: false,
    results,
  };
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  const receiptPath = join(evidenceDirectory, "receipt.json");
  writeFileSync(receiptPath, bytes, { flag: "wx", mode: 0o600 });
  writeFileSync(join(evidenceDirectory, "receipt.json.sha256"),
    digest(bytes) + "  receipt.json\n", { flag: "wx", mode: 0o600 });
  console.log("NATIVE_RUNTIME_RECEIPT=" + receiptPath);
  console.log("NATIVE_RUNTIME_SMOKE=" + receipt.status);
  if (!pass) process.exitCode = 1;
}
