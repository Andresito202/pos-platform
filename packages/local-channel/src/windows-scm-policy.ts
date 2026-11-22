import { createHash, createPublicKey, verify } from "node:crypto";
import {
  WindowsScmPolicySchema, WindowsScmPolicyTrustSchema, SignedWindowsScmPolicySchema,
  type WindowsScmPolicy, type WindowsScmPolicyTrust,
} from "@pos-platform/contracts";
import { canonicalJson } from "./canonical-json.js";
import { readWindowsManagedBytes } from "./windows-native-pipe.js";

const reject = (): never => { throw Error("SCM_SIGNED_POLICY_REJECTED"); };
const domain = "CAMACHO_SCM_APPROVAL_SIGNATURE_V1\0";
function active(value: {not_before: string; expires_at: string}, now: Date) {
  const from = Date.parse(value.not_before), until = Date.parse(value.expires_at), at = now.getTime();
  if (!Number.isFinite(at) || !(from <= at && at < until)) reject();
}
/** Public deterministic bytes. This module never signs or provisions a key. */
export function windowsScmPolicySigningBytes(input: unknown): Buffer {
  return Buffer.from(domain + canonicalJson(WindowsScmPolicySchema.parse(input)), "utf8");
}

/** Pure verification; trust MUST already have authenticated external custody.
 * A self-consistent PEM/pin supplied by an untrusted caller is not a root. */
export function verifyWindowsScmPolicy(input: unknown, trustedState: WindowsScmPolicyTrust,
  now = new Date()): Readonly<WindowsScmPolicy> {
  const trust = WindowsScmPolicyTrustSchema.parse(trustedState);
  const signed = SignedWindowsScmPolicySchema.parse(input), policy = signed.policy;
  active(trust, now); active(policy, now);
  if (!trust.authority_public_key_pem.trim().startsWith("-----BEGIN PUBLIC KEY-----")) reject();
  const key = createPublicKey(trust.authority_public_key_pem);
  const pin = createHash("sha256").update(key.export({format: "der", type: "spki"})).digest("hex");
  if (key.asymmetricKeyType !== "ed25519" || pin !== trust.authority_spki_sha256 ||
      policy.authority_spki_sha256 !== pin || trust.revoked_authority_pins.includes(pin) ||
      trust.revoked_policy_ids.includes(policy.policy_id) ||
      policy.installation_id !== trust.installation_id || policy.device_id !== trust.device_id ||
      policy.trust_revision !== trust.trust_revision ||
      Date.parse(policy.not_before) < Date.parse(trust.not_before) ||
      Date.parse(policy.expires_at) > Date.parse(trust.expires_at)) reject();
  const signature = Buffer.from(signed.signature, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== signed.signature ||
      !verify(null, windowsScmPolicySigningBytes(policy), key, signature)) reject();
  if (policy.action === "RECOVER_CANDIDATE") {
    if (policy.policy_revision !== trust.current_policy_revision ||
        policy.candidate_sha256 !== trust.current_candidate_sha256 ||
        policy.previous_candidate_sha256 !== null) reject();
  } else {
    // Verify an explicit successor intent, never apply it or advance a floor.
    if (!Number.isSafeInteger(trust.current_policy_revision + 1) ||
        policy.policy_revision !== trust.current_policy_revision + 1 ||
        policy.previous_candidate_sha256 !== trust.current_candidate_sha256 ||
        policy.candidate_sha256 === trust.current_candidate_sha256) reject();
  }
  return Object.freeze(policy);
}

function managedJson(file: string): unknown {
  const bytes = readWindowsManagedBytes(file);
  try {
    if (bytes.length === 0 || bytes.length > 65536) reject();
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } finally { bytes.fill(0); }
}
/** Operational boundary: no PEM, pin, floor, revocation list or clock argument
 * from CLI/env/candidate. Both files use the existing Windows custody reader.
 * The installer must separately guarantee checkpoint freshness/monotonicity. */
export function readVerifiedWindowsScmPolicy(trustFile: string, policyFile: string) {
  if (!trustFile || !policyFile || trustFile === policyFile) reject();
  const trust = WindowsScmPolicyTrustSchema.parse(managedJson(trustFile));
  const policy = verifyWindowsScmPolicy(managedJson(policyFile), trust);
  return Object.freeze({policy, authorityPin: trust.authority_spki_sha256});
}
