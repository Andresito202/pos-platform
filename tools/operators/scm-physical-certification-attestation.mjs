#!/usr/bin/env node
/**
 * Validates an owner-supplied physical-certification attestation.
 * This NEVER enables commercial SCM, clears the release gate, or installs a service.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAMPLE_ID = /^018f0000-0000-7000-8000-0000000000a[1-5]$/i;
const PROFILE = "CAMACHO_SCM_PHYSICAL_CERTIFICATION_ATTESTATION_V1";
const PURPOSE = "PHYSICAL_CERTIFICATION_PREP";
const GATE = "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN";
const SCOPE = Object.freeze([
  "WINSW_INSTALL",
  "ACL_DPAPI_EVIDENCE",
  "NATIVE_TRANSPORT_EVIDENCE",
]);
const KEYS = Object.freeze([
  "profile",
  "purpose",
  "commercial_ready",
  "commercial_gate",
  "owner_authorization_id",
  "target_machine",
  "installation_id",
  "device_id",
  "issued_at",
  "expires_at",
  "scope",
]);

function fail(code) {
  throw new Error(code);
}

/** Pure metadata check. Does not touch Windows, WinSW, or commercial gates. */
export function validatePhysicalCertificationAttestation(attestation, expected = {}, now = new Date()) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    fail("PHYSICAL_ATTESTATION_SHAPE_REJECTED");
  }
  const keys = Object.keys(attestation).sort().join("|");
  if (keys !== [...KEYS].sort().join("|")) fail("PHYSICAL_ATTESTATION_SHAPE_REJECTED");
  if (attestation.profile !== PROFILE) fail("PHYSICAL_ATTESTATION_PROFILE_REJECTED");
  if (attestation.purpose !== PURPOSE) fail("PHYSICAL_ATTESTATION_PURPOSE_REJECTED");
  if (attestation.commercial_ready !== false) fail("PHYSICAL_ATTESTATION_COMMERCIAL_CLAIM_REJECTED");
  if (attestation.commercial_gate !== GATE) fail("PHYSICAL_ATTESTATION_GATE_REJECTED");
  if (typeof attestation.owner_authorization_id !== "string" ||
      attestation.owner_authorization_id.trim().length < 8 ||
      attestation.owner_authorization_id.length > 128) {
    fail("PHYSICAL_ATTESTATION_OWNER_ID_REJECTED");
  }
  if (typeof attestation.target_machine !== "string" ||
      attestation.target_machine.trim().length < 1 ||
      attestation.target_machine.length > 128) {
    fail("PHYSICAL_ATTESTATION_MACHINE_REJECTED");
  }
  for (const idKey of ["installation_id", "device_id"]) {
    const value = attestation[idKey];
    if (typeof value !== "string" || !UUID.test(value) || SAMPLE_ID.test(value)) {
      fail("PHYSICAL_ATTESTATION_IDENTITY_REJECTED");
    }
  }
  if (attestation.installation_id.toLowerCase() === attestation.device_id.toLowerCase()) {
    fail("PHYSICAL_ATTESTATION_IDENTITY_REJECTED");
  }
  if (expected.installationId &&
      attestation.installation_id.toLowerCase() !== String(expected.installationId).toLowerCase()) {
    fail("PHYSICAL_ATTESTATION_INSTALLATION_MISMATCH");
  }
  if (expected.deviceId &&
      attestation.device_id.toLowerCase() !== String(expected.deviceId).toLowerCase()) {
    fail("PHYSICAL_ATTESTATION_DEVICE_MISMATCH");
  }
  const from = Date.parse(attestation.issued_at);
  const until = Date.parse(attestation.expires_at);
  const current = now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from ||
      !Number.isFinite(current) || from > current || current >= until) {
    fail("PHYSICAL_ATTESTATION_WINDOW_INVALID");
  }
  if (!Array.isArray(attestation.scope) ||
      attestation.scope.length !== SCOPE.length ||
      SCOPE.some((item, index) => attestation.scope[index] !== item)) {
    fail("PHYSICAL_ATTESTATION_SCOPE_REJECTED");
  }
  return Object.freeze({
    result: "PHYSICAL_CERTIFICATION_ATTESTATION_VALID",
    commercial_ready: false,
    physical_certification: "AUTHORIZED_PREP_ONLY",
    commercial_gate: GATE,
    purpose: PURPOSE,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error("USAGE: node scm-physical-certification-attestation.mjs ATTESTATION_JSON");
    const report = validatePhysicalCertificationAttestation(JSON.parse(readFileSync(path, "utf8")));
    process.stdout.write(JSON.stringify(report) + "\n");
  } catch (error) {
    process.stderr.write("PHYSICAL_ATTESTATION_BLOCKED:" +
      (error instanceof Error ? error.message : "UNKNOWN") + "\n");
    process.exitCode = 1;
  }
}
