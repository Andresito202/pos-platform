import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { expect, it } from "vitest";
import { windowsScmCheckpointSigningBytes } from "@pos-platform/contracts";
import { ScmCheckpointIssuer } from "../src/scm-checkpoint-issuer.js";

const keys = generateKeyPairSync("ed25519");
const checkpoint = { profile: "CAMACHO_SCM_POLICY_TRUST_V1", service_id: "CamachoPOSLocalService", installation_id: "019a0000-0000-7000-8000-000000000001", device_id: "019a0000-0000-7000-8000-000000000002", not_before: "2026-11-22T00:00:00Z", expires_at: "2027-11-22T00:00:00Z", trust_revision: 1, authority_public_key_pem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority_spki_sha256: createHash("sha256").update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex"), current_policy_revision: 1, current_candidate_sha256: "a".repeat(64), revoked_policy_ids: [], revoked_authority_pins: [] };
it("Central issuer signs the complete contract bytes with its provisioned signer", async () => {
  const issuer = new ScmCheckpointIssuer({ sign: async bytes => sign(null, bytes, keys.privateKey) });
  const signed = await issuer.issue(checkpoint);
  expect(verify(null, windowsScmCheckpointSigningBytes(checkpoint), keys.publicKey, Buffer.from(signed.signature, "base64url"))).toBe(true);
});
it("Central rejects a failed signer without publishing a partial checkpoint", async () => {
  const issuer = new ScmCheckpointIssuer({ sign: async () => Buffer.alloc(32) });
  await expect(issuer.issue(checkpoint)).rejects.toThrow("SCM_CHECKPOINT_SIGNER_REJECTED");
});
it("rejects private authority material before invoking the signer or publishing", async () => {
  let calls = 0;
  const issuer = new ScmCheckpointIssuer({ sign: async () => { calls++; return Buffer.alloc(64); } });
  await expect(issuer.issue({ ...checkpoint, authority_public_key_pem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })).rejects.toThrow();
  expect(calls).toBe(0);
});
