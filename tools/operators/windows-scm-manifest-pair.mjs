#!/usr/bin/env node
/**
 * Lab-only paired SCM manifests from REAL public enrollments.
 *
 * No identity or key generation. The RSA receiver and Ed25519 signer must
 * already have been enrolled by the actual interactive/SCM identities.
 * The installer must later apply protected installer-owned Windows ACLs to
 * both outputs; this writer never claims ACL or SCM certification.
 *
 * The only output with private material is a FILE PATH: no key plaintext is
 * read by this script. Fails closed on any existing output.
 */
import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, normalize, resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const fail = (code) => { throw new Error(code); };
const sha = (data) => createHash("sha256").update(data).digest("hex");
const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const sid = (v) => typeof v === "string" && /^S-1-5-21-(?:\d+-){3}\d+$/.test(v);
const logon = (v) => typeof v === "string" && /^S-1-5-5-\d+-\d+$/.test(v);
const serviceSid = (v) => typeof v === "string" && /^S-1-5-80-(?:\d+-){4}\d+$/.test(v);
const absoluteWindows = (p) => typeof p === "string" && /^[a-z]:\\/i.test(p) && isAbsolute(p) && normalize(p) === p && !p.slice(2).includes(":");
const within = (path, base) => {
  const diff = relative(base, path);
  return diff.length > 0 && !diff.startsWith("..") && !isAbsolute(diff);
};
const parse = (file) => {
  if (!absoluteWindows(file) || !existsSync(file) || statSync(file).size > 8192) fail("PUBLIC_ENROLLMENT_MISSING_OR_INVALID");
  return JSON.parse(readFileSync(file, "utf8"));
};
/** Called only after main's binding/key validation. A pair cannot be published
 * atomically as two independent files. Preserve partial output for review;
 * never unlink evidence or overwrite a manifest produced concurrently. */
export function writeManifestPair(desktopOutput, serviceOutput, desktop, service) {
  let createdDesktop = false;
  try {
    writeFileSync(desktopOutput, JSON.stringify(desktop, null, 2) + "\n", { flag: "wx" });
    createdDesktop = true;
    writeFileSync(serviceOutput, JSON.stringify(service, null, 2) + "\n", { flag: "wx" });
  } catch (err) {
    throw new Error(createdDesktop
      ? "PAIRED_MANIFEST_PARTIAL_OUTPUT_PRESERVED_REQUIRES_REVIEW"
      : "PAIRED_MANIFEST_OUTPUT_EXISTS_OR_WRITE_FAILED", { cause: err });
  }
}
function main() {
  if (process.platform !== "win32") fail("WINDOWS_REQUIRED");
  const args = process.argv.slice(2);
  if (args.length !== 5) fail("USAGE: node tools/operators/windows-scm-manifest-pair.mjs <lab root> <receiver public> <signer public> <installation uuid> <device uuid>");
  const [lab, receiverPath, signerPath, installationId, deviceId] = args;
  if (!absoluteWindows(lab) || !/^C:\\CamachoPosScmLab\\[0-9a-f]{32}$/i.test(lab) || !uuid(installationId) || !uuid(deviceId)) fail("LAB_BINDING_REJECTED");
  const desktopOutput = join(lab, "desktop", "desktop-provision.json");
  const serviceOutput = join(lab, "service", "service-provision.json");
  const receiverPrivate = join(lab, "desktop", "private", "receiver.dpapi.json");
  const signerPrivate = join(lab, "service", "private", "signer.dpapi.json");
  const compiledAdapter = resolve("packages/local-channel/native/build/Release/camacho_windows_pipe.node");
  const adapter = join(lab, "service", "camacho_windows_pipe.node");
  if (!within(compiledAdapter, resolve(".")) || !existsSync(compiledAdapter) || !statSync(compiledAdapter).isFile() ||
      !existsSync(adapter) || sha(readFileSync(adapter)) !== sha(readFileSync(compiledAdapter))) fail("PINNED_LAB_ADAPTER_MISSING_OR_MISMATCH");
  if (!absoluteWindows(receiverPath) || !absoluteWindows(signerPath) ||
      !within(receiverPath, lab) || !within(signerPath, lab)) fail("PUBLIC_ENROLLMENT_OUTSIDE_LAB");
  if (existsSync(desktopOutput) || existsSync(serviceOutput)) fail("PROVISION_ALREADY_EXISTS");
  // Installer cannot inspect the SERVICE-private folder: its owner-only DACL is intentional.
  // Real Service custody must be attested by the separate service-side operator test.
  if (!existsSync(receiverPrivate)) fail("DESKTOP_DPAPI_CUSTODY_MISSING");
  const r = parse(receiverPath), s = parse(signerPath);
  if (r.installation_id !== installationId || r.device_id !== deviceId ||
      !sid(r.recipient_sid) || !logon(r.recipient_logon_sid) ||
      !Number.isInteger(r.recipient_session_id) || r.recipient_session_id <= 0 ||
      !hex(r.recipient_key_sha256)) fail("RECEIVER_ENROLLMENT_REJECTED");
  if (!serviceSid(s.service_sid) || s.service_sid !== "S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569" ||
      !hex(s.spki_sha256)) fail("SIGNER_ENROLLMENT_REJECTED");
  const receiverKey = createPublicKey(r.recipient_public_key_pem);
  if (receiverKey.asymmetricKeyType !== "rsa" || (receiverKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072 ||
      receiverKey.asymmetricKeyDetails?.publicExponent !== 65537n ||
      sha(receiverKey.export({ type: "spki", format: "der" })) !== r.recipient_key_sha256) fail("RECEIVER_KEY_PIN_INVALID");
  const signerKey = createPublicKey(s.public_key_pem);
  if (signerKey.asymmetricKeyType !== "ed25519" ||
      sha(signerKey.export({ type: "spki", format: "der" })) !== s.spki_sha256) fail("SIGNER_KEY_PIN_INVALID");
  const now = new Date();
  const handoff = {
    profile: "CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",
    service_id: "CamachoPOSLocalService",
    service_sid: s.service_sid,
    installation_id: installationId,
    device_id: deviceId,
    recipient_sid: r.recipient_sid,
    recipient_logon_sid: r.recipient_logon_sid,
    recipient_session_id: r.recipient_session_id,
    recipient_public_key_pem: r.recipient_public_key_pem,
    recipient_key_sha256: r.recipient_key_sha256,
    capsule_file: join(lab, "results", "capsule.json"),
    not_before: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
    revision: 1, poll_ms: 250, policy_reference: "SCM_VM_PHYSICAL_LAB_ONLY"
  };
  const shared = {
    version: 1, handoff, adapter_file: adapter,
    adapter_sha256: sha(readFileSync(adapter)), signer_public_key_pem: s.public_key_pem,
    signer_spki_sha256: s.spki_sha256
  };
  const service = { ...shared, role: "SERVICE", signer_private_file: signerPrivate };
  const desktop = { ...shared, role: "DESKTOP", receiver_file: receiverPrivate };
  // Windows installer must harden ACLs before either output can be accepted
  // by native read-managed; this tool does not bypass custody checks.
  writeManifestPair(desktopOutput, serviceOutput, desktop, service);
  console.log("PAIRED_MANIFESTS_CREATED=YES");
  console.log("INSTALLER_MANAGED_ACL_REQUIRED=YES");
  console.log("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN=ACTIVE");
}
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) {
  try { main(); } catch (e) { console.error("SCM_PAIRED_MANIFEST_REJECTED=" + e.message); process.exitCode = 2; }
}
