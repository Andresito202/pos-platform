import { createHash,createPublicKey, sign, type KeyObject } from "node:crypto";
import {
  AuthorizationTrustCandidateClaimsSchema, unsignedAuthorizationTrustCandidateBytes,
  type SignedAuthorizationTrustCandidate,
  AuthorizationTrustClaimsSchema,unsignedAuthorizationTrustBytes,type SignedAuthorizationTrust,
  AuthorizationRootTransitionClaimsSchema,unsignedAuthorizationRootTransitionBytes,type SignedAuthorizationRootTransition,
} from "@pos-platform/contracts";

/** Offline-root signing seam for the DEC-011 laboratory experiment only.
 * No production bootstrap imports this module; no root private key is served. */
export function signIsolatedAuthorizationTrust(claims: unknown, root: KeyObject): SignedAuthorizationTrustCandidate {
  const parsed = AuthorizationTrustCandidateClaimsSchema.parse(claims);
  validateSigningSet(root,parsed.keys);
  return { claims: parsed, signature: sign(null, unsignedAuthorizationTrustCandidateBytes(parsed), root).toString("base64url") };
}

/** Explicit offline deployment operation; no HTTP caller or automatic root
 * creation. Caller supplies the approved complete recipient-bound manifest. */
export function signAuthorizationTrust(claims:unknown,root:KeyObject):SignedAuthorizationTrust{
  const parsed=AuthorizationTrustClaimsSchema.parse(claims);
  validateSigningSet(root,parsed.keys);
  return {claims:parsed,signature:sign(null,unsignedAuthorizationTrustBytes(parsed),root).toString("base64url")};
}
/** Offline rollover ceremony: both custodians sign exactly the same claims.
 * Neither private root is an HTTP/server configuration input here. */
export function signAuthorizationRootTransition(claims:unknown,oldRoot:KeyObject,newRoot:KeyObject):SignedAuthorizationRootTransition{
  const parsed=AuthorizationRootTransitionClaimsSchema.parse(claims),bytes=unsignedAuthorizationRootTransitionBytes(parsed);
  for(const root of [oldRoot,newRoot])if(root.type!=="private"||root.asymmetricKeyType!=="ed25519")throw Error("SAS_ROOT_PRIVATE_ED25519_REQUIRED");
  const fp=(key:KeyObject)=>createHash("sha256").update(createPublicKey(key).export({type:"spki",format:"der"})).digest("hex");
  if(fp(oldRoot)!==parsed.old_root_spki_sha256||fp(newRoot)!==parsed.new_root_spki_sha256||fp(oldRoot)===fp(newRoot)||
    !createPublicKey(newRoot).export({type:"spki",format:"der"}).equals(createPublicKey(parsed.new_root_public_key_pem).export({type:"spki",format:"der"})))throw Error("SAS_ROOT_TRANSITION_SIGNERS_MISMATCH");
  return {claims:parsed,old_signature:sign(null,bytes,oldRoot).toString("base64url"),new_signature:sign(null,bytes,newRoot).toString("base64url")};
}

function validateSigningSet(root:KeyObject,keys:ReadonlyArray<{public_key_pem:string}>){
  if (root.type !== "private" || root.asymmetricKeyType !== "ed25519") throw Error("SAS_ROOT_PRIVATE_ED25519_REQUIRED");
  const materials = new Set<string>();
  for (const candidate of keys) {
    const key = createPublicKey(candidate.public_key_pem), material = key.export({ type: "spki", format: "der" }).toString("hex");
    if (key.asymmetricKeyType !== "ed25519" || materials.has(material)) throw Error("SAS_OPERATIONAL_PUBLIC_SET_REQUIRED");
    materials.add(material);
  }
}
