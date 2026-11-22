#!/usr/bin/env node
/**
 * Read-only candidate SCM provision preflight. This is NOT commercial
 * certification and must never be used as an enable flag for the release gate.
 * Private keys and DPAPI receiver contents are neither opened nor printed.
 */
import { createHash, createPublicKey } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFileSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";

const HEX64 = /^[a-f0-9]{64}$/;
const SID_SERVICE = /^S-1-5-80-(?:[0-9]+-){4}[0-9]+$/;
const SID_USER = /^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/;
const SID_LOGON = /^S-1-5-5-[0-9]+-[0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireCondition(ok, code) {
  if (!ok) throw new Error(code);
}
function pinnedKey(pem, expected, algorithm) {
  requireCondition(typeof pem === "string" && HEX64.test(expected ?? ""), "SCM_KEY_PIN_INVALID");
  let key;
  try { key = createPublicKey(pem); } catch { throw new Error("SCM_PUBLIC_KEY_INVALID"); }
  requireCondition(key.asymmetricKeyType === algorithm, "SCM_KEY_ALGORITHM_REJECTED");
  if (algorithm === "rsa") {
    requireCondition((key.asymmetricKeyDetails?.modulusLength ?? 0) >= 3072 &&
      key.asymmetricKeyDetails?.publicExponent === 65537n, "SCM_RECEIVER_KEY_TOO_WEAK");
  }
  const digest = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
  requireCondition(digest === expected, "SCM_KEY_PIN_MISMATCH");
}
function managedPath(value) {
  requireCondition(typeof value === "string" && /^[a-z]:\\/i.test(value) &&
    win32.isAbsolute(value) && win32.normalize(value) === value &&
    !value.slice(2).includes(":"), "SCM_MANAGED_PATH_REJECTED");
  const pathSegments = value.toLowerCase().split("\\");
  requireCondition(!pathSegments.some(s => [".lab-state", "lab-data", "camachoposcmlab", "design-review-runtime", "preprod"].includes(s)),
    "SCM_NONCOMMERCIAL_PATH_REJECTED");
}
const profileKeys = [
  "profile", "service_id", "service_sid", "installation_id", "device_id",
  "recipient_sid", "recipient_logon_sid", "recipient_session_id",
  "recipient_public_key_pem", "recipient_key_sha256", "capsule_file",
  "not_before", "expires_at", "revision", "poll_ms", "policy_reference",
];
const provisionKeys = [
  "version", "role", "handoff", "adapter_file", "adapter_sha256",
  "signer_public_key_pem", "signer_spki_sha256",
];
function exactKeys(object, keys, code) {
  requireCondition(object && typeof object === "object" && !Array.isArray(object) &&
    Object.keys(object).sort().join("|") === keys.slice().sort().join("|"), code);
}

/** Metadata checks only. The actual Windows native reader validates custody. */
export function validateScmProvisionPair(service, desktop, shaOfAdapter, now = new Date()) {
  for (const [p, role, privateKey] of [
    [service, "SERVICE", "signer_private_file"],
    [desktop, "DESKTOP", "receiver_file"],
  ]) {
    exactKeys(p, [...provisionKeys, privateKey], "SCM_PROVISION_SHAPE_REJECTED");
    requireCondition(p.version === 1 && p.role === role, "SCM_PROVISION_ROLE_MISMATCH");
    exactKeys(p.handoff, profileKeys, "SCM_HANDOFF_SHAPE_REJECTED");
    const h = p.handoff;
    requireCondition(h.profile === "CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1" &&
      h.service_id === "CamachoPOSLocalService" &&
      SID_SERVICE.test(h.service_sid ?? "") && SID_USER.test(h.recipient_sid ?? "") &&
      SID_LOGON.test(h.recipient_logon_sid ?? "") &&
      Number.isSafeInteger(h.recipient_session_id) && h.recipient_session_id > 0 &&
      UUID.test(h.installation_id ?? "") && UUID.test(h.device_id ?? "") &&
      Number.isSafeInteger(h.revision) && h.revision > 0 &&
      Number.isSafeInteger(h.poll_ms) && h.poll_ms >= 100 && h.poll_ms <= 60000 &&
      typeof h.policy_reference === "string" && h.policy_reference.length > 0 &&
      h.policy_reference.length <= 256, "SCM_HANDOFF_IDENTITY_INVALID");
    const from = Date.parse(h.not_before), until = Date.parse(h.expires_at), current = now.getTime();
    requireCondition(Number.isFinite(from) && Number.isFinite(until) && until > from &&
      Number.isFinite(current) && from <= current && current < until, "SCM_HANDOFF_WINDOW_INVALID");
    for (const path of [p.adapter_file, p[privateKey], h.capsule_file]) managedPath(path);
    requireCondition(HEX64.test(p.adapter_sha256 ?? "") &&
      shaOfAdapter(p.adapter_file) === p.adapter_sha256, "SCM_NATIVE_ADAPTER_HASH_REJECTED");
    pinnedKey(p.signer_public_key_pem, p.signer_spki_sha256, "ed25519");
    pinnedKey(h.recipient_public_key_pem, h.recipient_key_sha256, "rsa");
  }
  requireCondition(win32.dirname(service.signer_private_file).toLowerCase() !==
    win32.dirname(desktop.receiver_file).toLowerCase(), "SCM_PRIVATE_CUSTODY_NOT_SEPARATED");
  requireCondition(isDeepStrictEqual(service.handoff, desktop.handoff) &&
    service.signer_public_key_pem === desktop.signer_public_key_pem &&
    service.signer_spki_sha256 === desktop.signer_spki_sha256,
    "SCM_CROSS_ROLE_BINDING_MISMATCH");
  return Object.freeze({
    result: "SCM_PROVISION_METADATA_VALID",
    commercial_ready: false,
    physical_certification: "REQUIRED",
    commercial_gate: "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
  });
}

function readJson(file) {
  managedPath(file);
  return JSON.parse(readFileSync(file, "utf8"));
}
function hashAdapter(file) {
  const info = statSync(file);
  requireCondition(info.isFile(), "SCM_ADAPTER_NOT_A_FILE");
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    requireCondition(process.platform === "win32" && process.argv.length === 4,
      "USAGE: Windows node scm-provision-preflight.mjs SERVICE_JSON DESKTOP_JSON");
    const report = validateScmProvisionPair(
      readJson(process.argv[2]), readJson(process.argv[3]), hashAdapter,
    );
    process.stdout.write(JSON.stringify(report) + "\n");
  } catch (error) {
    process.stderr.write("SCM_PREFLIGHT_BLOCKED:" + (error instanceof Error ? error.message : "UNKNOWN") + "\n");
    process.exitCode = 1;
  }
}
