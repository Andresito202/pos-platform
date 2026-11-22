/**
 * Read-only composition of PUBLIC enrollment receipts from the existing
 * protected Windows Service/interactive-user enrollment functions.
 *
 * This module does not generate private keys, write provisioning files,
 * grant ACLs or authorize the SCM runtime. Its output is a candidate input
 * to the independently validated provisioning/custody workflow.
 */
import { createHash, createPublicKey } from "node:crypto";
import { validateScmProvisionPair } from "./scm-provision-preflight.mjs";

const hashPublicKey = (pem, algorithm) => {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== algorithm) throw Error("SCM_ENROLLMENT_KEY_TYPE_REJECTED");
  if (algorithm === "rsa" &&
      ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072 ||
       key.asymmetricKeyDetails?.publicExponent !== 65537n)) {
    throw Error("SCM_ENROLLMENT_RECEIVER_KEY_REJECTED");
  }
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
};

function demand(ok, code) {
  if (!ok) throw Error(code);
}
const exact = (v, fields) => v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).sort().join("|") === fields.slice().sort().join("|");

/**
 * serviceReceipt: public result of recoverWindowsServiceSignerPublic().
 * desktopReceipt: public result of recoverWindowsHandoffReceiverPublic().
 * approved: operator-managed metadata, NOT an authority/permission grant.
 * shaOfAdapter: privileged actual-file hash callback (never a supplied hash).
 */
export function assembleScmPublicEnrollmentPair(
  { serviceReceipt, desktopReceipt, approved, shaOfAdapter, now = new Date() },
) {
  demand(exact(serviceReceipt, ["public_key_pem", "spki_sha256", "service_sid"]),
    "SCM_SERVICE_RECEIPT_INVALID");
  demand(exact(desktopReceipt, [
    "installation_id", "device_id", "recipient_sid", "recipient_logon_sid",
    "recipient_session_id", "recipient_public_key_pem", "recipient_key_sha256",
  ]), "SCM_DESKTOP_RECEIPT_INVALID");
  demand(exact(approved, [
    "installation_id", "device_id", "service_sid", "service_private_file",
    "receiver_file", "adapter_file", "adapter_sha256", "capsule_file",
    "not_before", "expires_at", "revision", "poll_ms", "policy_reference",
  ]), "SCM_APPROVED_METADATA_INVALID");
  demand(typeof shaOfAdapter === "function", "SCM_ADAPTER_HASH_READER_REQUIRED");
  demand(serviceReceipt.service_sid === approved.service_sid &&
    desktopReceipt.installation_id === approved.installation_id &&
    desktopReceipt.device_id === approved.device_id,
  "SCM_RECEIPT_BINDING_MISMATCH");
  demand(hashPublicKey(serviceReceipt.public_key_pem, "ed25519") === serviceReceipt.spki_sha256,
    "SCM_SERVICE_RECEIPT_PIN_REJECTED");
  demand(hashPublicKey(desktopReceipt.recipient_public_key_pem, "rsa") === desktopReceipt.recipient_key_sha256,
    "SCM_DESKTOP_RECEIPT_PIN_REJECTED");

  const handoff = {
    profile: "CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",
    service_id: "CamachoPOSLocalService",
    service_sid: approved.service_sid,
    installation_id: approved.installation_id,
    device_id: approved.device_id,
    recipient_sid: desktopReceipt.recipient_sid,
    recipient_logon_sid: desktopReceipt.recipient_logon_sid,
    recipient_session_id: desktopReceipt.recipient_session_id,
    recipient_public_key_pem: desktopReceipt.recipient_public_key_pem,
    recipient_key_sha256: desktopReceipt.recipient_key_sha256,
    capsule_file: approved.capsule_file,
    not_before: approved.not_before,
    expires_at: approved.expires_at,
    revision: approved.revision,
    poll_ms: approved.poll_ms,
    policy_reference: approved.policy_reference,
  };
  const common = {
    version: 1,
    handoff,
    adapter_file: approved.adapter_file,
    adapter_sha256: approved.adapter_sha256,
    signer_public_key_pem: serviceReceipt.public_key_pem,
    signer_spki_sha256: serviceReceipt.spki_sha256,
  };
  const service = { ...common, role: "SERVICE", signer_private_file: approved.service_private_file };
  const desktop = { ...common, role: "DESKTOP", receiver_file: approved.receiver_file };
  // Assert the same independently pinned constraints used by the operational
  // read-only verifier. Never convert a valid pair into release authority.
  const assessment = validateScmProvisionPair(service, desktop, shaOfAdapter, now);
  demand(assessment.commercial_ready === false, "SCM_RELEASE_AUTHORITY_NOT_ALLOWED");
  return Object.freeze({ service: Object.freeze(service), desktop: Object.freeze(desktop),
    assessment });
}
