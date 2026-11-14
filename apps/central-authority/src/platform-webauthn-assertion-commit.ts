import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { PostgresPlatformWebAuthnAssertionTransaction } from "@pos-platform/database-postgres";
import { verifyPlatformWebAuthnAssertion } from "./platform-webauthn-assertion-verifier.js";

/**
 * INTERNAL trusted Central Authority integration. Do not expose this API to
 * HTTP or consider its success to be permission to issue a user session.
 *
 * A trusted boot configuration, not client-supplied JSON, must select RP/origin;
 * the proof is revalidated against server-stored challenge + credential.
 */
export async function commitPlatformWebAuthnProof(
  coordinator: PostgresPlatformWebAuthnAssertionTransaction,
  input: {
    readonly userId: string;
    readonly factorId: string;
    readonly sessionId: string;
    readonly purpose: "REAUTHENTICATE" | "RECOVERY_APPROVAL";
    readonly challenge: string;
    readonly response: AuthenticationResponseJSON;
  },
  trustedRp: { readonly rpId: string; readonly origin: string },
): Promise<boolean> {
  return coordinator.verifyAndCommit({
    userId: input.userId, factorId: input.factorId, sessionId: input.sessionId,
    purpose: input.purpose, challenge: input.challenge,
    rpId: trustedRp.rpId, expectedOrigin: trustedRp.origin,
  }, async ctx => {
    const proof = await verifyPlatformWebAuthnAssertion({
      response: input.response,
      challenge: ctx.challenge,
      factor: {
        userId: ctx.material.userId,
        factorId: ctx.material.factorId,
        secretReference: ctx.material.secretReference,
      },
      material: ctx.material,
      rp: trustedRp,
    });
    return proof === null ? null : {
      userVerified: true,
      newCounter: proof.newCounter,
      credentialBackedUp: proof.credentialBackedUp,
    };
  });
}
