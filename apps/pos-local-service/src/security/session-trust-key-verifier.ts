import { createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  SignedSessionAssertionOperationalKeySchema,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionOperationalKeyClaims,
} from "@pos-platform/contracts";

export type SessionTrustKeyDecision =
  | "VALID"
  | "ROOT_SIGNATURE_INVALID"
  | "KEY_MATERIAL_INVALID"
  | "PURPOSE_MISMATCH"
  | "ENVIRONMENT_MISMATCH"
  | "REVOKED"
  | "NOT_YET_VALID"
  | "EXPIRED";

export interface SessionTrustVerificationResult {
  readonly decision: SessionTrustKeyDecision;
  readonly claims: SessionAssertionOperationalKeyClaims | null;
  readonly evaluatedAt: string;
}

/**
 * Verifies the centrally issued public key used to sign Session Assertions.
 *
 * The root key is injected from product/deployment trust material. This class
 * never generates, stores or accepts a private session-signing key.
 */
export class SessionTrustKeyVerifier {
  constructor(
    private readonly rootTrustAnchor: KeyObject,
    private readonly expectedEnvironment: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (rootTrustAnchor.type !== "public" || rootTrustAnchor.asymmetricKeyType !== "ed25519") {
      throw new Error("SESSION_TRUST_PUBLIC_ED25519_ROOT_REQUIRED");
    }
  }

  verify(input: unknown): SessionTrustVerificationResult {
    const evaluatedAt = this.now();
    const evaluatedAtIso = evaluatedAt.toISOString();
    const signed = SignedSessionAssertionOperationalKeySchema.parse(input);
    const claims = signed.claims;

    if (claims.key_purpose !== "SESSION_ASSERTION") {
      return this.result("PURPOSE_MISMATCH", null, evaluatedAtIso);
    }
    if (claims.environment !== this.expectedEnvironment) {
      return this.result("ENVIRONMENT_MISMATCH", null, evaluatedAtIso);
    }
    let rootSignatureValid = false;
    try {
      rootSignatureValid = verify(
        null,
        unsignedSessionAssertionOperationalKeyBytes(claims),
        this.rootTrustAnchor,
        Buffer.from(signed.signature, "base64url"),
      );
    } catch {
      rootSignatureValid = false;
    }
    if (!rootSignatureValid) {
      return this.result("ROOT_SIGNATURE_INVALID", null, evaluatedAtIso);
    }

    // Revocation is authority too: never let an unsigned status mutate trust.
    // Tombstones remain effective after key expiry, but must authenticate first.
    try {
      this.publicOperationalKey(claims.public_key_pem);
    } catch {
      return this.result("KEY_MATERIAL_INVALID", null, evaluatedAtIso);
    }
    if (claims.status === "REVOKED") {
      return this.result("REVOKED", null, evaluatedAtIso);
    }

    const time = evaluatedAt.getTime();
    if (time < Date.parse(claims.valid_from)) {
      return this.result("NOT_YET_VALID", null, evaluatedAtIso);
    }
    if (claims.valid_until !== null && time >= Date.parse(claims.valid_until)) {
      return this.result("EXPIRED", null, evaluatedAtIso);
    }

    return this.result("VALID", claims, evaluatedAtIso);
  }

  toTrustedSigningKey(claims: SessionAssertionOperationalKeyClaims): {
    key: KeyObject;
    status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED";
    validFrom: string;
    validUntil: string | null;
  } {
    return {
      key: this.publicOperationalKey(claims.public_key_pem),
      status: claims.status,
      validFrom: claims.valid_from,
      validUntil: claims.valid_until,
    };
  }

  private publicOperationalKey(pem: string): KeyObject {
    // createPublicKey also accepts private PEM; reject it before conversion.
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("PUBLIC_KEY_REQUIRED");
    const key = createPublicKey(pem);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error("ED25519_REQUIRED");
    return key;
  }

  private result(
    decision: SessionTrustKeyDecision,
    claims: SessionAssertionOperationalKeyClaims | null,
    evaluatedAt: string,
  ): SessionTrustVerificationResult {
    return { decision, claims, evaluatedAt };
  }
}
