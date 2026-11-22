import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {WindowsScmPolicy, WindowsScmPolicyTrust} from "@pos-platform/contracts";
const boundary = vi.hoisted(() => ({read: vi.fn(), recover: vi.fn()}));
vi.mock("../src/windows-native-pipe.js", async original => ({
  ...await original<typeof import("../src/windows-native-pipe.js")>(), readWindowsManagedBytes: boundary.read,
}));
vi.mock("../../../tools/operators/scm-immutable-provision-store.mjs", () => ({recoverPinnedScmCandidate: boundary.recover}));
import {verifyWindowsScmPolicy, windowsScmPolicySigningBytes, readVerifiedWindowsScmPolicy} from "../src/windows-scm-policy.js";
import {canonicalJson} from "../src/canonical-json.js";
import {recoverScmCandidateWithSignedPolicy} from "../../../tools/operators/scm-approved-candidate-recovery.js";

// Disposable cryptographic fixtures only. No authority or private key is
// installed, persisted, exported to a product process or treated as production.
const issuer = generateKeyPairSync("ed25519"), outsider = generateKeyPairSync("ed25519");
const pem = issuer.publicKey.export({format:"pem", type:"spki"}).toString();
const pin = createHash("sha256").update(issuer.publicKey.export({format:"der", type:"spki"})).digest("hex");
const now = new Date(), stamp = (delta: number) => new Date(now.getTime() + delta).toISOString();
const trust: WindowsScmPolicyTrust = {
  profile:"CAMACHO_SCM_POLICY_TRUST_V1", service_id:"CamachoPOSLocalService",
  installation_id:"c54bbaad-a6dd-45d6-9c6f-cb5e782573c8", device_id:"a2644dc4-3a15-4f04-a299-99c57d47ac2b",
  not_before:stamp(-3600000), expires_at:stamp(3600000), trust_revision:2,
  authority_public_key_pem:pem, authority_spki_sha256:pin,
  current_policy_revision:4, current_candidate_sha256:"1".repeat(64),
  revoked_policy_ids:[], revoked_authority_pins:[],
};
const policy: WindowsScmPolicy = {
  profile:"CAMACHO_SCM_PROVISION_POLICY_V1", service_id:"CamachoPOSLocalService",
  installation_id:trust.installation_id, device_id:trust.device_id,
  not_before:stamp(-60000), expires_at:stamp(60000), policy_id:"c1ca7c7d-2a47-4d2b-bbc3-80b14a03e4a6",
  trust_revision:2, policy_revision:4, authority_spki_sha256:pin, action:"RECOVER_CANDIDATE",
  candidate_sha256:trust.current_candidate_sha256, previous_candidate_sha256:null, policy_reference:"fixture-policy",
};
function signed(p = policy, key = issuer.privateKey) {
  return {policy:p, signature:sign(null, windowsScmPolicySigningBytes(p), key).toString("base64url")};
}
beforeEach(() => {
  vi.clearAllMocks();
  boundary.read.mockImplementation((file: string) => Buffer.from(JSON.stringify(file === "trust" ? trust : signed())));
  boundary.recover.mockReturnValue({status:"CANDIDATE_RECOVERED_NOT_AUTHORIZED", revision:4, sha256:policy.candidate_sha256, commercial_ready:false});
});
describe("SCM signed policy (real Ed25519, external custody boundary doubled)", () => {
  it("verifies an independent approval without granting commercial authority", () => {
    expect(verifyWindowsScmPolicy(signed(), trust, now)).toEqual(policy);
    expect(Object.isFrozen(verifyWindowsScmPolicy(signed(), trust, now))).toBe(true);
  });
  it("rejects an unauthorized actor's own valid signature", () => {
    expect(() => verifyWindowsScmPolicy(signed(policy, outsider.privateKey), trust, now)).toThrow();
  });
  it("rejects substituted pins and keys rather than trusting the policy", () => {
    expect(() => verifyWindowsScmPolicy(signed({...policy, authority_spki_sha256:"0".repeat(64)}), trust, now)).toThrow();
    const substituted = outsider.publicKey.export({type:"spki", format:"pem"}).toString();
    expect(() => verifyWindowsScmPolicy(signed(), {...trust, authority_public_key_pem:substituted}, now)).toThrow();
    expect(() => verifyWindowsScmPolicy({...signed(), public_key_pem:substituted}, trust, now)).toThrow();
    const privatePem = issuer.privateKey.export({type:"pkcs8", format:"pem"}).toString();
    expect(() => verifyWindowsScmPolicy(signed(), {...trust, authority_public_key_pem:privatePem}, now)).toThrow();
  });
  it("rejects signature modification, wrong signature domain and modified claims", () => {
    const valid = signed();
    expect(() => verifyWindowsScmPolicy({...valid, signature:"A".repeat(86)}, trust, now)).toThrow();
    expect(() => verifyWindowsScmPolicy({...valid, policy:{...policy, policy_reference:"altered"}}, trust, now)).toThrow();
    const foreign = sign(null, Buffer.from(canonicalJson(policy)), issuer.privateKey).toString("base64url");
    expect(() => verifyWindowsScmPolicy({...valid, signature:foreign}, trust, now)).toThrow();
  });
  it.each(["policy", "authority"])("rejects revoked %s from the authenticated checkpoint", mode => {
    const state = {...trust, revoked_policy_ids:mode === "policy" ? [policy.policy_id] : [],
      revoked_authority_pins:mode === "authority" ? [pin] : []};
    expect(() => verifyWindowsScmPolicy(signed(), state, now)).toThrow();
  });
  it("rejects previous policy/trust revisions and a different checkpoint digest", () => {
    for (const p of [{...policy, policy_revision:3}, {...policy, trust_revision:1}, {...policy, candidate_sha256:"2".repeat(64)}]) {
      expect(() => verifyWindowsScmPolicy(signed(p), trust, now)).toThrow();
    }
  });
  it("rejects wrong installation/device and expired or future policy/trust", () => {
    for (const p of [{...policy, device_id:policy.installation_id}, {...policy, installation_id:policy.device_id},
      {...policy, expires_at:stamp(-1)}, {...policy, not_before:stamp(1)}]) {
      expect(() => verifyWindowsScmPolicy(signed(p), trust, now)).toThrow();
    }
    expect(() => verifyWindowsScmPolicy(signed(), {...trust, expires_at:stamp(-1)}, now)).toThrow();
    expect(() => verifyWindowsScmPolicy(signed(), trust, new Date(NaN))).toThrow();
  });
  it("verifies only the next explicit rotation intent, without applying it", () => {
    const next: WindowsScmPolicy = {...policy, action:"ROTATE_CANDIDATE", policy_revision:5,
      previous_candidate_sha256:trust.current_candidate_sha256, candidate_sha256:"2".repeat(64)};
    expect(verifyWindowsScmPolicy(signed(next), trust, now).action).toBe("ROTATE_CANDIDATE");
    for (const p of [{...next, policy_revision:6}, {...next, previous_candidate_sha256:"3".repeat(64)},
      {...next, candidate_sha256:trust.current_candidate_sha256}]) {
      expect(() => verifyWindowsScmPolicy(signed(p), trust, now)).toThrow();
    }
    expect(trust.current_policy_revision).toBe(4);
  });
  it("operational recovery derives hash/revision/binding only from verified managed files", () => {
    const result = recoverScmCandidateWithSignedPolicy({trustFile:"trust", policyFile:"policy", root:"external-root", hashOfAdapter:()=>"0".repeat(64)});
    expect(result.commercial_ready).toBe(false);
    expect(boundary.recover).toHaveBeenCalledWith(expect.objectContaining({expectedSha256:policy.candidate_sha256, minRevision:4,
      expectedBinding:{installationId:trust.installation_id, deviceId:trust.device_id, revision:4, policyReference:policy.policy_reference, authorityPin:pin}}));
  });
  it("denies missing root/custody before reading the candidate", () => {
    expect(() => readVerifiedWindowsScmPolicy("", "policy")).toThrow();
    boundary.read.mockImplementationOnce(() => {throw Error("MANAGED_FILE_OWNER_REJECTED");});
    expect(() => recoverScmCandidateWithSignedPolicy({trustFile:"trust", policyFile:"policy", root:"external-root", hashOfAdapter:()=>""})).toThrow();
    expect(boundary.recover).not.toHaveBeenCalled();
  });
  it("does not apply even a valid rotation through the read-only recovery path", () => {
    const next: WindowsScmPolicy = {...policy, action:"ROTATE_CANDIDATE", policy_revision:5,
      previous_candidate_sha256:trust.current_candidate_sha256, candidate_sha256:"2".repeat(64)};
    boundary.read.mockImplementation(file => Buffer.from(JSON.stringify(file === "trust" ? trust : signed(next))));
    expect(() => recoverScmCandidateWithSignedPolicy({trustFile:"trust", policyFile:"policy", root:"external-root", hashOfAdapter:()=>""})).toThrow("SCM_ROTATION_INSTALLER_TRANSACTION_REQUIRED");
    expect(boundary.recover).not.toHaveBeenCalled();
  });
});
