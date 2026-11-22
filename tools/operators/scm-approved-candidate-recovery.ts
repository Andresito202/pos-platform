import { readVerifiedWindowsScmPolicy } from "../../packages/local-channel/src/windows-scm-policy.js";
import { recoverPinnedScmCandidate } from "./scm-immutable-provision-store.mjs";

/** Operator-only read path; no root defaults, issuer selection, state mutation,
 * key generation or SCM activation. Rotation requires a separate durable,
 * audited installer transaction and cannot be performed by this reader. */
export function recoverScmCandidateWithSignedPolicy(input: {
  trustFile: string; policyFile: string; root: string;
  hashOfAdapter: (file: string) => string;
}) {
  const {policy, authorityPin} = readVerifiedWindowsScmPolicy(input.trustFile, input.policyFile);
  if (policy.action !== "RECOVER_CANDIDATE") throw Error("SCM_ROTATION_INSTALLER_TRANSACTION_REQUIRED");
  return recoverPinnedScmCandidate({
    root: input.root, hashOfAdapter: input.hashOfAdapter,
    expectedSha256: policy.candidate_sha256, minRevision: policy.policy_revision,
    expectedBinding: {
      installationId: policy.installation_id, deviceId: policy.device_id,
      revision: policy.policy_revision, policyReference: policy.policy_reference, authorityPin,
    },
  });
}
