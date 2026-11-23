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
const SAMPLE_ID = /^018f0000-0000-7000-8000-0000000000a[1-5]$/i;
const windowsPathKey = path => win32.normalize(path).toLowerCase();
function pathOverlaps(a, b) {
  const left = windowsPathKey(a), right = windowsPathKey(b);
  return left === right || left.startsWith(right + "\\") || right.startsWith(left + "\\");
}

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
    !value.slice(2).includes(":") && !/[\x00-\x1f]/.test(value), "SCM_MANAGED_PATH_REJECTED");
  const pathSegments = value.toLowerCase().split(/[\\/]/);
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
      !SAMPLE_ID.test(h.installation_id) && !SAMPLE_ID.test(h.device_id) &&
      h.installation_id.toLowerCase() !== h.device_id.toLowerCase() &&
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
  requireCondition(!pathOverlaps(win32.dirname(service.signer_private_file),
    win32.dirname(desktop.receiver_file)), "SCM_PRIVATE_CUSTODY_NOT_SEPARATED");
  requireCondition(!pathOverlaps(service.signer_private_file, desktop.receiver_file) &&
    !pathOverlaps(service.signer_private_file, service.handoff.capsule_file) &&
    !pathOverlaps(desktop.receiver_file, desktop.handoff.capsule_file),
    "SCM_PRIVATE_PATH_COLLISION");
  requireCondition(windowsPathKey(service.adapter_file) === windowsPathKey(desktop.adapter_file) &&
    service.adapter_sha256 === desktop.adapter_sha256,
    "SCM_CROSS_ROLE_ADAPTER_MISMATCH");
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

const centralKeys = [
  "origin", "root_public_key_pem", "root_spki_sha256", "candidate_file", "policy",
];
const signedPolicyKeys = ["policy", "signature"];
const policyKeys = [
  "profile", "service_id", "installation_id", "device_id", "not_before", "expires_at",
  "policy_id", "trust_revision", "policy_revision", "authority_spki_sha256", "action",
  "candidate_sha256", "previous_candidate_sha256", "policy_reference",
];

/** Metadata checks for the SERVICE Central provision. Does not enable commercial SCM. */
export function validateScmCentralProvision(central, service, now = new Date(), shaOfCandidate = hashCandidate) {
  exactKeys(central, centralKeys, "SCM_CENTRAL_PROVISION_SHAPE_REJECTED");
  requireCondition(typeof central.origin === "string", "SCM_CENTRAL_ORIGIN_REJECTED");
  let origin;
  try { origin = new URL(central.origin); } catch { throw new Error("SCM_CENTRAL_ORIGIN_REJECTED"); }
  requireCondition(origin.protocol === "https:" && origin.origin === central.origin &&
    !origin.username && !origin.password, "SCM_CENTRAL_ORIGIN_REJECTED");
  requireCondition(typeof central.root_public_key_pem === "string" &&
    central.root_public_key_pem.trim().startsWith("-----BEGIN PUBLIC KEY-----") &&
    !central.root_public_key_pem.includes("PRIVATE KEY"), "SCM_PUBLIC_ROOT_REQUIRED");
  pinnedKey(central.root_public_key_pem, central.root_spki_sha256, "ed25519");
  managedPath(central.candidate_file);
  exactKeys(central.policy, signedPolicyKeys, "SCM_CENTRAL_POLICY_SHAPE_REJECTED");
  exactKeys(central.policy.policy, policyKeys, "SCM_CENTRAL_POLICY_SHAPE_REJECTED");
  const policy = central.policy.policy;
  requireCondition(policy.profile === "CAMACHO_SCM_PROVISION_POLICY_V1" &&
    policy.service_id === "CamachoPOSLocalService" &&
    policy.action === "RECOVER_CANDIDATE" &&
    UUID.test(policy.installation_id ?? "") && UUID.test(policy.device_id ?? "") &&
    !SAMPLE_ID.test(policy.installation_id) && !SAMPLE_ID.test(policy.device_id) &&
    HEX64.test(policy.authority_spki_sha256 ?? "") &&
    policy.authority_spki_sha256 === central.root_spki_sha256 &&
    HEX64.test(policy.candidate_sha256 ?? "") &&
    policy.previous_candidate_sha256 === null &&
    typeof central.policy.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(central.policy.signature), "SCM_CENTRAL_POLICY_REJECTED");
  const from = Date.parse(policy.not_before), until = Date.parse(policy.expires_at), current = now.getTime();
  requireCondition(Number.isFinite(from) && Number.isFinite(until) && until > from &&
    Number.isFinite(current) && from <= current && current < until, "SCM_CENTRAL_POLICY_WINDOW_INVALID");
  // Candidate digest must match the managed file. Full Ed25519 policy crypto
  // remains enforced by SERVICE at runtime; this tool never enables commercial SCM.
  requireCondition(shaOfCandidate(central.candidate_file) === policy.candidate_sha256, "SCM_CANDIDATE_REJECTED");
  if (service !== undefined) {
    requireCondition(service?.role === "SERVICE" && service.handoff,
      "SCM_CENTRAL_SERVICE_BINDING_REQUIRED");
    requireCondition(policy.installation_id === service.handoff.installation_id &&
      policy.device_id === service.handoff.device_id &&
      policy.policy_revision === service.handoff.revision &&
      policy.policy_reference === service.handoff.policy_reference &&
      central.root_spki_sha256 !== service.signer_spki_sha256,
      "SCM_CENTRAL_SERVICE_BINDING_REJECTED");
    requireCondition(!pathOverlaps(central.candidate_file, service.signer_private_file) &&
      !pathOverlaps(central.candidate_file, service.handoff.capsule_file),
      "SCM_CENTRAL_CANDIDATE_PATH_COLLISION");
  }
  return Object.freeze({
    result: "SCM_CENTRAL_PROVISION_METADATA_VALID",
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
function hashCandidate(file) {
  const info = statSync(file);
  requireCondition(info.isFile() && info.size > 0 && info.size <= 65536, "SCM_CANDIDATE_REJECTED");
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    requireCondition(process.platform === "win32" && (process.argv.length === 4 || process.argv.length === 5),
      "USAGE: Windows node scm-provision-preflight.mjs SERVICE_JSON DESKTOP_JSON [CENTRAL_JSON]");
    const service = readJson(process.argv[2]);
    const report = {
      ...validateScmProvisionPair(service, readJson(process.argv[3]), hashAdapter),
    };
    if (process.argv.length === 5) {
      Object.assign(report, validateScmCentralProvision(readJson(process.argv[4]), service, new Date(), hashCandidate));
      report.result = "SCM_PROVISION_AND_CENTRAL_METADATA_VALID";
    }
    process.stdout.write(JSON.stringify(report) + "\n");
  } catch (error) {
    process.stderr.write("SCM_PREFLIGHT_BLOCKED:" + (error instanceof Error ? error.message : "UNKNOWN") + "\n");
    process.exitCode = 1;
  }
}
