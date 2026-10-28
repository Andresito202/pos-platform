import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  PostgresPasswordCredentialVerificationRepository,
  PostgresPlatformWebAuthnChallengeRepository,
  PostgresPlatformWebAuthnMaterialRepository,
  PostgresBusinessInitialWebAuthnTransaction,
  type CommittedBusinessInitialMfa, type createPostgresPool,
} from "@pos-platform/database-postgres";
import { verifyStoredPlatformPassword } from "./platform-password-verifier.js";
import { verifyPlatformWebAuthnAssertion } from "./platform-webauthn-assertion-verifier.js";

/** Non-serializable provenance: only the originating flow can redeem it once. */
export interface BusinessInitialMfaReceipt { readonly kind: "BUSINESS_INITIAL_MFA_RECEIPT" }

/**
 * INTERNAL password -> AUTHENTICATE coordinator. No userId or "password
 * verified" flag is accepted from a client. Password is verified both when
 * issuing the challenge and on completion, avoiding a new pre-login token or
 * a parallel store for password proofs. Not connected to HTTP or React.
 */
export class BusinessInitialMfaFlow {
  private readonly policy;
  private readonly verified = new WeakMap<object, CommittedBusinessInitialMfa>();

  constructor(
    private readonly pool: ReturnType<typeof createPostgresPool>,
    trustedPolicy: {
      readonly rpId: string; readonly origin: string;
      readonly challengeLifetimeMs: number; readonly rejectionVerifier: string;
      readonly sessionScope?:"BUSINESS"|"GLOBAL";
    },
  ) {
    if (!Number.isSafeInteger(trustedPolicy.challengeLifetimeMs) || trustedPolicy.challengeLifetimeMs <= 0) {
      throw new Error("BUSINESS_INITIAL_MFA_CHALLENGE_POLICY_REQUIRED");
    }
    this.policy = Object.freeze({ ...trustedPolicy });
    if(trustedPolicy.sessionScope!==undefined&&!["BUSINESS","GLOBAL"].includes(trustedPolicy.sessionScope))throw Error("INITIAL_MFA_SCOPE_REQUIRED");
  }

  async begin(input: {
    readonly email: string; readonly password: string;
    readonly factorId: string; readonly correlationId: string;
  }): Promise<{ challengeId: string; challenge: string; credentialId: string; userVerification: "required" } | null> {
    const match = await verifyStoredPlatformPassword(
      new PostgresPasswordCredentialVerificationRepository(this.pool), input, this.policy,
    );
    if (!match) return null;
    const material = await new PostgresPlatformWebAuthnMaterialRepository(this.pool)
      .findVerifiedMaterial(match.userId, input.factorId);
    if (!material) return null;
    const challenge = await new PostgresPlatformWebAuthnChallengeRepository(this.pool).issue({
      userId: match.userId, factorId: material.factorId, sessionId: null, purpose: this.policy.sessionScope==="GLOBAL"?"GLOBAL_AUTHENTICATE":"AUTHENTICATE",
      rpId: this.policy.rpId, expectedOrigin: this.policy.origin,
      expiresAt: new Date(Date.now() + this.policy.challengeLifetimeMs).toISOString(),
      correlationId: input.correlationId,
    });
    return { ...challenge, credentialId: material.credentialId, userVerification: "required" };
  }

  async complete(input: {
    readonly email: string; readonly password: string;
    readonly challenge: string; readonly response: AuthenticationResponseJSON;
  }): Promise<BusinessInitialMfaReceipt | null> {
    const match = await verifyStoredPlatformPassword(
      new PostgresPasswordCredentialVerificationRepository(this.pool), input, this.policy,
    );
    if (!match) return null;
    const evidence = await new PostgresBusinessInitialWebAuthnTransaction(this.pool,this.policy.sessionScope).verifyAndCommit({
      passwordMatch: match, challenge: input.challenge,
      rpId: this.policy.rpId, expectedOrigin: this.policy.origin,
    }, async context => {
      const proof = await verifyPlatformWebAuthnAssertion({
        ...context,
        factor: { userId: context.material.userId, factorId: context.material.factorId, secretReference: context.material.secretReference },
        response: input.response, rp: { rpId: this.policy.rpId, origin: this.policy.origin },
      });
      return proof === null ? null : {
        userVerified: true, newCounter: proof.newCounter, credentialBackedUp: proof.credentialBackedUp,
      };
    });
    if (!evidence) return null;
    const receipt = Object.freeze({ kind: "BUSINESS_INITIAL_MFA_RECEIPT" as const });
    this.verified.set(receipt, evidence);
    return receipt;
  }

  /**
   * Metadata handoff only, NOT session authorization. Future issuer must apply
   * approved MFA age, session/access/refresh/abuse/reauth policies, revalidate
   * identity/membership/device/revocation and atomically create its own session.
   * Copies, JSON, UUIDs, another instance and a second redemption fail closed.
   * Process restart loses outstanding receipts; no bearer or durable token exists.
   */
  takeForBusinessSession(receipt: unknown): CommittedBusinessInitialMfa | null {
    if(this.policy.sessionScope==="GLOBAL")return null;
    if (typeof receipt !== "object" || receipt === null) return null;
    const evidence = this.verified.get(receipt);
    this.verified.delete(receipt);
    return evidence ?? null;
  }
  takeForGlobalSession(receipt:unknown):CommittedBusinessInitialMfa|null{
    if(this.policy.sessionScope!=="GLOBAL"||typeof receipt!=="object"||receipt===null)return null;
    const evidence=this.verified.get(receipt);this.verified.delete(receipt);return evidence?.purpose==="GLOBAL_INITIAL_MFA"?evidence:null;
  }
}
