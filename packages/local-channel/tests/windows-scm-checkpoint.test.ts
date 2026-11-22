import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {describe, expect, it} from "vitest";
import type {WindowsScmPolicyTrust} from "@pos-platform/contracts";
import {verifyWindowsScmCheckpoint} from "../src/windows-scm-policy.js";
import {ScmCheckpointIssuer} from "../../../apps/central-authority/src/scm-checkpoint-issuer.js";

const key = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
const pem = key.publicKey.export({format:"pem", type:"spki"}).toString();
const pin = createHash("sha256").update(key.publicKey.export({format:"der", type:"spki"})).digest("hex");
const checkpoint:WindowsScmPolicyTrust = {profile:"CAMACHO_SCM_POLICY_TRUST_V1", service_id:"CamachoPOSLocalService",
  installation_id:"c54bbaad-a6dd-45d6-9c6f-cb5e782573c8", device_id:"a2644dc4-3a15-4f04-a299-99c57d47ac2b",
  not_before:"2026-01-01T00:00:00Z", expires_at:"2028-01-01T00:00:00Z", trust_revision:2,
  authority_public_key_pem:pem, authority_spki_sha256:pin, current_policy_revision:4,
  current_candidate_sha256:"1".repeat(64), revoked_policy_ids:[], revoked_authority_pins:[]};
const root = {publicKeyPem:pem, spkiSha256:pin, installationId:checkpoint.installation_id, deviceId:checkpoint.device_id};
const now = new Date("2026-11-22T00:00:00Z");
const issuer = new ScmCheckpointIssuer({sign:async bytes => sign(null,bytes,key.privateKey)});

describe("Central SCM checkpoint signing and independent root verification", () => {
  it("verifies the Central signature against the separately supplied root and scope", async () => {
    const envelope=await issuer.issue(checkpoint);
    expect(verifyWindowsScmCheckpoint(envelope,root,now)).toEqual(checkpoint);
    expect(Object.isFrozen(verifyWindowsScmCheckpoint(envelope,root,now).revoked_policy_ids)).toBe(true);
  });
  it("rejects changes to scope, revisions, candidate, revocations and validity", async () => {
    const envelope=await issuer.issue(checkpoint);
    for (const change of [{installation_id:checkpoint.device_id}, {device_id:checkpoint.installation_id},
      {trust_revision:3}, {current_policy_revision:5}, {current_candidate_sha256:"2".repeat(64)},
      {revoked_policy_ids:["c1ca7c7d-2a47-4d2b-bbc3-80b14a03e4a6"]}, {revoked_authority_pins:["3".repeat(64)]},
      {not_before:"2025-01-01T00:00:00Z"}, {expires_at:"2029-01-01T00:00:00Z"}]) {
      expect(()=>verifyWindowsScmCheckpoint({...envelope,checkpoint:{...checkpoint,...change}},root,now)).toThrow();
    }
  });
  it("rejects untrusted signers, substituted roots and expired checkpoints", async () => {
    const badIssuer=new ScmCheckpointIssuer({sign:async bytes=>sign(null,bytes,other.privateKey)});
    const envelope=await issuer.issue(checkpoint);
    const awaited=await badIssuer.issue(checkpoint);
    expect(()=>verifyWindowsScmCheckpoint(awaited,root,now)).toThrow();
    expect(()=>verifyWindowsScmCheckpoint(envelope,{...root,spkiSha256:"0".repeat(64)},now)).toThrow();
    expect(()=>verifyWindowsScmCheckpoint(envelope,root,new Date("2029-01-01T00:00:00Z"))).toThrow();
  });
});
