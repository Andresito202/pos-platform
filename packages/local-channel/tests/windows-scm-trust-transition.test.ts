import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {describe, expect, it} from "vitest";
import type {WindowsScmPolicy, WindowsScmPolicyTrust} from "@pos-platform/contracts";
import {assertWindowsScmTrustTransition, windowsScmPolicySigningBytes} from "../src/windows-scm-policy.js";

// Disposable keys and in-memory checkpoint inputs; no OS custody is exercised.
const issuer = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
const pem = issuer.publicKey.export({format:"pem", type:"spki"}).toString();
const pin = createHash("sha256").update(issuer.publicKey.export({format:"der", type:"spki"})).digest("hex");
const oldId = "c1ca7c7d-2a47-4d2b-bbc3-80b14a03e4a6";
const trust: WindowsScmPolicyTrust = {
  profile:"CAMACHO_SCM_POLICY_TRUST_V1", service_id:"CamachoPOSLocalService",
  installation_id:"c54bbaad-a6dd-45d6-9c6f-cb5e782573c8", device_id:"a2644dc4-3a15-4f04-a299-99c57d47ac2b",
  not_before:"2026-01-01T00:00:00Z", expires_at:"2028-01-01T00:00:00Z", trust_revision:2,
  authority_public_key_pem:pem, authority_spki_sha256:pin, current_policy_revision:4,
  current_candidate_sha256:"1".repeat(64), revoked_policy_ids:[oldId], revoked_authority_pins:["3".repeat(64)],
};
const rotation: WindowsScmPolicy = {
  profile:"CAMACHO_SCM_PROVISION_POLICY_V1", service_id:"CamachoPOSLocalService",
  installation_id:trust.installation_id, device_id:trust.device_id,
  not_before:trust.not_before, expires_at:trust.expires_at, policy_id:"1a4a7c7d-2a47-4d2b-bbc3-80b14a03e4a6",
  trust_revision:2, policy_revision:5, authority_spki_sha256:pin, action:"ROTATE_CANDIDATE",
  candidate_sha256:"2".repeat(64), previous_candidate_sha256:trust.current_candidate_sha256, policy_reference:"test",
};
const now = new Date("2026-11-22T00:00:00Z");
const signed = (key = issuer.privateKey, policy = rotation) => ({policy, signature:sign(null, windowsScmPolicySigningBytes(policy), key).toString("base64url")});
const next = {...trust, trust_revision:3};

describe("SCM checkpoint transition (authenticated custody boundary supplied by caller)", () => {
  it("allows a successor adding revocations without changing the candidate", () => {
    expect(() => assertWindowsScmTrustTransition(trust, {...next, revoked_policy_ids:[oldId, rotation.policy_id]})).not.toThrow();
  });
  it("requires a valid signed successor for candidate rotation", () => {
    const rotated = {...next, current_policy_revision:5, current_candidate_sha256:rotation.candidate_sha256};
    expect(() => assertWindowsScmTrustTransition(trust, rotated, signed(), now)).not.toThrow();
    expect(() => assertWindowsScmTrustTransition(trust, rotated, undefined, now)).toThrow();
    expect(() => assertWindowsScmTrustTransition(trust, rotated, signed(other.privateKey), now)).toThrow();
    expect(() => assertWindowsScmTrustTransition(trust, {...rotated, revoked_policy_ids:[oldId, rotation.policy_id]}, signed(), now)).toThrow();
  });
  it("rejects rollback, skipped revisions, candidate substitution and removed revocations", () => {
    for (const invalid of [trust, {...next, trust_revision:4}, {...next, current_policy_revision:3},
      {...next, current_policy_revision:6, current_candidate_sha256:rotation.candidate_sha256},
      {...next, current_candidate_sha256:rotation.candidate_sha256}, {...next, revoked_policy_ids:[]},
      {...next, revoked_authority_pins:[]}, {...next, device_id:trust.installation_id},
      {...next, authority_spki_sha256:"4".repeat(64)}]) {
      expect(() => assertWindowsScmTrustTransition(trust, invalid, undefined, now)).toThrow();
    }
  });
  it("rejects using a rotation approval for an unchanged checkpoint", () => {
    expect(() => assertWindowsScmTrustTransition(trust, next, signed(), now)).toThrow();
  });
});
