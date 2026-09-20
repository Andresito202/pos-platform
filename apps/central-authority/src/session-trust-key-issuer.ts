import { sign, type KeyObject } from "node:crypto";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionOperationalKeyClaims,
  type SignedSessionAssertionOperationalKey,
} from "@pos-platform/contracts";

/**
 * Central issuer for the public operational key that signs SSAs.
 *
 * The issuer receives only the central private signing key through deployment
 * wiring. The Local Service receives the resulting signed public artifact; the
 * private key is never part of the artifact or its contract.
 */
export class SessionTrustKeyIssuer {
  constructor(private readonly issuerPrivateKey: KeyObject) {}

  issue(claimsInput: SessionAssertionOperationalKeyClaims): SignedSessionAssertionOperationalKey {
    const claims = SessionAssertionOperationalKeyClaimsSchema.parse(claimsInput);
    return {
      claims,
      signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), this.issuerPrivateKey).toString("base64url"),
    };
  }
}
