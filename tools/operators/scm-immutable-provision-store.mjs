/**
 * Installer-owned, create-once candidate provisioning record.
 *
 * A record is NOT runtime authority. Never stores private keys and never
 * enables SCM/NSIS. Windows custody is enforced by the companion native
 * writer; missing/unsafe storage fails closed rather than silently resetting
 * a generation counter.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { validateScmProvisionPair } from "./scm-provision-preflight.mjs";

const MAX_BYTES = 65536;
const here = dirname(fileURLToPath(import.meta.url));
const writer = join(here, "write-scm-candidate-once.ps1");
const pinnedJson = value => JSON.stringify(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const refuse = message => { throw Error(message); };

function safeRoot(root) {
  if (typeof root !== "string" || !/^[a-z]:\\/i.test(root) ||
      !win32.isAbsolute(root) || win32.normalize(root) !== root ||
      root.slice(2).includes(":") ||
      root.split("\\").some(part => [".lab-state", "lab-data", "preprod",
        "camachoposcmlab", "design-review-runtime"].includes(part.toLowerCase()))) {
    refuse("SCM_STORE_PATH_REJECTED");
  }
}

function validatePair(pair, hashOfAdapter, now) {
  if (!pair || typeof pair !== "object" ||
      Object.keys(pair).sort().join("|") !== "desktop|service" ||
      typeof hashOfAdapter !== "function") refuse("SCM_STORE_PAIR_INVALID");
  const v = validateScmProvisionPair(pair.service, pair.desktop, hashOfAdapter, now);
  if (v.commercial_ready !== false) refuse("SCM_STORE_RELEASE_AUTHORITY_REJECTED");
}

/** Deterministic bytes from an already validated public-only pair. */
export function serializeScmCandidate(pair, hashOfAdapter, now = new Date()) {
  validatePair(pair, hashOfAdapter, now);
  const payload = pinnedJson({
    version: 1,
    status: "CANDIDATE_NOT_AUTHORIZED",
    revision: pair.service.handoff.revision,
    installation_id: pair.service.handoff.installation_id,
    device_id: pair.service.handoff.device_id,
    service: pair.service,
    desktop: pair.desktop,
  });
  if (Buffer.byteLength(payload) > MAX_BYTES) refuse("SCM_STORE_RECORD_TOO_LARGE");
  return Object.freeze({ payload, sha256: sha(payload),
    revision: pair.service.handoff.revision });
}

/**
 * Only first enrollment is accepted. Higher revisions require a separately
 * authorized, audited rotation protocol, never a replace or in-place edit.
 */
export function assertInitialScmCandidateState(existingRecord) {
  if (existingRecord !== null) refuse("SCM_STORE_ALREADY_PROVISIONED");
}

/**
 * Explicit Windows operator action, never called by Electron or SCM boot.
 * The root must already be created and ACL-protected by a trusted installer.
 * There is no return flag that could enable commercial service operation.
 */
export function persistInitialScmCandidate({
  pair, root, hashOfAdapter, now = new Date(),
  platform = process.platform, invoke = spawnSync,
}) {
  if (platform !== "win32") refuse("SCM_STORE_WINDOWS_REQUIRED");
  safeRoot(root);
  const candidate = serializeScmCandidate(pair, hashOfAdapter, now);
  const file = win32.join(root, "candidate-pair.json");
  // Never treat a missing directory or an existing record as a fresh setup.
  if (!existsSync(root) || !statSync(root).isDirectory()) refuse("SCM_STORE_ROOT_NOT_PROVISIONED");
  if (existsSync(file)) refuse("SCM_STORE_ALREADY_PROVISIONED");
  const request = pinnedJson({ root, file, payload: candidate.payload, sha256: candidate.sha256 });
  const result = invoke("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-File", writer],
    { input: request, encoding: "utf8", windowsHide: true, timeout: 15000,
      maxBuffer: 4096 });
  if (result.error || result.status !== 0 || result.stdout?.trim() !== "SCM_CANDIDATE_STORED") {
    refuse("SCM_STORE_NATIVE_WRITE_REJECTED");
  }
  return Object.freeze({ status: "CANDIDATE_STORED_NOT_AUTHORIZED",
    sha256: candidate.sha256, revision: candidate.revision, commercial_ready: false });
}

/** Read metadata only: not a substitute for native managed-file ACL checks. */
export function inspectScmCandidateBytes(bytes, hashOfAdapter, now = new Date()) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES) {
    refuse("SCM_STORE_RECORD_SIZE_INVALID");
  }
  const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!input || Object.keys(input).sort().join("|") !==
      "desktop|device_id|installation_id|revision|service|status|version") {
    refuse("SCM_STORE_RECORD_SHAPE_INVALID");
  }
  if (input.version !== 1 || input.status !== "CANDIDATE_NOT_AUTHORIZED") {
    refuse("SCM_STORE_RECORD_STATUS_REJECTED");
  }
  const candidate = serializeScmCandidate(
    { service: input.service, desktop: input.desktop }, hashOfAdapter, now);
  if (input.revision !== candidate.revision ||
      input.installation_id !== input.service.handoff.installation_id ||
      input.device_id !== input.service.handoff.device_id ||
      sha(candidate.payload) !== sha(bytes)) {
    refuse("SCM_STORE_RECORD_TAMPERED");
  }
  return Object.freeze({ sha256: candidate.sha256, revision: candidate.revision,
    commercial_ready: false });
}
