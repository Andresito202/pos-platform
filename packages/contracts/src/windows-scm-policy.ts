import * as z from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().safe();
const scope = { installation_id: z.uuid(), device_id: z.uuid() };
const validity = { not_before: z.iso.datetime(), expires_at: z.iso.datetime() };

/** External installer-owned trust/checkpoint. Never learned from a candidate,
 * capsule, operator-supplied digest or BUSINESS/GLOBAL/license authority. */
export const WindowsScmPolicyTrustSchema = z.strictObject({
  profile: z.literal("CAMACHO_SCM_POLICY_TRUST_V1"),
  service_id: z.literal("CamachoPOSLocalService"),
  ...scope, ...validity,
  trust_revision: revision,
  authority_public_key_pem: z.string().min(40).max(4096),
  authority_spki_sha256: hash,
  current_policy_revision: revision,
  current_candidate_sha256: hash,
  revoked_policy_ids: z.array(z.uuid()).max(1024),
  revoked_authority_pins: z.array(hash).max(64),
});
export type WindowsScmPolicyTrust = z.infer<typeof WindowsScmPolicyTrustSchema>;

/** A signed operator intent, not a commercial enablement credential. */
export const WindowsScmPolicySchema = z.strictObject({
  profile: z.literal("CAMACHO_SCM_PROVISION_POLICY_V1"),
  service_id: z.literal("CamachoPOSLocalService"),
  ...scope, ...validity,
  policy_id: z.uuid(),
  trust_revision: revision,
  policy_revision: revision,
  authority_spki_sha256: hash,
  action: z.enum(["RECOVER_CANDIDATE", "ROTATE_CANDIDATE"]),
  candidate_sha256: hash,
  previous_candidate_sha256: hash.nullable(),
  policy_reference: z.string().min(1).max(256),
});
export type WindowsScmPolicy = z.infer<typeof WindowsScmPolicySchema>;
export const SignedWindowsScmPolicySchema = z.strictObject({
  policy: WindowsScmPolicySchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
