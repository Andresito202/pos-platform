import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { validateScmProvisionPair } from "./scm-provision-preflight.mjs";

const { publicKey: signer } = generateKeyPairSync("ed25519");
const { publicKey: recipient } = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 65537 });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pem = key => key.export({ type: "spki", format: "pem" }).toString();
const pin = key => sha(key.export({ type: "spki", format: "der" }));
const adapter = String.raw`C:\ProgramData\CamachoPOS\native\camacho_windows_pipe.node`;
const privateSigner = String.raw`C:\ProgramData\CamachoPOS\private\signer.json`;
const privateReceiver = String.raw`C:\ProgramData\CamachoPOS\private\receiver.json`;
const now = new Date("2026-11-22T16:00:00.000Z");
const fingerprint = sha(Buffer.from("native-adapter-fixture"));

function pair() {
  const handoff = {
    profile: "CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",
    service_id: "CamachoPOSLocalService",
    service_sid: "S-1-5-80-1-2-3-4-5",
    installation_id: "018f0000-0000-7000-8000-0000000000a1",
    device_id: "018f0000-0000-7000-8000-0000000000a2",
    recipient_sid: "S-1-5-21-1-2-3-1001",
    recipient_logon_sid: "S-1-5-5-1-2",
    recipient_session_id: 1,
    recipient_public_key_pem: pem(recipient),
    recipient_key_sha256: pin(recipient),
    capsule_file: String.raw`C:\ProgramData\CamachoPOS\private\capsule.json`,
    not_before: "2026-11-22T00:00:00.000Z",
    expires_at: "2026-11-23T00:00:00.000Z",
    revision: 1,
    poll_ms: 1000,
    policy_reference: "approved-policy",
  };
  const common = {
    version: 1,
    adapter_file: adapter,
    adapter_sha256: fingerprint,
    signer_public_key_pem: pem(signer),
    signer_spki_sha256: pin(signer),
  };
  return [
    { ...common, role: "SERVICE", signer_private_file: privateSigner, handoff: structuredClone(handoff) },
    { ...common, role: "DESKTOP", receiver_file: privateReceiver, handoff: structuredClone(handoff) },
  ];
}
const adapterHash = () => fingerprint;
const validate = (s, d, shaOfAdapter = adapterHash) =>
  validateScmProvisionPair(s, d, shaOfAdapter, now);

describe("SCM operator preflight (no native invocation, no commercial enablement)", () => {
  it("validates both public pins and explicitly refuses to claim certification", () => {
    const [s, d] = pair();
    assert.deepEqual(validate(s, d), {
      result: "SCM_PROVISION_METADATA_VALID",
      commercial_ready: false,
      physical_certification: "REQUIRED",
      commercial_gate: "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
    });
  });
  it("rejects a role mismatch or unexpected provision fields", () => {
    const [s, d] = pair();
    d.role = "SERVICE";
    assert.throws(() => validate(s, d), /SCM_PROVISION_ROLE_MISMATCH/);
    d.role = "DESKTOP";
    d.extra = "unsafe";
    assert.throws(() => validate(s, d), /SCM_PROVISION_SHAPE_REJECTED/);
  });
  it("rejects a forged service signer pin", () => {
    const [s, d] = pair();
    d.signer_spki_sha256 = "0".repeat(64);
    assert.throws(() => validate(s, d), /SCM_KEY_PIN_MISMATCH/);
  });
  it("rejects changed recipient binding between roles", () => {
    const [s, d] = pair();
    d.handoff.recipient_session_id = 2;
    assert.throws(() => validate(s, d), /SCM_CROSS_ROLE_BINDING_MISMATCH/);
  });
  it("rejects stale or future handoff windows", () => {
    const [s, d] = pair();
    s.handoff.expires_at = d.handoff.expires_at = "2026-11-21T00:00:00.000Z";
    assert.throws(() => validate(s, d), /SCM_HANDOFF_WINDOW_INVALID/);
  });
  it("rejects mismatched adapter hash", () => {
    const [s, d] = pair();
    assert.throws(() => validate(s, d, () => "0".repeat(64)), /SCM_NATIVE_ADAPTER_HASH_REJECTED/);
  });
  it("rejects lab-state and lab-data paths", () => {
    const [s, d] = pair();
    s.signer_private_file = String.raw`C:\CamachoPosScmLab\.lab-state\signer.json`;
    assert.throws(() => validate(s, d), /SCM_NONCOMMERCIAL_PATH_REJECTED/);
    s.signer_private_file = privateSigner;
    d.receiver_file = String.raw`C:\ProgramData\CamachoPOS\lab-data\receiver.json`;
    assert.throws(() => validate(s, d), /SCM_NONCOMMERCIAL_PATH_REJECTED/);
  });
  it("never reads or creates any private key file", () => {
    const [s, d] = pair();
    // No private files exist at these Windows paths on the CI Linux runner.
    assert.equal(validate(s, d).commercial_ready, false);
  });
});
