import { createPublicKey, sign, type KeyObject } from "node:crypto";
import {
  AuthorizationTrustCandidateClaimsSchema, unsignedAuthorizationTrustCandidateBytes,
  type SignedAuthorizationTrustCandidate,
} from "@pos-platform/contracts";

/** Offline-root signing seam for the DEC-011 laboratory experiment only.
 * No production bootstrap imports this module; no root private key is served. */
export function signIsolatedAuthorizationTrust(claims: unknown, root: KeyObject): SignedAuthorizationTrustCandidate {
  const parsed = AuthorizationTrustCandidateClaimsSchema.parse(claims);
  if (root.type !== "private" || root.asymmetricKeyType !== "ed25519") throw Error("SAS_ROOT_PRIVATE_ED25519_REQUIRED");
  const materials = new Set<string>();
  for (const candidate of parsed.keys) {
    const key = createPublicKey(candidate.public_key_pem), material = key.export({ type: "spki", format: "der" }).toString("hex");
    if (key.asymmetricKeyType !== "ed25519" || materials.has(material)) throw Error("SAS_OPERATIONAL_PUBLIC_SET_REQUIRED");
    materials.add(material);
  }
  return { claims: parsed, signature: sign(null, unsignedAuthorizationTrustCandidateBytes(parsed), root).toString("base64url") };
}
