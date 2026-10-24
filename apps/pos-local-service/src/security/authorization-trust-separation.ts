import type {TrustedSigningKey} from "./license-verifier.js";

/** Inputs must already come from authenticated deployment provisioning. This
 * checks purpose separation of resolved maps; it is not a root-signature format
 * and cannot authenticate a JSON key set or approve its distribution. */
export function assertAuthorizationTrustSeparated(sas:ReadonlyMap<string,TrustedSigningKey>,ssa:ReadonlyMap<string,TrustedSigningKey>){
  const sessionKeys=new Set([...ssa.values()].map(k=>k.key.export({type:"spki",format:"der"}).toString("hex")));
  for(const [id,k] of sas){
    if(k.key.type!=="public"||k.key.asymmetricKeyType!=="ed25519"||!["ACTIVE","VERIFY_ONLY","REVOKED"].includes(k.status)||ssa.has(id)||sessionKeys.has(k.key.export({type:"spki",format:"der"}).toString("hex")))
      throw Error("AUTHORIZATION_TRUST_PURPOSE_SEPARATION_REQUIRED");
  }
}
