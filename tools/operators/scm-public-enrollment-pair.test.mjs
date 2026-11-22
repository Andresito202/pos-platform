import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { assembleScmPublicEnrollmentPair } from "./scm-public-enrollment-pair.mjs";

const signer = generateKeyPairSync("ed25519").publicKey;
const receiver = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 65537 }).publicKey;
const pem = key => key.export({ format: "pem", type: "spki" }).toString();
const pin = key => createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
const adapterHash = createHash("sha256").update("adapter-content").digest("hex");
const now = new Date("2026-11-22T20:00:00.000Z");

function inputs() {
  return {
    serviceReceipt: {
      public_key_pem: pem(signer), spki_sha256: pin(signer), service_sid: "S-1-5-80-1-2-3-4-5",
    },
    desktopReceipt: {
      installation_id: "ca77e6bb-f04c-4c4a-aa52-91349beb13a2",
      device_id: "ee2ddffe-f141-412a-b3f9-5bc24956444c",
      recipient_sid: "S-1-5-21-1-2-3-1001",
      recipient_logon_sid: "S-1-5-5-10-20",
      recipient_session_id: 2,
      recipient_public_key_pem: pem(receiver),
      recipient_key_sha256: pin(receiver),
    },
    approved: {
      installation_id: "ca77e6bb-f04c-4c4a-aa52-91349beb13a2",
      device_id: "ee2ddffe-f141-412a-b3f9-5bc24956444c",
      service_sid: "S-1-5-80-1-2-3-4-5",
      service_private_file: String.raw`C:\ProgramData\CamachoPOS\service\private\signer.json`,
      receiver_file: String.raw`C:\ProgramData\CamachoPOS\desktop\private\receiver.json`,
      adapter_file: String.raw`C:\ProgramData\CamachoPOS\native\camacho_windows_pipe.node`,
      adapter_sha256: adapterHash,
      capsule_file: String.raw`C:\ProgramData\CamachoPOS\capsules\handoff.json`,
      not_before: "2026-11-22T19:00:00.000Z",
      expires_at: "2026-11-22T21:00:00.000Z",
      revision: 1, poll_ms: 1000, policy_reference: "operator-enrollment-approval",
    },
    shaOfAdapter: () => adapterHash,
    now,
  };
}
const run = (mutate = () => {}) => {
  const values = inputs();
  mutate(values);
  return assembleScmPublicEnrollmentPair(values);
};

describe("public enrollment pair boundary", () => {
  it("assembles existing receipts and explicitly preserves release denial", () => {
    const result = run();
    assert.equal(result.service.role, "SERVICE");
    assert.equal(result.desktop.role, "DESKTOP");
    assert.deepEqual(result.service.handoff, result.desktop.handoff);
    assert.equal(result.assessment.commercial_ready, false);
    assert.equal(result.assessment.commercial_gate, "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
    assert.equal(Object.hasOwn(result.service, "receiver_file"), false);
    assert.equal(Object.hasOwn(result.desktop, "signer_private_file"), false);
  });
  it("rejects substituted public receipts and mismatched identifiers", () => {
    assert.throws(() => run(v => { v.serviceReceipt.service_sid = "S-1-5-80-5-4-3-2-1"; }),
      /SCM_RECEIPT_BINDING_MISMATCH/);
    assert.throws(() => run(v => { v.desktopReceipt.device_id = "90d3c7b9-c500-427b-9396-f23674fb82f3"; }),
      /SCM_RECEIPT_BINDING_MISMATCH/);
    assert.throws(() => run(v => { v.serviceReceipt.spki_sha256 = "0".repeat(64); }),
      /SCM_SERVICE_RECEIPT_PIN_REJECTED/);
    assert.throws(() => run(v => { v.desktopReceipt.recipient_key_sha256 = "0".repeat(64); }),
      /SCM_DESKTOP_RECEIPT_PIN_REJECTED/);
  });
  it("rejects sample identities, custody overlap, mismatched adapter and invalid window", () => {
    assert.throws(() => run(v => { v.approved.installation_id = v.desktopReceipt.installation_id =
      "018f0000-0000-7000-8000-0000000000a1"; }), /SCM_HANDOFF_IDENTITY_INVALID/);
    assert.throws(() => run(v => { v.approved.receiver_file =
      String.raw`C:\ProgramData\CamachoPOS\service\private\desktop\receiver.json`; }),
    /SCM_PRIVATE_CUSTODY_NOT_SEPARATED/);
    assert.throws(() => run(v => { v.shaOfAdapter = () => "0".repeat(64); }),
      /SCM_NATIVE_ADAPTER_HASH_REJECTED/);
    assert.throws(() => run(v => { v.approved.expires_at = "2026-11-21T00:00:00.000Z"; }),
      /SCM_HANDOFF_WINDOW_INVALID/);
  });
  it("rejects unknown receipt fields or unapproved metadata and never writes private keys", () => {
    assert.throws(() => run(v => { v.desktopReceipt.private_key = "EXFIL"; }),
      /SCM_DESKTOP_RECEIPT_INVALID/);
    assert.throws(() => run(v => { v.approved.commercial_ready = true; }),
      /SCM_APPROVED_METADATA_INVALID/);
    assert.throws(() => run(v => { v.shaOfAdapter = adapterHash; }),
      /SCM_ADAPTER_HASH_READER_REQUIRED/);
  });
});
