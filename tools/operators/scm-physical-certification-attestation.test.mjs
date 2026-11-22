import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePhysicalCertificationAttestation } from "./scm-physical-certification-attestation.mjs";

const now = new Date("2026-11-22T23:00:00.000Z");
const base = () => ({
  profile: "CAMACHO_SCM_PHYSICAL_CERTIFICATION_ATTESTATION_V1",
  purpose: "PHYSICAL_CERTIFICATION_PREP",
  commercial_ready: false,
  commercial_gate: "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
  owner_authorization_id: "owner-auth-20261122",
  target_machine: "CAJA-01",
  installation_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  device_id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  issued_at: "2026-11-22T12:00:00.000Z",
  expires_at: "2026-11-23T12:00:00.000Z",
  scope: ["WINSW_INSTALL", "ACL_DPAPI_EVIDENCE", "NATIVE_TRANSPORT_EVIDENCE"],
});

test("accepts a strict owner attestation without enabling commercial SCM", () => {
  const report = validatePhysicalCertificationAttestation(base(), {
    installationId: base().installation_id,
    deviceId: base().device_id,
  }, now);
  assert.equal(report.result, "PHYSICAL_CERTIFICATION_ATTESTATION_VALID");
  assert.equal(report.commercial_ready, false);
  assert.equal(report.commercial_gate, "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
  assert.equal(report.physical_certification, "AUTHORIZED_PREP_ONLY");
});

test("rejects commercial enable claims and sample identities", () => {
  assert.throws(() => validatePhysicalCertificationAttestation({
    ...base(), commercial_ready: true,
  }, {}, now), /PHYSICAL_ATTESTATION_COMMERCIAL_CLAIM_REJECTED/);
  assert.throws(() => validatePhysicalCertificationAttestation({
    ...base(), purpose: "COMMERCIAL_ENABLE",
  }, {}, now), /PHYSICAL_ATTESTATION_PURPOSE_REJECTED/);
  assert.throws(() => validatePhysicalCertificationAttestation({
    ...base(),
    installation_id: "018f0000-0000-7000-8000-0000000000a1",
  }, {}, now), /PHYSICAL_ATTESTATION_IDENTITY_REJECTED/);
});

test("rejects mismatched helper identities and wrong scope", () => {
  assert.throws(() => validatePhysicalCertificationAttestation(base(), {
    installationId: "11111111-1111-1111-1111-111111111111",
  }, now), /PHYSICAL_ATTESTATION_INSTALLATION_MISMATCH/);
  assert.throws(() => validatePhysicalCertificationAttestation({
    ...base(), scope: ["WINSW_INSTALL"],
  }, {}, now), /PHYSICAL_ATTESTATION_SCOPE_REJECTED/);
});
