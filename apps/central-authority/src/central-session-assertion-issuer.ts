import { createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import {
  SessionAssertionClaimsSchema,
  SignedSessionAssertionOperationalKeySchema,
  SignedSessionAssertionSchema,
  canonicalSessionTrustJson,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionClaims,
  type SignedSessionAssertion,
  type SignedSessionAssertionOperationalKey,
} from "@pos-platform/contracts";
import type { ReservedBusinessSsaSequence } from "@pos-platform/database-postgres";

/**
 * The resolver is a SECURITY BOUNDARY, not a type conversion.
 * The durable reservation eligibleScope must correspond to the authenticated session
 * and verified device; expiry in signed claims cannot exceed either expiry.
 *
 * A future central authentication service must validate possession of a
 * server-issued, revocable session and derive every claim from trusted
 * persisted identity, MFA, membership, device and installation state.
 * In particular, it must reserve a strictly increasing session sequence.
 * Never implement it from request-supplied UUIDs, role names or MFA flags.
 *
 * No production resolver or HTTP endpoint is wired in this increment.
 */
export interface TrustedSessionAssertionIssuance {
  readonly claims: SessionAssertionClaims;
  /** Result of the central PostgreSQL allocator, never raw renderer data. */
  readonly reservation: ReservedBusinessSsaSequence;
  /** Current root-signed artifact obtained from the trusted key lifecycle. */
  readonly signedOperationalKey: SignedSessionAssertionOperationalKey;
}

export type ResolveAuthenticatedSessionAssertion = (
  authorizationProof: string,
) => Promise<TrustedSessionAssertionIssuance | null>;

export interface SessionAssertionIssuancePolicy {
  readonly maximumClaimAgeMs: number;
  readonly maximumOfflineLifetimeMs: number;
}

/**
 * INTERNAL central SSA signer. Does not authenticate credentials or decide
 * permissions. The ONLY input accepted from the caller is an opaque proof;
 * session claims are supplied exclusively by the trusted resolver.
 *
 * The root-signed operational key is verified on EACH issuance, and must
 * be ACTIVE, in the intended environment and bound to the injected Ed25519
 * private key. VERIFY_ONLY and REVOKED keys cannot issue new assertions.
 *
 * This primitive checks correspondence to an allocator result but cannot
 * independently attest that such a reservation was committed. Only a trusted
 * server-side resolver can provide it. It cannot provide revocation
 * freshness by itself. Do not expose it until the resolver, operational key
 * lifecycle and issuance transaction are implemented and tested. This check
 * cannot replace revalidation against revocation or physical device proof.
 */
export class CentralSessionAssertionIssuer {
  constructor(
    private readonly operationalPrivateKey: KeyObject,
    private readonly rootTrustAnchor: KeyObject,
    private readonly resolveAuthenticated: ResolveAuthenticatedSessionAssertion,
    private readonly expectedEnvironment: string,
    private readonly policy: SessionAssertionIssuancePolicy,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (operationalPrivateKey.type !== "private" ||
        operationalPrivateKey.asymmetricKeyType !== "ed25519" ||
        rootTrustAnchor.type !== "public" ||
        rootTrustAnchor.asymmetricKeyType !== "ed25519") {
      throw new Error("SSA_ISSUER_KEY_TYPE_INVALID");
    }
    if (typeof expectedEnvironment !== "string" || !expectedEnvironment) {
      throw new Error("SSA_ISSUER_ENVIRONMENT_REQUIRED");
    }
    if (!Number.isSafeInteger(policy.maximumClaimAgeMs) ||
        policy.maximumClaimAgeMs <= 0 ||
        !Number.isSafeInteger(policy.maximumOfflineLifetimeMs) ||
        policy.maximumOfflineLifetimeMs <= 0) {
      throw new Error("SSA_ISSUER_POLICY_INVALID");
    }
  }

  async issue(authorizationProof: string): Promise<SignedSessionAssertion | null> {
    if (typeof authorizationProof !== "string" || authorizationProof.trim().length === 0) {
      return null;
    }
    const trusted = await this.resolveAuthenticated(authorizationProof);
    if (trusted === null) return null;

    const claims = SessionAssertionClaimsSchema.parse(trusted.claims);
    const reservation = trusted.reservation;
    // The only trusted source of sequence is the PostgreSQL allocator; do not
    // accept a sequence selected by the client or independently fabricated
    // from identity.sessions.version. The resolver must produce this result
    // from a real committed reservation AFTER verifying user/device proofs.
    if (reservation === null || typeof reservation !== "object" ||
        !Number.isSafeInteger(reservation.sequence) || reservation.sequence <= 0 ||
        reservation.sequence !== claims.sequence) {
      throw new Error("SSA_ISSUER_SEQUENCE_RESERVATION_MISMATCH");
    }
    const scope = reservation.eligibleScope;
    // Fail closed if the claims no longer correspond to the authenticated
    // server-resolved business session and physical device scope.
    if (scope === null || typeof scope !== "object" ||
        scope.sessionId !== claims.session_id ||
        scope.userId !== claims.user_id ||
        scope.tenantMembershipId !== claims.tenant_membership_id ||
        scope.installationId !== claims.installation_id ||
        scope.deviceId !== claims.device_id) {
      throw new Error("SSA_ISSUER_TRUSTED_SCOPE_MISMATCH");
    }
    const artifact = SignedSessionAssertionOperationalKeySchema.parse(trusted.signedOperationalKey);
    const key = artifact.claims;
    if (key.environment !== this.expectedEnvironment ||
        key.key_purpose !== "SESSION_ASSERTION" ||
        key.status !== "ACTIVE" ||
        key.key_id !== claims.key_id) {
      throw new Error("SSA_ISSUER_OPERATIONAL_KEY_NOT_ACTIVE");
    }
    let validRootSignature = false;
    try {
      validRootSignature = verify(
        null,
        unsignedSessionAssertionOperationalKeyBytes(key),
        this.rootTrustAnchor,
        Buffer.from(artifact.signature, "base64url"),
      );
    } catch {
      validRootSignature = false;
    }
    if (!validRootSignature) throw new Error("SSA_ISSUER_ROOT_SIGNATURE_INVALID");

    const actualPublic = createPublicKey(this.operationalPrivateKey)
      .export({ format: "der", type: "spki" });
    const certifiedPublic = createPublicKey(key.public_key_pem)
      .export({ format: "der", type: "spki" });
    if (!Buffer.isBuffer(actualPublic) || !Buffer.isBuffer(certifiedPublic) ||
        actualPublic.length !== certifiedPublic.length ||
        !timingSafeEqual(actualPublic, certifiedPublic)) {
      throw new Error("SSA_ISSUER_PRIVATE_KEY_MISMATCH");
    }

    const instant = this.now().getTime();
    const issuedAt = Date.parse(claims.issued_at);
    const validUntil = Date.parse(claims.offline_valid_until);
    const keyFrom = Date.parse(key.valid_from);
    const keyUntil = key.valid_until === null ? null : Date.parse(key.valid_until);
    const sessionUntil = Date.parse(scope.sessionExpiresAt);
    const deviceCredentialUntil = Date.parse(scope.deviceCredentialExpiresAt);
    if (!Number.isFinite(instant) ||
        !Number.isFinite(sessionUntil) ||
        !Number.isFinite(deviceCredentialUntil) ||
        validUntil > sessionUntil ||
        validUntil > deviceCredentialUntil ||
        instant >= sessionUntil ||
        instant >= deviceCredentialUntil ||
        instant < keyFrom || (keyUntil !== null && instant >= keyUntil) ||
        issuedAt < keyFrom || issuedAt > instant ||
        instant - issuedAt > this.policy.maximumClaimAgeMs ||
        validUntil <= instant ||
        validUntil - issuedAt > this.policy.maximumOfflineLifetimeMs ||
        (keyUntil !== null && validUntil > keyUntil)) {
      throw new Error("SSA_ISSUER_VALIDITY_POLICY_REJECTED");
    }

    // Same alphabetical-key JSON canonicalization as the Local Service's
    // canonicalJson. Sign the schema-parsed claims, not the raw input.
    return SignedSessionAssertionSchema.parse({
      claims,
      signature: sign(
        null,
        Buffer.from(canonicalSessionTrustJson(claims)),
        this.operationalPrivateKey,
      ).toString("base64url"),
    });
  }
}
